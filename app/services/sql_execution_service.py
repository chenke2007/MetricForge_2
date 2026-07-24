"""SQL 执行编排服务 — spawn supervision 集成。

设计约束：
- 不使用 multiprocessing.Queue、importlib、env adapter hook、asyncio.run
- constructor 接收顶层可 pickle adapter_factory，默认 oracle_adapter_factory
- _prepare 在调用线程执行（使用 db Session）
- _supervise 仅调用 _supervise_sync，参数不含 db/Session
- _finalize 在调用线程执行（写 history）
- async execute: _prepare → asyncio.to_thread(_supervise) → _finalize
- execute_sync: _prepare → _supervise → _finalize（当前线程，不使用 asyncio.run）
- 每个请求最多写一次 history
- datasource 不存在直接 HTTP 404，不写 history
- SQL 安全校验失败直接 HTTP 422，不写 history
- column_types 来源于 supervision outcome 的 columnTypes
- Decimal/date/datetime/bytes 保持 JSON-safe 字符串
- 错误响应不含 worker 原始异常或密码
"""

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Callable

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.datasource import DatasourceConfig
from app.adapters.oracle import oracle_adapter_factory
from .sql_security_validator import SqlSecurityValidator
from .sql_history_service import SqlHistoryService
from .sql_supervision import (
    EXEC_TIMEOUT,
    WorkerRequest,
    _supervise_sync,
    resolve_worker_request,
)
from .sql_temp_janitor import schedule_sql_temp_cleanup

logger = logging.getLogger(__name__)


@dataclass
class PreparedExecution:
    """Prepared execution context，在调用线程中解析。

    request 发给 worker 子进程，只含 final_sql（含 ROWNUM 包装）。
    original_sql 不含 ROWNUM 包装，用于 history。
    """

    request: WorkerRequest
    datasource_name: str
    datasource_id: int
    final_sql: str
    original_sql: str


