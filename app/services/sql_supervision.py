"""SQL supervision — parent-resolved datasource, explicit spawn, atomic result file, bounded supervision state machine.

设计约束：
- 使用 spawn 上下文（Linux/Windows 同一路径），确保 worker 子进程从干净状态启动
- Worker 通过原子文件（result.tmp → os.replace → result.json）传输结果，不使用 Queue/Pipe
- 父进程有界状态机：deadline timeout → natural exit grace → terminate → kill → read budget
- 单一 outcome 变量，不提前返回，单一 return 出口
- TERMINATION_FAILURE 时不 close、不 cleanup
- 错误消息不包含单元格值或密码
- Traceback 日志中密码用 [REDACTED] 替换，禁止使用 logger.exception
- Worker 和 supervision 不接触 SQLAlchemy Session
- resolve_worker_request 不调用 key_encryption.decrypt()
- 父进程不信任 result.json：通过 _decode_transport_payload 解码边界
  - success → deserialize_result → JSON-safe queryResult
  - error → 只接受白名单 error_code，重新生成安全文案
  - 其他 → WORKER_PROTOCOL_ERROR
"""

import json
import logging
import multiprocessing
import os
import tempfile
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import psutil
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.datasource import DatasourceConfig
from .sql_result_serializer import (
    MAX_RESULT_BYTES,
    SerializationError,
    deserialize_result,
    serialize_result,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Worker 状态常量（用于 worker.json metadata）
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

# outcome error_code → state 映射
_OUTCOME_TO_STATE = {
    "TIMEOUT": STATE_TIMEOUT,
    "WORKER_CRASH": STATE_WORKER_CRASH,
    "WORKER_PROTOCOL_ERROR": STATE_PROTOCOL_ERROR,
    "SERIALIZATION_ERROR": STATE_SERIALIZATION_ERROR,
    "EXECUTION_ERROR": STATE_EXECUTION_ERROR,
    "TERMINATION_FAILURE": STATE_TERMINATION_FAILURE,
}

# ---------------------------------------------------------------------------
# 时间常量
# ---------------------------------------------------------------------------

EXEC_TIMEOUT = 30.0
NATURAL_EXIT_GRACE = 2.0
TERMINATE_GRACE = 2.0
KILL_GRACE = 2.0
READ_BUDGET = 1.0
POLL_INTERVAL = 0.05

# Spawn 上下文（Linux/Windows 同一路径）
_ctx = multiprocessing.get_context("spawn")

# ---------------------------------------------------------------------------
# Worker error code 白名单与安全文案
# ---------------------------------------------------------------------------

_WORKER_ERROR_CODES = frozenset({
    "EXECUTION_ERROR",
    "SERIALIZATION_ERROR",
})

_WORKER_ERROR_MESSAGES = {
    "EXECUTION_ERROR": "query execution failed",
    "SERIALIZATION_ERROR": "result serialization failed",
}


# ---------------------------------------------------------------------------
# WorkerRequest — 完全可序列化的 worker 请求
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class WorkerRequest:
    """完全可序列化的 worker 请求。password 使用 repr=False 避免泄露。"""

    adapter_type: str
    host: str
    port: int
    service_name: str | None
    sid: str | None
    username: str
    password: str = field(repr=False)
    dialect: str
    lib_dir: str | None
    sql: str


# ---------------------------------------------------------------------------
# 父进程数据源解析
# ---------------------------------------------------------------------------

def resolve_worker_request(db: Session, datasource_id: int, sql: str) -> WorkerRequest:
    """父进程数据源解析。404 if missing，不 spawn 子进程。

    Phase 5N: password_enc 存储明文，不调用 key_encryption.decrypt()。
    """
    ds = db.query(DatasourceConfig).filter(
        DatasourceConfig.id == datasource_id
    ).first()
    if ds is None:
        raise HTTPException(status_code=404, detail="datasource not found")
    password = ds.password_enc or ""
    return WorkerRequest(
        adapter_type=ds.ds_type,
        host=ds.host,
        port=ds.port,
        service_name=ds.service_name or None,
        sid=None,
        username=ds.username,
        password=password,
        dialect=ds.dialect,
        lib_dir=None,
        sql=sql,
    )


# ---------------------------------------------------------------------------
# 错误信封与密码脱敏
# ---------------------------------------------------------------------------

def _safe_error_envelope(error_code: str, message: str) -> dict:
    """稳定错误信封，不包含原始异常文本。"""
    return {"status": "error", "error_code": error_code, "error": message}


def _redact_traceback(tb_text: str, password: str) -> str:
    """将 traceback 中的密码替换为 [REDACTED]。"""
    if not password:
        return tb_text
    return tb_text.replace(password, "[REDACTED]")


# ---------------------------------------------------------------------------
# Worker metadata (worker.json) — 不含 password/sql/rows
# ---------------------------------------------------------------------------

def _write_worker_metadata(work_dir: Path, meta: dict) -> None:
    """原子写入 worker.json metadata。

    metadata 只包含 pid、createdAt、processCreateTime、state。
    不含 password、SQL、result rows。
    """
    tmp_path = work_dir / "worker.tmp"
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, work_dir / "worker.json")


