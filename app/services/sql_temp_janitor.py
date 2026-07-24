"""SQL 临时目录清理守护线程。

设计约束：
- 使用 psutil PID + create_time 三态判断：ALIVE / DEAD / UNKNOWN
- ALIVE: PID + create_time 匹配，worker 仍存活
- DEAD: NoSuchProcess 或 create_time 明确不匹配（PID reuse）
- UNKNOWN: AccessDenied、缺少 create_time、无法确认 — 即使超过 24h 也跳过
- active/starting 状态仅在 DEAD 且超过 retention 时允许清理
- termination_failure 始终跳过
- immediate cleanup 通过 wakeup_event 唤醒 janitor，不等 5 分钟扫描
- stop 后 schedule 返回拒绝，不入队
- janitor 未启动时 schedule 使用 fallback 直接安全清理（不再静默 no-op）
- schedule 仅在线程 alive 且未 stopping 时接受任务
- stop 前已接受的队列在 _run 退出前 drain 到 fallback，不丢失
- _run 使用固定 monotonic deadline（next_scan_at），immediate wake 不推迟 scan
- 扫描完成后从当前 monotonic 时间计算下一个 deadline，避免补偿式连续扫描
- stop bounded join 后线程仍活时保留线程句柄、返回 False
- start 不得创建第二个线程
- stop 路径不同步执行 rmtree，只做 bounded join
- 统一 lifecycle lock 保护 stop 状态检查与 immediate enqueue
- immediate cleanup 必须验证 metadata：仅终态可立即删除
- Event 控制停止，有界 join
- rmtree 异常只记录安全日志
- 禁止读取或记录 result 数据
- safe_cleanup_work_dir 与 _validate_and_cleanup_immediate 复用同一终态校验 helper
"""

import json
import logging
import os
import shutil
import tempfile
import threading
import time
from pathlib import Path

import psutil

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Worker 状态常量（与 sql_supervision.py 保持一致）
# ---------------------------------------------------------------------------

STATE_STARTING = "starting"
STATE_ACTIVE = "active"
STATE_COMPLETED = "completed"
STATE_TIMEOUT = "timeout"
STATE_WORKER_CRASH = "worker_crash"
STATE_PROTOCOL_ERROR = "protocol_error"
STATE_SERIALIZATION_ERROR = "serialization_error"
STATE_EXECUTION_ERROR = "execution_error"
STATE_TERMINATION_FAILURE = "termination_failure"

# PID 三态判断结果
ALIVE = "alive"
DEAD = "dead"
UNKNOWN = "unknown"

# 永远不清理的状态
_SKIP_STATES = frozenset({STATE_TERMINATION_FAILURE})

# active/starting 状态需要额外 PID 检查
_ACTIVE_STATES = frozenset({STATE_ACTIVE, STATE_STARTING})

# immediate cleanup 允许直接删除的终态
_IMMEDIATE_CLEANABLE_STATES = frozenset({
    STATE_COMPLETED, STATE_TIMEOUT, STATE_WORKER_CRASH,
    STATE_PROTOCOL_ERROR, STATE_SERIALIZATION_ERROR, STATE_EXECUTION_ERROR,
})

# 保留时间
RETENTION_SECONDS = 24 * 3600  # 24 小时

# 扫描间隔
SCAN_INTERVAL = 300  # 5 分钟


# ---------------------------------------------------------------------------
# 共享终态校验 + 清理 helper（避免规则漂移）
# ---------------------------------------------------------------------------

def _rmtree(path: Path) -> None:
    """安全 rmtree，只记录日志，不读取 result 数据。"""
    try:
        shutil.rmtree(str(path), ignore_errors=False)
    except Exception:
        logger.warning("Failed to cleanup SQL temp dir: %s", path)


def _validate_and_cleanup(path: Path) -> None:
    """验证 metadata 后清理目录。仅终态可删除，其余保留。

    被 _validate_and_cleanup_immediate、safe_cleanup_work_dir、
    _drain_queue_to_fallback 共同复用，避免规则漂移。
    """
    worker_json = path / "worker.json"

    if not worker_json.exists():
        logger.warning("skipping cleanup: no worker.json: %s", path)
        return

    try:
        with worker_json.open("r", encoding="utf-8") as f:
            meta = json.load(f)
    except Exception:
        logger.warning("skipping cleanup: corrupt worker.json: %s", path)
        return

    state = meta.get("state")

    if state not in _IMMEDIATE_CLEANABLE_STATES:
        logger.warning("skipping cleanup: state=%s: %s", state, path)
        return

    _rmtree(path)


