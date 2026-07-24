"""Phase 5N — SQL temp lifecycle 极窄修复 RED 测试。

覆盖：
1. janitor 未启动时默认 cleanup 不残留临时目录（5 种终态）
2. 测试使用隔离 tmp_path，不扫描系统临时目录
3. immediate cleanup 验证 metadata 后才删除
4. janitor immediate wake 不触发全局 scan
5. process lifecycle：无 active_children 残留
"""

import json
import multiprocessing
import os
import threading
import time
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from app.models.datasource import DatasourceConfig
from app.services.sql_execution_service import SqlExecutionService
from app.services.sql_temp_janitor import SqlTempJanitor, schedule_sql_temp_cleanup
from app.services.sql_supervision import (
    STATE_ACTIVE,
    STATE_COMPLETED,
    STATE_EXECUTION_ERROR,
    STATE_SERIALIZATION_ERROR,
    STATE_STARTING,
    STATE_TERMINATION_FAILURE,
    STATE_TIMEOUT,
    STATE_WORKER_CRASH,
    _supervise_sync,
    _write_worker_metadata,
    WorkerRequest,
)
from tests.support.sql_worker_factories import (
    crash_factory,
    exception_containing_password_factory,
    hanging_factory,
    serialization_error_factory,
    success_factory,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_datasource(db_session, name="test-ds"):
    ds = DatasourceConfig(
        name=name, ds_type="oracle", host="localhost", port=1521,
        service_name="ORCL", username="user", password_enc="secret",
        dialect="oracle",
    )
    db_session.add(ds)
    db_session.commit()
    return ds.id


def _make_request(password: str = "secret") -> WorkerRequest:
    return WorkerRequest(
        adapter_type="fake", host="localhost", port=1521,
        service_name=None, sid=None, username="user",
        password=password, dialect="fake", lib_dir=None,
        sql="SELECT 1",
    )


def _snapshot_dirs(tmp_path: Path) -> set:
    """快照 tmp_path 下的 metricforge_sql_* 目录名集合。"""
    return set(p.name for p in tmp_path.glob("metricforge_sql_*"))


# ---------------------------------------------------------------------------
# 1. janitor 未启动时默认 cleanup 不残留临时目录
# ---------------------------------------------------------------------------

class TestNoLeakWithDefaultCleanup:
    """janitor 未启动时，SqlExecutionService 使用默认 cleanup_callback
    （schedule_sql_temp_cleanup）后不新增残留目录。"""

    def test_no_leak_success(self, db_session, tmp_path):
        """success 后不新增残留目录。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(
            adapter_factory=success_factory,
            temp_root=str(tmp_path),
        )
        before = _snapshot_dirs(tmp_path)
        svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT * FROM DUAL")
        after = _snapshot_dirs(tmp_path)
        assert after == before, f"残留目录: {after - before}"

    def test_no_leak_timeout(self, db_session, tmp_path):
        """timeout 后不新增残留目录。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(
            adapter_factory=hanging_factory,
            temp_root=str(tmp_path),
        )
        before = _snapshot_dirs(tmp_path)
        svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT 1", timeout_seconds=0.1)
        after = _snapshot_dirs(tmp_path)
        assert after == before, f"残留目录: {after - before}"

    def test_no_leak_execution_error(self, db_session, tmp_path):
        """execution_error 后不新增残留目录。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(
            adapter_factory=exception_containing_password_factory,
            temp_root=str(tmp_path),
        )
        before = _snapshot_dirs(tmp_path)
        svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT 1")
        after = _snapshot_dirs(tmp_path)
        assert after == before, f"残留目录: {after - before}"

    def test_no_leak_serialization_error(self, db_session, tmp_path):
        """serialization_error 后不新增残留目录。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(
            adapter_factory=serialization_error_factory,
            temp_root=str(tmp_path),
        )
        before = _snapshot_dirs(tmp_path)
        svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT 1")
        after = _snapshot_dirs(tmp_path)
        assert after == before, f"残留目录: {after - before}"

    def test_no_leak_worker_crash(self, db_session, tmp_path):
        """worker_crash 后不新增残留目录。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(
            adapter_factory=crash_factory,
            temp_root=str(tmp_path),
        )
        before = _snapshot_dirs(tmp_path)
        svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT 1")
        after = _snapshot_dirs(tmp_path)
        assert after == before, f"残留目录: {after - before}"


# ---------------------------------------------------------------------------
# 2. process lifecycle — 无 active_children 残留
# ---------------------------------------------------------------------------

class TestProcessLifecycle:
    """每个测试结束后无新增 multiprocessing.active_children()。"""

    def test_no_active_children_after_success(self, db_session, tmp_path):
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(
            adapter_factory=success_factory,
            temp_root=str(tmp_path),
        )
        svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT 1")
        time.sleep(0.5)
        assert len(multiprocessing.active_children()) == 0

    def test_no_active_children_after_timeout(self, db_session, tmp_path):
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(
            adapter_factory=hanging_factory,
            temp_root=str(tmp_path),
        )
        svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT 1", timeout_seconds=0.05)
        time.sleep(0.5)
        assert len(multiprocessing.active_children()) == 0


# ---------------------------------------------------------------------------
# 3. immediate cleanup — fallback 安全规则
# ---------------------------------------------------------------------------

class TestFallbackCleanup:
    """janitor 未运行时，schedule_sql_temp_cleanup 执行 fallback 直接清理。
    必须先验证 worker.json 为允许清理的终态。"""

    def test_fallback_cleans_terminal_state(self, tmp_path):
        """终态目录被 fallback 清理。"""
        work_dir = tmp_path / "metricforge_sql_test_fb1"
        work_dir.mkdir()
        _write_worker_metadata(work_dir, {
            "pid": None, "createdAt": time.time(),
            "processCreateTime": None, "state": STATE_COMPLETED,
        })
        schedule_sql_temp_cleanup(str(work_dir))
        assert not work_dir.exists()

    def test_fallback_skips_termination_failure(self, tmp_path):
        """termination_failure 始终不被 fallback 删除。"""
        work_dir = tmp_path / "metricforge_sql_test_fb2"
        work_dir.mkdir()
        _write_worker_metadata(work_dir, {
            "pid": None, "createdAt": time.time(),
            "processCreateTime": None, "state": STATE_TERMINATION_FAILURE,
        })
        schedule_sql_temp_cleanup(str(work_dir))
        assert work_dir.exists(), "termination_failure 不应被清理"

    def test_fallback_skips_active(self, tmp_path):
        """active 状态不被 fallback 直接删除（需要 PID 判断）。"""
        work_dir = tmp_path / "metricforge_sql_test_fb3"
        work_dir.mkdir()
        _write_worker_metadata(work_dir, {
            "pid": 99999, "createdAt": time.time(),
            "processCreateTime": None, "state": STATE_ACTIVE,
        })
        schedule_sql_temp_cleanup(str(work_dir))
        assert work_dir.exists(), "active 状态不应被直接删除"

    def test_fallback_skips_starting(self, tmp_path):
        """starting 状态不被 fallback 直接删除。"""
        work_dir = tmp_path / "metricforge_sql_test_fb4"
        work_dir.mkdir()
        _write_worker_metadata(work_dir, {
            "pid": 99999, "createdAt": time.time(),
            "processCreateTime": None, "state": STATE_STARTING,
        })
        schedule_sql_temp_cleanup(str(work_dir))
        assert work_dir.exists(), "starting 状态不应被直接删除"

    def test_fallback_skips_no_metadata(self, tmp_path):
        """无 worker.json 的目录不被 fallback 删除。"""
        work_dir = tmp_path / "metricforge_sql_test_fb5"
        work_dir.mkdir()
        (work_dir / "result.json").write_text("{}")
        schedule_sql_temp_cleanup(str(work_dir))
        assert work_dir.exists(), "无 metadata 不应被删除"

    def test_fallback_skips_corrupt_metadata(self, tmp_path):
        """corrupt worker.json 的目录不被 fallback 删除。"""
        work_dir = tmp_path / "metricforge_sql_test_fb6"
        work_dir.mkdir()
        (work_dir / "worker.json").write_text("not valid json {{{")
        schedule_sql_temp_cleanup(str(work_dir))
        assert work_dir.exists(), "corrupt metadata 不应被删除"


# ---------------------------------------------------------------------------
# 4. janitor immediate wake 不触发全局 scan
# ---------------------------------------------------------------------------

class TestJanitorWakeupPerformance:
    """immediate wake 只处理 immediate queue，不调用全局 _scan_and_cleanup。"""

    def test_immediate_wake_no_global_scan(self, tmp_path):
        """多次 immediate cleanup 不触发全局扫描。"""
        janitor = SqlTempJanitor(temp_root=str(tmp_path))
        janitor.start()
        try:
            with patch.object(
                janitor, "_scan_and_cleanup",
                wraps=janitor._scan_and_cleanup,
            ) as mock_scan:
                # 入队几个终态目录
                for i in range(3):
                    work_dir = tmp_path / f"metricforge_sql_wake_{i}"
                    work_dir.mkdir()
                    _write_worker_metadata(work_dir, {
                        "pid": None, "createdAt": time.time(),
                        "processCreateTime": None,
                        "state": STATE_COMPLETED,
                    })
                    janitor.schedule_immediate_cleanup(str(work_dir))
                # 等待 immediate 处理
                time.sleep(1.0)
                # immediate wake 不应触发全局 scan
                assert mock_scan.call_count == 0, (
                    f"immediate wake 不应触发全局 scan, "
                    f"实际调用 {mock_scan.call_count} 次"
                )
        finally:
            janitor.stop()

    def test_scan_interval_triggers_global_scan(self, tmp_path):
        """SCAN_INTERVAL 超时后执行周期全局 scan。"""
        import app.services.sql_temp_janitor as janitor_mod
        janitor = SqlTempJanitor(temp_root=str(tmp_path))
        with patch.object(janitor_mod, "SCAN_INTERVAL", 0.2):
            janitor.start()
            try:
                with patch.object(
                    janitor, "_scan_and_cleanup",
                    wraps=janitor._scan_and_cleanup,
                ) as mock_scan:
                    time.sleep(1.0)
                    assert mock_scan.call_count > 0, (
                        "SCAN_INTERVAL 超时后应执行全局 scan"
                    )
            finally:
                janitor.stop()


# ---------------------------------------------------------------------------
# 5. 扫描异常退避 — scan 抛异常后不得形成忙循环
# ---------------------------------------------------------------------------

class TestScanExceptionBackoff:
    """_scan_and_cleanup 抛异常时不得形成 ~1ms 忙循环。"""

    def test_scan_exception_no_busy_loop(self, tmp_path):
        """scan 每次抛 RuntimeError，运行多个 interval 后
        扫描次数受 SCAN_INTERVAL 限制，不得形成热循环。"""
        import app.services.sql_temp_janitor as janitor_mod
        janitor = SqlTempJanitor(temp_root=str(tmp_path))
        with patch.object(janitor_mod, "SCAN_INTERVAL", 0.1):
            with patch.object(
                janitor, "_scan_and_cleanup",
                side_effect=RuntimeError("scan boom"),
            ) as mock_scan:
                janitor.start()
                try:
                    time.sleep(0.5)  # 5 × SCAN_INTERVAL
                    # With fix: ~5 scans. Without fix: ~500 scans (busy loop)
                    assert mock_scan.call_count <= 15, (
                        f"scan 异常后不得形成忙循环, "
                        f"scan 调用 {mock_scan.call_count} 次（应 ≤ 15）"
                    )
                finally:
                    stopped = janitor.stop(timeout=5)
                    assert stopped, "janitor 线程必须可被 bounded stop"


# ---------------------------------------------------------------------------
# 6. 确定性扫描防饥饿 — 独立 producer 线程 + Event 同步，不依赖 sleep 碰运气
# ---------------------------------------------------------------------------

class TestScanStarvation:
    """持续 immediate wake 不得阻止全局 scan。

    使用独立 producer 线程持续触发 immediate wake，跨越多个 SCAN_INTERVAL，
    通过 Event 同步确认 immediate 多次处理且 scan 至少执行一次。"""

    def test_continuous_immediate_does_not_starve_scan(self, tmp_path):
        """持续 immediate wake 不得饥饿全局 scan。

        producer 线程持续 schedule_immediate_cleanup，持续时间跨越至少 2 个
        缩短后的 SCAN_INTERVAL。在 producer 仍运行时，scan deadline 到期后
        必须执行全局 scan 至少一次，且 immediate process 次数 > 1。
        """
        import app.services.sql_temp_janitor as janitor_mod
        test_scan_interval = 0.15
        janitor = SqlTempJanitor(temp_root=str(tmp_path))

        scan_event = threading.Event()
        process_event = threading.Event()
        process_count = {"n": 0}
        producer_started = threading.Event()
        producer_stop = threading.Event()

        original_scan = janitor._scan_and_cleanup
        original_process = janitor._process_immediate_queue

        def tracked_scan():
            original_scan()
            scan_event.set()

        def tracked_process():
            original_process()
            process_count["n"] += 1
            process_event.set()

        def _make_terminal(i: int) -> str:
            work_dir = tmp_path / f"metricforge_sql_starve_{i}"
            work_dir.mkdir()
            _write_worker_metadata(work_dir, {
                "pid": None, "createdAt": time.time(),
                "processCreateTime": None, "state": STATE_COMPLETED,
            })
            return str(work_dir)

        def producer():
            """持续 schedule_immediate_cleanup，跨越至少 2 个 SCAN_INTERVAL。"""
            producer_started.set()
            i = 0
            # producer 持续时间 >= 2 * SCAN_INTERVAL（用 5 倍留足 CI 裕量）
            producer_end = time.monotonic() + 5 * test_scan_interval
            while not producer_stop.is_set() and time.monotonic() < producer_end:
                try:
                    work_dir = _make_terminal(i)
                    janitor.schedule_immediate_cleanup(work_dir)
                except Exception:
                    pass  # 生命周期收尾期间不影响断言
                i += 1
                time.sleep(0.005)  # 仅限 producer 节流，非正确性断言

        with patch.object(janitor_mod, "SCAN_INTERVAL", test_scan_interval):
            with patch.object(janitor, "_scan_and_cleanup", side_effect=tracked_scan), \
                 patch.object(janitor, "_process_immediate_queue", side_effect=tracked_process):
                janitor.start()
                producer_t = threading.Thread(
                    target=producer, name="test-starvation-producer", daemon=True,
                )
                producer_t.start()
                try:
                    # 1. 确认 producer 已启动
                    assert producer_started.wait(timeout=2.0), "producer 必须启动"

                    # 2. 确认 immediate processing 已发生多次（确定性 Event 等待）
                    count_deadline = time.monotonic() + 5.0
                    while process_count["n"] <= 1 and time.monotonic() < count_deadline:
                        process_event.clear()
                        process_event.wait(timeout=0.2)
                    assert process_count["n"] > 1, (
                        f"immediate process 次数必须 > 1, "
                        f"实际 {process_count['n']}"
                    )

                    # 3. 在 producer 仍运行时等待 scan_event（不依赖固定 sleep）
                    assert producer_t.is_alive(), (
                        "等待 scan 时 producer 必须仍运行"
                    )
                    assert scan_event.wait(timeout=5.0), (
                        "scan deadline 到期后必须执行全局 scan，"
                        "不得被持续 immediate wake 饥饿"
                    )
                    # scan 至少执行一次
                    assert scan_event.is_set(), "scan 必须至少执行一次"
                finally:
                    # 4. 收尾：stop producer → bounded join → bounded stop janitor
                    producer_stop.set()
                    producer_t.join(timeout=5.0)
                    stopped = janitor.stop(timeout=5.0)
                    assert not producer_t.is_alive(), "producer 线程必须退出"
                    assert stopped, "janitor 线程必须可被 bounded stop"

    def test_immediate_wake_no_scan_before_deadline(self, tmp_path):
        """deadline 到期前，immediate wake 只处理 queue，不触发全局 scan。

        单次 immediate wake 后，确定性确认 immediate queue 已被处理，
        但 scan 在 deadline 到期前不得执行。
        """
        import app.services.sql_temp_janitor as janitor_mod
        janitor = SqlTempJanitor(temp_root=str(tmp_path))

        process_event = threading.Event()
        original_process = janitor._process_immediate_queue
        scan_count = {"n": 0}

        def tracked_scan():
            scan_count["n"] += 1

        def tracked_process():
            original_process()
            process_event.set()

        # 较长 SCAN_INTERVAL 确保 deadline 远未到期，断言不依赖竞态
        with patch.object(janitor_mod, "SCAN_INTERVAL", 2.0):
            with patch.object(janitor, "_scan_and_cleanup", side_effect=tracked_scan), \
                 patch.object(janitor, "_process_immediate_queue", side_effect=tracked_process):
                janitor.start()
                try:
                    work_dir = tmp_path / "metricforge_sql_pre_deadline"
                    work_dir.mkdir()
                    _write_worker_metadata(work_dir, {
                        "pid": None, "createdAt": time.time(),
                        "processCreateTime": None, "state": STATE_COMPLETED,
                    })
                    janitor.schedule_immediate_cleanup(str(work_dir))

                    # 确定性确认 immediate queue 已被处理
                    assert process_event.wait(timeout=2.0), (
                        "immediate queue 必须被处理"
                    )
                    # deadline 未到期，scan 不应执行
                    assert scan_count["n"] == 0, (
                        f"deadline 到期前 immediate wake 不应触发 scan, "
                        f"实际调用 {scan_count['n']} 次"
                    )
                finally:
                    janitor.stop()


# ---------------------------------------------------------------------------
# 7. schedule/stop 竞态 — 确定性覆盖 drain 路径
# ---------------------------------------------------------------------------

class TestScheduleStopRace:
    """schedule 返回 True 后，强制形成 stop 前 queue 未被消费的竞态，
    验证 _drain_queue_to_fallback 处理已接受任务。"""

    def test_schedule_then_stop_drains_accepted_dir(self, tmp_path):
        """强制 schedule→stop 竞态，drain 清理已接受终态目录。

        使用 no-op _process_immediate_queue 阻止正常消费路径，
        确保项目在 stop 时仍在 queue 中，只能由 drain 处理。
        """
        janitor = SqlTempJanitor(temp_root=str(tmp_path))

        # no-op _process_immediate_queue：不 drain queue，不清理
        with patch.object(janitor, "_process_immediate_queue", lambda: None):
            janitor.start()
            try:
                work_dir = tmp_path / "metricforge_sql_race1"
                work_dir.mkdir()
                _write_worker_metadata(work_dir, {
                    "pid": None, "createdAt": time.time(),
                    "processCreateTime": None, "state": STATE_COMPLETED,
                })
                accepted = janitor.schedule_immediate_cleanup(str(work_dir))
                assert accepted, "schedule 应返回 True（janitor 运行中）"
                # 项目仍在 queue 中（_process_immediate_queue 是 no-op）
                # 短暂等待让 janitor 处理完一轮 no-op
                time.sleep(0.05)
                assert len(janitor._immediate_queue) >= 1, (
                    "项目应仍在 queue 中（正常路径被 no-op 阻止）"
                )
            finally:
                janitor.stop()

        # stop 后 drain 清理终态目录
        assert not work_dir.exists(), (
            "已接受的终态目录必须由 drain 清理"
        )
        assert len(janitor._immediate_queue) == 0, (
            "drain 后 queue 必须为空"
        )

    def test_drain_rmtree_outside_lifecycle_lock(self, tmp_path):
        """_drain_queue_to_fallback 中的 rmtree 在 _lifecycle_lock 外执行。"""
        import app.services.sql_temp_janitor as janitor_mod
        janitor = SqlTempJanitor(temp_root=str(tmp_path))

        work_dir = tmp_path / "metricforge_sql_lock_check"
        work_dir.mkdir()
        _write_worker_metadata(work_dir, {
            "pid": None, "createdAt": time.time(),
            "processCreateTime": None, "state": STATE_COMPLETED,
        })

        # Wrap _rmtree to check lock is not held during rmtree
        original_rmtree = janitor_mod._rmtree
        lock_check_results = []

        def checking_rmtree(path):
            # Try non-blocking acquire of lifecycle lock
            acquired = janitor._lifecycle_lock.acquire(blocking=False)
            lock_check_results.append(acquired)
            if acquired:
                janitor._lifecycle_lock.release()
            original_rmtree(path)

        with patch.object(janitor_mod, "_rmtree", checking_rmtree):
            with patch.object(janitor, "_process_immediate_queue", lambda: None):
                janitor.start()
                try:
                    janitor.schedule_immediate_cleanup(str(work_dir))
                    time.sleep(0.05)
                finally:
                    janitor.stop()

        assert len(lock_check_results) > 0, "rmtree 必须被调用"
        for result in lock_check_results:
            assert result, (
                "rmtree 必须在 _lifecycle_lock 外执行（锁不应被持有）"
            )

    def test_schedule_returns_false_when_not_started(self, tmp_path):
        """janitor 未启动时 schedule 返回 False。"""
        janitor = SqlTempJanitor(temp_root=str(tmp_path))
        work_dir = tmp_path / "metricforge_sql_not_started"
        work_dir.mkdir()
        result = janitor.schedule_immediate_cleanup(str(work_dir))
        assert result is False, "未启动的 janitor schedule 应返回 False"

    def test_no_leftover_queue_after_stop(self, tmp_path):
        """stop 后 immediate queue 必须为空（已 drain 或已处理）。"""
        janitor = SqlTempJanitor(temp_root=str(tmp_path))
        janitor.start()
        try:
            for i in range(5):
                work_dir = tmp_path / f"metricforge_sql_leftover_{i}"
                work_dir.mkdir()
                _write_worker_metadata(work_dir, {
                    "pid": None, "createdAt": time.time(),
                    "processCreateTime": None, "state": STATE_COMPLETED,
                })
                janitor.schedule_immediate_cleanup(str(work_dir))
        finally:
            janitor.stop()
        assert len(janitor._immediate_queue) == 0, (
            "stop 后 immediate queue 必须为空"
        )

    def test_drain_skips_termination_failure(self, tmp_path):
        """drain 到 fallback 时，termination_failure 目录不得被删除。"""
        janitor = SqlTempJanitor(temp_root=str(tmp_path))
        with patch.object(janitor, "_process_immediate_queue", lambda: None):
            janitor.start()
            try:
                work_dir = tmp_path / "metricforge_sql_drain_tf"
                work_dir.mkdir()
                _write_worker_metadata(work_dir, {
                    "pid": None, "createdAt": time.time(),
                    "processCreateTime": None, "state": STATE_TERMINATION_FAILURE,
                })
                janitor.schedule_immediate_cleanup(str(work_dir))
                time.sleep(0.05)
            finally:
                janitor.stop()
        assert work_dir.exists(), (
            "termination_failure 目录在 drain 后不得被删除"
        )

    def test_drain_skips_active(self, tmp_path):
        """drain 到 fallback 时，active 目录不得被删除。"""
        janitor = SqlTempJanitor(temp_root=str(tmp_path))
        with patch.object(janitor, "_process_immediate_queue", lambda: None):
            janitor.start()
            try:
                work_dir = tmp_path / "metricforge_sql_drain_active"
                work_dir.mkdir()
                _write_worker_metadata(work_dir, {
                    "pid": 99999, "createdAt": time.time(),
                    "processCreateTime": None, "state": STATE_ACTIVE,
                })
                janitor.schedule_immediate_cleanup(str(work_dir))
                time.sleep(0.05)
            finally:
                janitor.stop()
        assert work_dir.exists(), (
            "active 目录在 drain 后不得被删除"
        )

    def test_drain_skips_starting(self, tmp_path):
        """drain 到 fallback 时，starting 目录不得被删除。"""
        janitor = SqlTempJanitor(temp_root=str(tmp_path))
        with patch.object(janitor, "_process_immediate_queue", lambda: None):
            janitor.start()
            try:
                work_dir = tmp_path / "metricforge_sql_drain_starting"
                work_dir.mkdir()
                _write_worker_metadata(work_dir, {
                    "pid": 99999, "createdAt": time.time(),
                    "processCreateTime": None, "state": STATE_STARTING,
                })
                janitor.schedule_immediate_cleanup(str(work_dir))
                time.sleep(0.05)
            finally:
                janitor.stop()
        assert work_dir.exists(), (
            "starting 目录在 drain 后不得被删除"
        )