def _update_worker_state(work_dir: Path, state: str) -> bool:
    """更新 worker.json 中的 state 字段。返回 True 表示成功。"""
    worker_json = work_dir / "worker.json"
    if not worker_json.exists():
        return False
    try:
        with worker_json.open("r", encoding="utf-8") as f:
            meta = json.load(f)
        meta["state"] = state
        _write_worker_metadata(work_dir, meta)
        return True
    except Exception:
        return False


def _outcome_to_state(outcome: dict) -> str:
    """将 outcome 的 error_code 映射为 state 常量。"""
    code = outcome.get("error_code")
    if code is None:
        return STATE_COMPLETED
    return _OUTCOME_TO_STATE.get(code, STATE_EXECUTION_ERROR)


# ---------------------------------------------------------------------------
# Transport 解码边界
# ---------------------------------------------------------------------------

def _decode_transport_payload(payload: Any) -> dict:
    """解码 worker 传输的 tagged payload 为安全 outcome。

    - success → deserialize_result → JSON-safe queryResult
    - error + 白名单 code → 重新生成安全文案，不信任文件中的 error 字段
    - 其他 → WORKER_PROTOCOL_ERROR
    """
    if not isinstance(payload, dict):
        return _safe_error_envelope("WORKER_PROTOCOL_ERROR", "invalid result payload")

    status = payload.get("status")

    if status == "success":
        try:
            return deserialize_result(payload)
        except Exception:
            return _safe_error_envelope("WORKER_PROTOCOL_ERROR", "invalid result payload")

    if status == "error":
        error_code = payload.get("error_code")
        if error_code not in _WORKER_ERROR_CODES:
            return _safe_error_envelope("WORKER_PROTOCOL_ERROR", "invalid result payload")
        safe_msg = _WORKER_ERROR_MESSAGES.get(error_code, "unknown error")
        return _safe_error_envelope(error_code, safe_msg)

    return _safe_error_envelope("WORKER_PROTOCOL_ERROR", "invalid result payload")


# ---------------------------------------------------------------------------
# Worker 函数（spawn-safe，顶层定义）
# ---------------------------------------------------------------------------