class SqlTempJanitor:
    """SQL 临时目录清理守护线程。

    使用 psutil PID + create_time 三态判断：ALIVE / DEAD / UNKNOWN。
    immediate cleanup 通过 wakeup_event 唤醒，不等扫描周期。
    _run 使用固定 monotonic deadline，immediate wake 不推迟 scan。
    """

    def __init__(self, temp_root: str | None = None):
        self._temp_root = temp_root or tempfile.gettempdir()
        self._stop_event = threading.Event()
        self._wakeup_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._immediate_queue: list[str] = []
        self._lifecycle_lock = threading.Lock()

    def start(self) -> None:
        """启动 janitor 线程。可重复调用，不会创建第二个线程。"""
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._wakeup_event.clear()
        self._thread = threading.Thread(
            target=self._run,
            name="sql-temp-janitor",
            daemon=True,
        )
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> bool:
        """停止 janitor 线程。使用 Event + 有界 join。

        返回 True 表示线程已停止，False 表示线程仍活着（保留句柄）。
        不在 stop 路径同步执行 rmtree，只做 bounded join。
        已接受的队列由 _run 退出前 drain 到 fallback。
        """
        with self._lifecycle_lock:
            self._stop_event.set()
            self._wakeup_event.set()  # 唤醒等待中的线程
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=timeout)
        if self._thread and self._thread.is_alive():
            return False  # 线程仍活着，保留句柄
        self._thread = None
        return True

    def schedule_immediate_cleanup(self, work_dir: str) -> bool:
        """添加到立即清理队列并唤醒 janitor。

        返回 True 表示已入队，False 表示 janitor 已停止或线程未运行。
        仅在线程 alive 且未 stopping 时接受任务。
        stop 状态检查与 enqueue 在同一 lifecycle lock 内完成。
        """
        with self._lifecycle_lock:
            if self._stop_event.is_set():
                return False
            if self._thread is None or not self._thread.is_alive():
                return False
            self._immediate_queue.append(work_dir)
        self._wakeup_event.set()
        return True

    def is_running(self) -> bool:
        """janitor 是否正在运行。"""
        return self._thread is not None and self._thread.is_alive()

    def is_accepting(self) -> bool:
        """janitor 是否正在接受任务：thread alive AND stop_event 未设置。"""
        return (
            self._thread is not None
            and self._thread.is_alive()
            and not self._stop_event.is_set()
        )

    # ------------------------------------------------------------------
    # 内部实现
    # ------------------------------------------------------------------

    def _run(self) -> None:
        """主循环：固定 monotonic deadline 控制 scan 时机。

        immediate wake 只处理 queue，不推迟 scan deadline。
        scan deadline 到期时先推进 deadline 再执行 scan，确保 scan 抛异常后
        不会因 deadline 仍在过去而形成 ~1ms 忙循环。
        _run 退出前 drain remaining queue 到 fallback，不丢失已接受任务。
        """
        next_scan_at = time.monotonic() + SCAN_INTERVAL
        while not self._stop_event.is_set():
            remaining = max(0.001, next_scan_at - time.monotonic())
            woken = self._wakeup_event.wait(remaining)
            if self._stop_event.is_set():
                break
            self._wakeup_event.clear()
            try:
                self._process_immediate_queue()
                if time.monotonic() >= next_scan_at:
                    # 先推进 deadline，再执行 scan
                    # 确保 scan 抛异常后不会形成忙循环
                    next_scan_at = time.monotonic() + SCAN_INTERVAL
                    self._scan_and_cleanup()
            except Exception:
                logger.warning("SQL temp janitor tick failed", exc_info=True)
        # stop 请求 — drain remaining queue 到 fallback
        self._drain_queue_to_fallback()

    def _drain_queue_to_fallback(self) -> None:
        """将剩余 immediate queue drain 到 fallback cleanup。

        不在持有 lifecycle lock 时执行 rmtree。
        终态目录被清理，active/starting/termination_failure 被跳过。
        """
        with self._lifecycle_lock:
            items = self._immediate_queue
            self._immediate_queue = []
        for work_dir in items:
            _validate_and_cleanup(Path(work_dir))

    def _process_immediate_queue(self) -> None:
        """处理 immediate cleanup queue — 验证 metadata 后再删除。"""
        with self._lifecycle_lock:
            items = self._immediate_queue
            self._immediate_queue = []
        for work_dir in items:
            _validate_and_cleanup(Path(work_dir))

    def _validate_and_cleanup_immediate(self, path: Path) -> None:
        """已废弃 — 使用共享 _validate_and_cleanup。保留兼容。"""
        _validate_and_cleanup(path)

    def _scan_and_cleanup(self) -> None:
        """扫描 metricforge_sql_* 目录。"""
        try:
            entries = list(Path(self._temp_root).glob("metricforge_sql_*"))
        except Exception:
            return
        for entry in entries:
            if self._stop_event.is_set():
                break
            self._inspect_and_maybe_cleanup(entry)

    def _inspect_and_maybe_cleanup(self, path: Path) -> None:
        """检查目录的 worker.json，决定是否清理。"""
        worker_json = path / "worker.json"

        if not worker_json.exists():
            # 无 metadata — 按目录修改时间判断
            try:
                mtime = path.stat().st_mtime
            except OSError:
                return
            if time.time() - mtime > RETENTION_SECONDS:
                _rmtree(path)
            return

        # 读取 metadata（不读取 result.json）
        try:
            with worker_json.open("r", encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            return

        state = meta.get("state")

        # termination_failure — 永远跳过
        if state in _SKIP_STATES:
            return

        # active/starting 状态：需要 PID 三态判断
        if state in _ACTIVE_STATES:
            status = self._check_worker_status(meta)
            if status == ALIVE:
                return  # worker 仍存活，跳过
            if status == UNKNOWN:
                return  # 无法确认死亡，即使超过 24h 也跳过
            # status == DEAD → 可以清理，但需要超过 retention
            created_at = meta.get("createdAt")
            if created_at is not None and time.time() - created_at < RETENTION_SECONDS:
                return  # 未超过 retention，跳过
            # DEAD + 超过 retention → 清理
            _rmtree(path)
            return

        # 终态目录（completed/timeout/crash/protocol/serialization/execution）：
        # 检查 retention
        created_at = meta.get("createdAt")
        if created_at is not None and time.time() - created_at < RETENTION_SECONDS:
            return  # 未过期

        _rmtree(path)

    def _check_worker_status(self, meta: dict) -> str:
        """三态判断：ALIVE / DEAD / UNKNOWN。

        - NoSuchProcess 或 create_time 明确不匹配：DEAD
        - PID 与 create_time 匹配：ALIVE
        - AccessDenied、缺少 create_time、无法确认：UNKNOWN
        """
        pid = meta.get("pid")
        create_time = meta.get("processCreateTime")

        if pid is None:
            return UNKNOWN

        # 缺少 create_time → 无法确认，UNKNOWN
        if create_time is None:
            return UNKNOWN

        try:
            proc = psutil.Process(pid)
            actual_ct = proc.create_time()
        except psutil.NoSuchProcess:
            return DEAD
        except (psutil.AccessDenied, psutil.ZombieProcess):
            return UNKNOWN
        except Exception:
            return UNKNOWN

        if actual_ct == create_time:
            return ALIVE

        # create_time 不匹配 → PID reuse，原 worker 已死亡
        return DEAD

    def _is_worker_alive(self, meta: dict) -> bool:
        """旧接口兼容：返回 bool。ALIVE → True，其他 → False。"""
        return self._check_worker_status(meta) == ALIVE

    def _cleanup_dir(self, path: str) -> None:
        """已废弃 — 使用共享 _rmtree。保留兼容。"""
        _rmtree(Path(path))


# ---------------------------------------------------------------------------
# 模块级生产接口
# ---------------------------------------------------------------------------

_janitor: SqlTempJanitor | None = None
_janitor_lock = threading.Lock()


def start_sql_temp_janitor(app) -> bool:
    """启动 SQL temp janitor，绑定到 app.state。

    返回 True 表示 janitor 正在接受任务（新启动或复用）。
    返回 False 表示已有 thread alive 但 stop_event 已设置，不得创建新线程。
    """
    global _janitor
    with _janitor_lock:
        if _janitor is not None:
            if _janitor.is_accepting():
                # 正常运行中 — 复用
                app.state.sql_temp_janitor = _janitor
                return True
            if _janitor.is_running():
                # thread alive 但 stop_event 已设置 — 不得创建新线程
                app.state.sql_temp_janitor = _janitor
                return False
            # thread 已退出 — 替换并启动新实例
            _janitor = None
        _janitor = SqlTempJanitor()
        _janitor.start()
        app.state.sql_temp_janitor = _janitor
        return True


def stop_sql_temp_janitor(app) -> bool:
    """停止 SQL temp janitor。

    返回 True 表示线程已停止、全局引用已清空。
    返回 False 表示线程仍活着，保留同一实例和线程句柄。
    """
    global _janitor
    with _janitor_lock:
        janitor = getattr(app.state, "sql_temp_janitor", None) or _janitor
        if janitor is None:
            return True
        stopped = janitor.stop()
        if stopped:
            _janitor = None
            if hasattr(app, "state") and hasattr(app.state, "sql_temp_janitor"):
                try:
                    del app.state.sql_temp_janitor
                except AttributeError:
                    pass
        # stop=False 时保留 _janitor 和 app.state 引用
        return stopped


def safe_cleanup_work_dir(work_dir: str) -> None:
    """安全清理工作目录。验证 worker.json 为终态后才删除。

    用于 janitor 未运行或不接受任务时的 fallback cleanup。
    与 _validate_and_cleanup_immediate 复用同一 _validate_and_cleanup helper。
    """
    _validate_and_cleanup(Path(work_dir))


def schedule_sql_temp_cleanup(work_dir: str) -> None:
    """生产 cleanup callback：优先入队给运行中的 janitor。

    如果 janitor 未启动或不接受任务，使用 fallback 直接安全清理。
    不再静默 no-op。
    """
    global _janitor
    with _janitor_lock:
        janitor = _janitor
    if janitor is not None:
        enqueued = janitor.schedule_immediate_cleanup(work_dir)
        if enqueued:
            return
    # janitor 未运行或拒绝 → fallback 直接安全清理
    safe_cleanup_work_dir(work_dir)
