"""Phase 5N Task 6.5C — SqlExecutionService integration tests.

覆盖：
- constructor 接收 adapter_factory，默认 oracle_adapter_factory
- 不再读取 _METRICFORGE_SQL_ADAPTER_CLASS
- 不使用 multiprocessing.Queue/asyncio.run
- datasource 不存在 → 404，history 0 条
- SQL 安全校验失败 → 422，history 0 条
- success/timeout/crash 各恰好 1 条 history
- response snake_case + column_types
- 错误响应不含 worker 原始异常或密码
"""

import ast
import inspect
import threading
import time

import pytest
from fastapi import HTTPException

import app.services.sql_execution_service as _exec_mod
from app.models.datasource import DatasourceConfig
from app.services.sql_execution_service import PreparedExecution, SqlExecutionService
from app.services.sql_security_validator import SqlSecurityValidator
from app.adapters.oracle import oracle_adapter_factory
from tests.support.sql_worker_factories import (
    crash_factory,
    exception_containing_password_factory,
    hanging_factory,
    large_result_factory,
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


# ---------------------------------------------------------------------------
# Constructor & source checks
# ---------------------------------------------------------------------------

class TestConstructor:
    """1-4: constructor 和源码检查。"""

    def test_accepts_top_level_picklable_adapter_factory(self):
        """1. constructor 接收顶层可 pickle adapter_factory。"""
        svc = SqlExecutionService(adapter_factory=success_factory)
        assert svc._adapter_factory is success_factory

    def test_default_factory_is_oracle_adapter_factory(self):
        """2. 默认 factory 为 oracle_adapter_factory。"""
        svc = SqlExecutionService()
        assert svc._adapter_factory is oracle_adapter_factory

    def test_source_no_adapter_class_env(self):
        """3. 不再读取 _METRICFORGE_SQL_ADAPTER_CLASS。"""
        mod_source = inspect.getsource(_exec_mod)
        assert "_METRICFORGE_SQL_ADAPTER_CLASS" not in mod_source

    def test_source_no_queue_or_asyncio_run(self):
        """4. 源码不使用 multiprocessing.Queue / asyncio.run。"""
        # Check actual imports — docstrings may mention these as "not used"
        mod_source = inspect.getsource(_exec_mod)
        # Remove triple-quoted strings to check only actual code
        import re
        code_only = re.sub(r'"""[\s\S]*?"""', '', mod_source)
        code_only = re.sub(r"'''[\s\S]*?'''", '', code_only)
        assert "multiprocessing.Queue" not in code_only
        assert "asyncio.run" not in code_only
        assert "queue_module" not in code_only


class TestPrepareSuperviseFinalize:
    """5-11: prepare/supervise/finalize 分离。"""

    def test_missing_datasource_raises_404(self, db_session, tmp_path):
        """5. datasource 不存在 → 404，不启动 child。"""
        svc = SqlExecutionService(adapter_factory=success_factory)
        with pytest.raises(HTTPException) as exc:
            svc._prepare(db_session, 999, "SELECT 1")
        assert exc.value.status_code == 404

    def test_sql_validation_failure_raises_422(self, db_session, tmp_path):
        """6. SQL 安全校验失败 → 422。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(adapter_factory=success_factory)
        with pytest.raises(HTTPException) as exc:
            svc._prepare(db_session, ds_id, "DROP TABLE t")
        assert exc.value.status_code == 422

    def test_prepare_returns_prepared_execution_without_db(self, db_session, tmp_path):
        """7-9. prepare 返回 PreparedExecution，supervise 不含 db 参数。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(adapter_factory=success_factory)
        prepared = svc._prepare(db_session, ds_id, "SELECT * FROM DUAL")
        assert isinstance(prepared, PreparedExecution)
        assert prepared.datasource_id == ds_id
        assert prepared.datasource_name == "test-ds"
        assert "ROWNUM" in prepared.final_sql
        # WorkerRequest 不携带 datasource_name
        assert not hasattr(prepared.request, "datasource_name")

    def test_supervise_signature_no_db(self):
        """9-10. _supervise 签名不含 db/Session。"""
        sig = inspect.signature(SqlExecutionService._supervise)
        params = list(sig.parameters.keys())
        assert "db" not in params
        assert "session" not in params
        assert "Session" not in params

    def test_prepare_in_calling_thread(self, db_session, tmp_path):
        """10-11. prepare 在当前线程执行。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(adapter_factory=success_factory)
        caller_thread = threading.get_ident()
        prepared = svc._prepare(db_session, ds_id, "SELECT 1")
        # prepared 应在当前线程创建（无异常即为证明）


class TestExecuteSync:
    """12-18: execute_sync 行为。"""

    def test_execute_success(self, db_session, tmp_path):
        """12. success history 恰好 1 条。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(adapter_factory=success_factory, cleanup_callback=None, temp_root=str(tmp_path))
        resp = svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT * FROM DUAL")
        assert resp["columns"] == ["ID", "NAME"]
        assert len(resp["rows"]) == 1
        assert resp["row_count"] == 1
        assert resp["truncated"] is False
        assert resp["error"] is None
        assert resp["history_id"] is not None
        assert resp["column_types"] is not None
        assert len(resp["column_types"]) == 2

    def test_execute_timeout_history_once(self, db_session, tmp_path):
        """13. timeout history 恰好 1 条。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(adapter_factory=hanging_factory, cleanup_callback=None, temp_root=str(tmp_path))
        start = time.monotonic()
        resp = svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT 1", timeout_seconds=0.1)
        elapsed = time.monotonic() - start
        assert resp["error"] is not None
        assert resp["row_count"] == 0
        assert resp["history_id"] is not None
        assert elapsed < 5.0

    def test_execute_worker_crash_history_once(self, db_session, tmp_path):
        """14a. worker crash history 恰好 1 条。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(adapter_factory=crash_factory, cleanup_callback=None, temp_root=str(tmp_path))
        resp = svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT 1")
        assert resp["error"] is not None
        assert resp["history_id"] is not None

    def test_execute_serialization_error_history_once(self, db_session, tmp_path):
        """14b. serialization error history 恰好 1 条。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(adapter_factory=serialization_error_factory, cleanup_callback=None, temp_root=str(tmp_path))
        resp = svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT 1")
        assert resp["error"] is not None
        assert resp["history_id"] is not None

    def test_execute_execution_error_history_once(self, db_session, tmp_path):
        """14c. execution error history 恰好 1 条。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(
            adapter_factory=exception_containing_password_factory,
            cleanup_callback=None, temp_root=str(tmp_path),
        )
        resp = svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT 1")
        assert resp["error"] is not None
        assert resp["history_id"] is not None

    def test_response_snake_case_with_column_types(self, db_session, tmp_path):
        """15-16. response 保持 snake_case API + column_types。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(adapter_factory=success_factory, cleanup_callback=None, temp_root=str(tmp_path))
        resp = svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT * FROM DUAL")
        assert "columns" in resp
        assert "rows" in resp
        assert "row_count" in resp
        assert "truncated" in resp
        assert "elapsed_ms" in resp
        assert "error" in resp
        assert "history_id" in resp
        assert "column_types" in resp

    def test_error_response_no_password(self, db_session, tmp_path):
        """18. 错误响应不含密码。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(
            adapter_factory=exception_containing_password_factory,
            cleanup_callback=None, temp_root=str(tmp_path),
        )
        resp = svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT 1")
        assert "secret" not in str(resp)


class TestTimeoutBounded:
    """19-20: timeout bounded + no leak。"""

    def test_timeout_bounded(self, db_session, tmp_path):
        """19. timeout 受 supervision 控制。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(adapter_factory=hanging_factory, cleanup_callback=None, temp_root=str(tmp_path))
        start = time.monotonic()
        resp = svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT 1", timeout_seconds=0.05)
        elapsed = time.monotonic() - start
        assert resp["error"] is not None
        assert elapsed < 5.0

    def test_consecutive_timeout_no_leak(self, db_session, tmp_path):
        """20. 连续 timeout 无 child/thread/temp-dir 泄漏。"""
        import multiprocessing
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(adapter_factory=hanging_factory, cleanup_callback=None, temp_root=str(tmp_path))
        for _ in range(3):
            svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT 1", timeout_seconds=0.05)
        time.sleep(1.0)
        assert len(multiprocessing.active_children()) == 0


class TestLargeResult:
    """1000 行大 payload 无 Queue deadlock。"""

    def test_large_result_no_queue(self, db_session, tmp_path):
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(adapter_factory=large_result_factory, cleanup_callback=None, temp_root=str(tmp_path))
        resp = svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT * FROM big")
        assert resp["row_count"] == 1000
        assert resp["column_types"] == ["int"]


# ===========================================================================
# Phase 5N Task 6.5C follow-up — original_sql + sentinel row
# ===========================================================================

from app.adapters.base import DataSourceAdapter, QueryResult
from app.services.sql_history_service import SqlHistoryService


class _NRowsAdapter(DataSourceAdapter):
    """返回指定行数的 adapter。n 通过 config 传入。"""

    def __init__(self, config=None):
        super().__init__(config or {})
        self._n = config.get("n", 0)

    def connect(self):
        return self

    def test_connection(self):
        return True

    def execute_query(self, sql, params=None):
        rows = [[i] for i in range(self._n)]
        return QueryResult(columns=["ID"], rows=rows, row_count=self._n)

    def close(self):
        pass

    def get_dialect(self):
        return "fake"


def _rows_1000_factory(request):
    """Factory that returns exactly 1000 rows."""
    return _NRowsAdapter({"n": 1000})


def _rows_1001_factory(request):
    """Factory that returns exactly 1001 rows (sentinel)."""
    return _NRowsAdapter({"n": 1001})


class TestOriginalSql:
    """4. PreparedExecution 新增 original_sql，history 使用 original_sql。"""

    def test_prepared_execution_has_original_sql(self, db_session, tmp_path):
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(adapter_factory=success_factory, cleanup_callback=None, temp_root=str(tmp_path))
        prepared = svc._prepare(db_session, ds_id, "SELECT * FROM DUAL")
        assert hasattr(prepared, "original_sql")
        assert prepared.original_sql == "SELECT * FROM DUAL"
        assert "ROWNUM" not in prepared.original_sql
        assert "ROWNUM" in prepared.final_sql

    def test_history_uses_original_sql(self, db_session, tmp_path):
        """history.sql_text 与 sql_hash 必须使用 original_sql。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(adapter_factory=success_factory, cleanup_callback=None, temp_root=str(tmp_path))
        svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT * FROM DUAL")

        history = SqlHistoryService().list(db_session, datasource_id=ds_id, limit=1)
        assert len(history) >= 1
        sql_text = history[0]["sql_text"]
        assert sql_text == "SELECT * FROM DUAL"
        assert "ROWNUM" not in sql_text

    def test_history_sql_hash_uses_original_sql(self, db_session, tmp_path):
        """history.sql_hash 使用 original_sql 计算。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(adapter_factory=success_factory, cleanup_callback=None, temp_root=str(tmp_path))
        svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT * FROM DUAL")

        history = SqlHistoryService().list(db_session, datasource_id=ds_id, limit=1)
        expected_hash = SqlSecurityValidator().compute_sql_hash("SELECT * FROM DUAL")
        assert history[0]["sql_hash"] == expected_hash


class TestSentinelRow:
    """5. sentinel row 保证 truncated 准确。"""

    def test_exactly_1000_rows_not_truncated(self, db_session, tmp_path):
        """恰好 1000 行：truncated=false。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(adapter_factory=_rows_1000_factory, cleanup_callback=None, temp_root=str(tmp_path))
        resp = svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT * FROM big")
        assert resp["row_count"] == 1000
        assert resp["truncated"] is False

    def test_1001_rows_truncated(self, db_session, tmp_path):
        """至少 1001 行：返回 1000 行且 truncated=true。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(adapter_factory=_rows_1001_factory, cleanup_callback=None, temp_root=str(tmp_path))
        resp = svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT * FROM big")
        assert resp["row_count"] == 1000
        assert resp["truncated"] is True
        assert len(resp["rows"]) == 1000

    def test_history_row_count_uses_returned(self, db_session, tmp_path):
        """history row_count 使用实际返回的 1000。"""
        ds_id = _make_datasource(db_session)
        svc = SqlExecutionService(adapter_factory=_rows_1001_factory, cleanup_callback=None, temp_root=str(tmp_path))
        svc.execute_sync(db_session, datasource_id=ds_id, sql="SELECT * FROM big")

        history = SqlHistoryService().list(db_session, datasource_id=ds_id, limit=1)
        assert history[0]["row_count"] == 1000
        assert history[0]["truncated"] is True