def _sql_worker(adapter_factory, request: WorkerRequest, work_dir: Path):
    """顶层 worker 函数，用于 spawn 上下文。

    创建 adapter → 执行查询 → 序列化结果 → 调用 adapter.close()
    → 原子发布 result.json。
    """
    work_dir = Path(work_dir)
    result_path = work_dir / "result.json"
    tmp_path = work_dir / "result.tmp"

    adapter = None
    payload = None

    try:
        try:
            adapter = adapter_factory(request)
            result = adapter.execute_query(request.sql)
            if result.error:
                payload = _safe_error_envelope("EXECUTION_ERROR", "query execution failed")
            else:
                payload = serialize_result(result.columns, result.rows)
        except SerializationError:
            payload = _safe_error_envelope("SERIALIZATION_ERROR", "result serialization failed")
        except Exception:
            # 记录 traceback 但密码脱敏，不包含在 payload 中
            tb = traceback.format_exc()
            logger.error("worker execution failed:\n%s", _redact_traceback(tb, request.password))
            payload = _safe_error_envelope("EXECUTION_ERROR", "query execution failed")
        finally:
            if adapter is not None:
                try:
                    adapter.close()
                except Exception:
                    pass

        # adapter.close() 完成 — 现在原子发布结果
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, result_path)
    except Exception:
        # 结果文件未写入；父进程通过 exitcode 检测
        pass


# ---------------------------------------------------------------------------
# 有界监督状态机
# ---------------------------------------------------------------------------

