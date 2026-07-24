"""SQL worker test factories — top-level picklable for spawn context.

All classes and functions are top-level to ensure picklability in the spawn
multiprocessing context. Lambdas and closures are NOT picklable.

Each adapter factory takes a WorkerRequest and returns a DataSourceAdapter.
Worker functions take (adapter_factory, request, work_dir) where work_dir is a Path.
"""

import json
import os
import sys
import tempfile
import time
import uuid
from pathlib import Path

from app.adapters.base import DataSourceAdapter, QueryResult
from app.services.sql_result_serializer import serialize_result
from app.services.sql_supervision import WorkerRequest


# ---------------------------------------------------------------------------
# Fake adapter base
# ---------------------------------------------------------------------------

class _FakeAdapterBase(DataSourceAdapter):
    """Common implementations for fake adapters."""

    def connect(self):
        return self

    def test_connection(self):
        return True

    def get_dialect(self):
        return "fake"


# ---------------------------------------------------------------------------
# Success adapter
# ---------------------------------------------------------------------------

class _SuccessAdapter(_FakeAdapterBase):
    def execute_query(self, sql, params=None):
        return QueryResult(columns=["ID", "NAME"], rows=[[1, "hello"]])

    def close(self):
        pass


def success_factory(request):
    """Return adapter that produces a simple success result."""
    return _SuccessAdapter({})


# ---------------------------------------------------------------------------
# Large result adapter
# ---------------------------------------------------------------------------

class _LargeResultAdapter(_FakeAdapterBase):
    def execute_query(self, sql, params=None):
        rows = [[i] for i in range(1000)]
        return QueryResult(columns=["ID"], rows=rows, row_count=1000)

    def close(self):
        pass


def large_result_factory(request):
    """Return adapter that produces 1000 rows."""
    return _LargeResultAdapter({})


# ---------------------------------------------------------------------------
# Hanging adapter
# ---------------------------------------------------------------------------

class _HangingAdapter(_FakeAdapterBase):
    def execute_query(self, sql, params=None):
        time.sleep(999)
        return QueryResult(columns=[], rows=[])

    def close(self):
        pass


def hanging_factory(request):
    """Return adapter whose execute_query never returns."""
    return _HangingAdapter({})


# ---------------------------------------------------------------------------
# Crash adapter
# ---------------------------------------------------------------------------

class _CrashAdapter(_FakeAdapterBase):
    def execute_query(self, sql, params=None):
        sys.exit(1)

    def close(self):
        pass


def crash_factory(request):
    """Return adapter that calls sys.exit(1) in execute_query."""
    return _CrashAdapter({})


# ---------------------------------------------------------------------------
# Serialization error adapter
# ---------------------------------------------------------------------------

class _SerializationErrorAdapter(_FakeAdapterBase):
    def execute_query(self, sql, params=None):
        return QueryResult(columns=["x"], rows=[[object()]])

    def close(self):
        pass


def serialization_error_factory(request):
    """Return adapter that produces unserializable result."""
    return _SerializationErrorAdapter({})


# ---------------------------------------------------------------------------
# Exception containing password adapter
# ---------------------------------------------------------------------------

class _ExceptionWithPasswordAdapter(_FakeAdapterBase):
    def execute_query(self, sql, params=None):
        raise Exception(f"auth failed for {self.config.get('password', '')}")

    def close(self):
        pass


def exception_containing_password_factory(request):
    """Return adapter that raises exception containing password text."""
    return _ExceptionWithPasswordAdapter({"password": request.password})


# ---------------------------------------------------------------------------
# Close order adapter
# ---------------------------------------------------------------------------

class _CloseOrderAdapter(_FakeAdapterBase):
    def execute_query(self, sql, params=None):
        return QueryResult(columns=["ID", "NAME"], rows=[[1, "hello"]])

    def close(self):
        marker_path = self.config.get("marker_path")
        if marker_path:
            try:
                Path(marker_path).write_text("closed")
            except Exception:
                pass