class SqlExecutionService:
    """SQL 执行编排服务 — spawn supervision 集成。"""

    def __init__(
        self,
        adapter_factory: Callable = oracle_adapter_factory,
        cleanup_callback: Callable[[str], None] | None = schedule_sql_temp_cleanup,
        temp_root: str | None = None,
    ):
        self.validator = SqlSecurityValidator()
        self.history_service = SqlHistoryService()
        self._adapter_factory = adapter_factory
        self._cleanup_callback = cleanup_callback
        self._temp_root = temp_root

    # ------------------------------------------------------------------
    # 校验
    # ------------------------------------------------------------------

    def _raise_if_invalid(self, sql: str):
        """安全校验，失败抛 422。"""
        validation = self.validator.validate(sql)
        if not validation.is_valid:
            raise HTTPException(status_code=422, detail={
                "detail": validation.error_message,
                "code": validation.error_code,
            })
        return validation

    # ------------------------------------------------------------------
    # 三步分离：_prepare → _supervise → _finalize
    # ------------------------------------------------------------------

    def _prepare(self, db: Session, datasource_id: int, sql: str) -> PreparedExecution:
        """校验 SQL + 解析数据源。在调用线程执行（使用 db Session）。

        datasource 不存在 → HTTP 404，不写 history。
        SQL 安全校验失败 → HTTP 422，不写 history。
        original_sql = sanitized SQL（不含 ROWNUM 包装）。
        final_sql = sanitized SQL + ROWNUM sentinel 包装。
        """
        validation = self._raise_if_invalid(sql)
        original_sql = validation.sanitized_sql
        final_sql = self.validator.apply_row_limit(original_sql)
        request = resolve_worker_request(db, datasource_id, final_sql)

        ds = db.query(DatasourceConfig).filter(
            DatasourceConfig.id == datasource_id
        ).first()
        datasource_name = ds.name if ds else str(datasource_id)

        return PreparedExecution(
            request=request,
            datasource_name=datasource_name,
            datasource_id=datasource_id,
            final_sql=final_sql,
            original_sql=original_sql,
        )

    def _supervise(self, prepared: PreparedExecution, timeout: float) -> dict:
        """调用 supervision — 不接触 db/Session。"""
        work_dir = None
        if self._temp_root is not None:
            import tempfile as _tempfile
            work_dir = _tempfile.mkdtemp(prefix="metricforge_sql_", dir=self._temp_root)
        return _supervise_sync(
            self._adapter_factory,
            prepared.request,
            timeout,
            work_dir=work_dir,
            cleanup_callback=self._cleanup_callback,
        )

    def _finalize(
        self,
        db: Session,
        prepared: PreparedExecution,
        outcome: dict,
        elapsed_ms: int,
    ) -> dict:
        """从 outcome 构建响应并记录历史。在调用线程执行。

        history 使用 original_sql（不含 ROWNUM 包装）。
        """
        if "error_code" in outcome:
            error_msg = outcome.get("error", "execution failed")
            history = self._record_history(
                db, prepared.original_sql, prepared.datasource_id,
                prepared.datasource_name,
                status="error", elapsed_ms=elapsed_ms,
                error_message=error_msg,
            )
            return self._build_response(
                [], [], 0, False, elapsed_ms,
                error=error_msg, history_id=history["id"],
            )

        # Success outcome（JSON-safe queryResult from deserialize_result）
        columns = outcome.get("columns", [])
        rows = outcome.get("rows", [])
        row_count = outcome.get("rowCount", 0)
        truncated = outcome.get("truncated", False)
        column_types = outcome.get("columnTypes", [])

        history = self._record_history(
            db, prepared.original_sql, prepared.datasource_id,
            prepared.datasource_name,
            status="success", elapsed_ms=elapsed_ms,
            row_count=row_count, truncated=truncated,
        )
        return self._build_response(
            columns, rows, row_count, truncated, elapsed_ms,
            history_id=history["id"], column_types=column_types,
        )

    # ------------------------------------------------------------------
    # 公共接口
    # ------------------------------------------------------------------

    async def execute(self, datasource_id: int, sql: str, db: Session) -> dict:
        """异步执行 SQL（供 API 层调用）。

        1. 当前 event-loop 线程执行 _prepare
        2. await asyncio.to_thread(_supervise_sync, ...)
        3. 回到 event-loop 线程执行 _finalize
        """
        prepared = self._prepare(db, datasource_id, sql)
        start = time.monotonic()
        outcome = await asyncio.to_thread(self._supervise, prepared, EXEC_TIMEOUT)
        elapsed_ms = int((time.monotonic() - start) * 1000)
        return self._finalize(db, prepared, outcome, elapsed_ms)

    def execute_sync(
        self,
        db: Session,
        datasource_id: int,
        sql: str,
        timeout_seconds: float = EXEC_TIMEOUT,
    ) -> dict:
        """同步执行（AI Ask 调用）。

        在当前线程执行 _prepare → _supervise → _finalize。
        不使用 asyncio.run。
        """
        prepared = self._prepare(db, datasource_id, sql)
        start = time.monotonic()
        outcome = self._supervise(prepared, timeout_seconds)
        elapsed_ms = int((time.monotonic() - start) * 1000)
        return self._finalize(db, prepared, outcome, elapsed_ms)

    # ------------------------------------------------------------------
    # 内部辅助
    # ------------------------------------------------------------------

    def _record_history(
        self, db, sql, datasource_id, datasource_name,
        status="success", elapsed_ms=None, row_count=None,
        truncated=False, error_message=None,
    ) -> dict:
        return self.history_service.create({
            "sql_text": sql,
            "sql_hash": self.validator.compute_sql_hash(sql),
            "datasource_id": datasource_id,
            "datasource_name": datasource_name,
            "status": status,
            "elapsed_ms": elapsed_ms,
            "row_count": row_count,
            "truncated": truncated,
            "error_message": error_message,
        }, db)

    def _build_response(
        self, columns, rows, row_count, truncated,
        elapsed_ms, error=None, history_id=None, column_types=None,
    ) -> dict:
        return {
            "columns": columns,
            "rows": rows,
            "row_count": row_count,
            "truncated": truncated,
            "elapsed_ms": elapsed_ms,
            "error": error,
            "history_id": history_id,
            "column_types": column_types or [],
        }