def _supervise_sync(
    adapter_factory,
    request: WorkerRequest,
    timeout_seconds: float,
    *,
    worker_fn: Callable = _sql_worker,
    work_dir: str | None = None,
    cleanup_callback: Callable[[str], None] | None = None,
    process_factory: Callable[..., Any] | None = None,
) -> dict:
    """有界监督状态机。单一 outcome，不提前返回，单一 return 出口。

    状态机流程：
    1. 创建 work_dir（权限 0700）
    2. spawn worker 进程（或注入的 process_factory）
    3. 轮询 result.json 或 exitcode，直到 deadline
    4. 如果 result.json 出现：等待自然退出（NATURAL_EXIT_GRACE）
    5. terminate → 有界 join（TERMINATE_GRACE）
    6. kill → 有界 join（KILL_GRACE）
    7. 如果仍然存活 → TERMINATION_FAILURE（不 close、不 cleanup）
    8. 读取 result.json → _decode_transport_payload（READ_BUDGET）
    9. cleanup（如果不是 TERMINATION_FAILURE）
    """
    outcome = None
    process = None
    process_closed = False
    work_dir_path = None

    try:
        # 创建工作目录
        if work_dir is not None:
            work_dir_path = Path(work_dir)
            work_dir_path.mkdir(parents=True, exist_ok=True)
        else:
            td = tempfile.mkdtemp(prefix="metricforge_sql_")
            work_dir_path = Path(td)
        os.chmod(str(work_dir_path), 0o700)

        result_path = work_dir_path / "result.json"

        # Spawn worker 进程
        spawn_args = (adapter_factory, request, work_dir_path)
        if process_factory is not None:
            process = process_factory(
                target=worker_fn, args=spawn_args,
            )
        else:
            process = _ctx.Process(target=worker_fn, args=spawn_args)
        process.start()

        # 写入 worker.json metadata（不含 password/sql/rows）
        pid = getattr(process, "pid", None)
        proc_create_time = None
        if pid is not None:
            try:
                proc_create_time = psutil.Process(pid).create_time()
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                pass
            except Exception:
                pass
        _write_worker_metadata(work_dir_path, {
            "pid": pid,
            "createdAt": time.time(),
            "processCreateTime": proc_create_time,
            "state": STATE_ACTIVE,
        })

        # 轮询 result.json 或 exitcode，直到 deadline
        query_deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < query_deadline:
            if result_path.exists():
                break
            exitcode = process.exitcode
            if exitcode is not None:
                if exitcode != 0:
                    outcome = _safe_error_envelope("WORKER_CRASH", "worker exited unexpectedly")
                else:
                    outcome = _safe_error_envelope("WORKER_PROTOCOL_ERROR", "worker exited without result")
                break
            time.sleep(POLL_INTERVAL)
        else:
            outcome = _safe_error_envelope("TIMEOUT", "query timed out")

        # 等待自然退出（仅当 result.json 已出现且尚未确定错误 outcome）
        if outcome is None:
            natural_deadline = time.monotonic() + NATURAL_EXIT_GRACE
            while process.exitcode is None and time.monotonic() < natural_deadline:
                time.sleep(POLL_INTERVAL)

        # terminate → 有界 join
        if _process_is_alive(process):
            process.terminate()
            process.join(timeout=TERMINATE_GRACE)

        # kill → 有界 join
        if _process_is_alive(process):
            process.kill()
            process.join(timeout=KILL_GRACE)

        # kill 后仍然存活 → TERMINATION_FAILURE
        if _process_is_alive(process):
            logger.critical(
                "worker process refused to die: pid=%s, work_dir=%s",
                getattr(process, "pid", None), work_dir_path,
            )
            outcome = _safe_error_envelope(
                "TERMINATION_FAILURE", "worker process refused to terminate"
            )
            # 不 process.close()，不 cleanup
        else:
            process.close()
            process_closed = True

        # 读取并解码 result.json（仅当无错误 outcome）
        if outcome is None:
            read_deadline = time.monotonic() + READ_BUDGET
            while not result_path.exists() and time.monotonic() < read_deadline:
                time.sleep(POLL_INTERVAL)

            if not result_path.exists():
                outcome = _safe_error_envelope(
                    "WORKER_PROTOCOL_ERROR", "worker produced no result file"
                )
            else:
                file_size = result_path.stat().st_size
                if file_size > MAX_RESULT_BYTES:
                    outcome = _safe_error_envelope(
                        "SERIALIZATION_ERROR", "result file size exceeds limit"
                    )
                else:
                    try:
                        with result_path.open("r", encoding="utf-8") as f:
                            raw_payload = json.load(f)
                        outcome = _decode_transport_payload(raw_payload)
                    except Exception:
                        outcome = _safe_error_envelope(
                            "WORKER_PROTOCOL_ERROR", "result file is not valid JSON"
                        )

    except Exception:
        sanitized_tb = _redact_traceback(traceback.format_exc(), request.password)
        logger.error("supervision failed:\n%s", sanitized_tb)
        outcome = _safe_error_envelope("EXECUTION_ERROR", "supervision failed")

    finally:
        # 先原子更新 worker.json 最终 state，再调用 cleanup_callback
        # metadata_published 标志：只有写入成功才允许 cleanup
        metadata_published = False
        try:
            if work_dir_path is not None and outcome is not None:
                final_state = _outcome_to_state(outcome)
                worker_json = work_dir_path / "worker.json"
                if worker_json.exists():
                    metadata_published = _update_worker_state(work_dir_path, final_state)
                else:
                    # process.start 失败等：从未写入 metadata
                    try:
                        _write_worker_metadata(work_dir_path, {
                            "pid": getattr(process, "pid", None) if process else None,
                            "createdAt": time.time(),
                            "processCreateTime": None,
                            "state": final_state,
                        })
                        metadata_published = True
                    except Exception:
                        logger.warning("failed to write worker metadata")
                        metadata_published = False
                if not metadata_published:
                    logger.warning("worker metadata not published, directory preserved")
        except Exception:
            pass  # 状态写入异常不影响 outcome

        # 判断 process 是否已关闭或已死亡
        if process is None:
            alive = False
        elif process_closed:
            alive = False
        else:
            try:
                alive = process.is_alive()
            except (ValueError, AssertionError):
                alive = False

        can_cleanup = (
            work_dir_path is not None
            and not alive
            and metadata_published
            and (outcome is None or outcome.get("error_code") != "TERMINATION_FAILURE")
        )
        if can_cleanup and cleanup_callback is not None:
            try:
                cleanup_callback(str(work_dir_path))
            except Exception:
                logger.warning("cleanup callback failed for %s", work_dir_path)

    return outcome


def _process_is_alive(process) -> bool:
    """安全检查 process.is_alive()，处理已关闭的 process。"""
    try:
        return process.is_alive()
    except (ValueError, AssertionError):
        return False