def close_order_factory(request):
    """Return adapter whose close() writes a marker file."""
    marker_path = os.path.join(
        tempfile.gettempdir(), f"metricforge_close_{uuid.uuid4().hex}.flag"
    )
    return _CloseOrderAdapter({"marker_path": marker_path})


# ---------------------------------------------------------------------------
# Custom worker functions (edge cases that can't be adapter factories)
# ---------------------------------------------------------------------------

def exit_zero_without_result_worker(adapter_factory, request, work_dir):
    """Exit 0 without writing a result file."""
    sys.exit(0)


def corrupt_result_worker(adapter_factory, request, work_dir):
    """Write invalid JSON to result.json."""
    work_dir = Path(work_dir)
    (work_dir / "result.json").write_text("not valid json {{{")


def empty_result_worker(adapter_factory, request, work_dir):
    """Write empty string to result.json."""
    work_dir = Path(work_dir)
    (work_dir / "result.json").write_text("")


def oversized_result_worker(adapter_factory, request, work_dir):
    """Write oversized content to result.json."""
    work_dir = Path(work_dir)
    (work_dir / "result.json").write_text("x" * (11 * 1024 * 1024))


def close_order_worker(adapter_factory, request, work_dir):
    """Call adapter.close(), write close.flag, then atomically publish result.json.

    Proves adapter.close() happens before result publish.
    """
    work_dir = Path(work_dir)
    adapter = adapter_factory(request)
    result = adapter.execute_query(request.sql)
    payload = serialize_result(result.columns, result.rows)
    adapter.close()
    # Write close.flag AFTER adapter.close()
    (work_dir / "close.flag").write_text("closed")
    # THEN atomically publish result.json
    tmp_path = work_dir / "result.tmp"
    result_path = work_dir / "result.json"
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, result_path)


# ---------------------------------------------------------------------------
# Spawn smoke test entry point
# ---------------------------------------------------------------------------

def _spawn_smoke():
    """Top-level entry point for spawn import test.

    Verifies that factories are importable and callable in a fresh spawn process.
    """
    req = WorkerRequest(
        adapter_type="fake",
        host="localhost",
        port=1521,
        service_name=None,
        sid=None,
        username="user",
        password="secret",
        dialect="fake",
        lib_dir=None,
        sql="SELECT 1",
    )
    adapter = success_factory(req)
    result = adapter.execute_query(req.sql)
    assert result.columns == ["ID", "NAME"]
    assert result.rows == [[1, "hello"]]


# ---------------------------------------------------------------------------
# Outer watchdog — top-level picklable function for consecutive spawn tests
# ---------------------------------------------------------------------------

def consecutive_spawn_orchestrator(num_iterations, tmp_path_str, timeout_per_run=15.0):
    """Run consecutive spawn supervisions in an outer process.

    Top-level picklable function for spawn context. Runs num_iterations
    consecutive _supervise_sync calls with success_factory. Exits 0 on
    success, 1 on failure. Prints results for parent to read.
    """
    import sys
    from pathlib import Path
    from app.services.sql_supervision import _supervise_sync

    tmp_path = Path(tmp_path_str)
    for i in range(num_iterations):
        sub_dir = tmp_path / f"orch_run_{i}"
        sub_dir.mkdir(parents=True, exist_ok=True)
        req = WorkerRequest(
            adapter_type="fake", host="localhost", port=1521,
            service_name=None, sid=None, username="user",
            password="secret", dialect="fake", lib_dir=None,
            sql="SELECT 1",
        )
        outcome = _supervise_sync(success_factory, req, timeout_per_run, work_dir=str(sub_dir))
        if "columns" not in outcome:
            print(f"FAIL: run {i} outcome={outcome}", flush=True)
            sys.exit(1)
    print("OK", flush=True)
    sys.exit(0)
