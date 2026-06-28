import asyncio
import logging
import time
from fastapi import HTTPException
from sqlalchemy.orm import Session

from .sql_security_validator import SqlSecurityValidator
from .sql_history_service import SqlHistoryService
from .datasource_service import get_adapter_for_datasource

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 30


class SqlExecutionService:
    """SQL 执行编排服务"""

    def __init__(self):
        self.validator = SqlSecurityValidator()
        self.history_service = SqlHistoryService()

    def _raise_if_invalid(self, sql: str):
        """安全校验，失败抛 422"""
        validation = self.validator.validate(sql)
        if not validation.is_valid:
            raise HTTPException(status_code=422, detail={
                "detail": validation.error_message,
                "code": validation.error_code,
            })
        return validation

    async def execute(self, datasource_id: int, sql: str, db: Session) -> dict:
        """异步执行 SQL（供 API 层调用）"""
        validation = self._raise_if_invalid(sql)

        adapter = get_adapter_for_datasource(datasource_id)
        if not adapter:
            raise HTTPException(status_code=404, detail="数据源不存在或不可用")

        final_sql = self.validator.apply_row_limit(validation.sanitized_sql)
        loop = asyncio.get_event_loop()
        start = time.monotonic()

        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(None, adapter.execute_query, final_sql),
                timeout=TIMEOUT_SECONDS,
            )
            elapsed_ms = int((time.monotonic() - start) * 1000)
        except asyncio.TimeoutError:
            elapsed_ms = int(TIMEOUT_SECONDS * 1000)
            history = self._record_history(db, sql, datasource_id, adapter.name if hasattr(adapter, 'name') else str(datasource_id),
                                           status='error', elapsed_ms=elapsed_ms, error_message='查询超时（30秒限制）')
            return self._build_response([], [], 0, False, elapsed_ms, error='查询超时（30秒限制）', history_id=history["id"])
        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            error_msg = getattr(e, 'message', str(e))
            logger.error("SQL 执行失败: %s", error_msg)
            history = self._record_history(db, sql, datasource_id, adapter.name if hasattr(adapter, 'name') else str(datasource_id),
                                           status='error', elapsed_ms=elapsed_ms, error_message=error_msg)
            return self._build_response([], [], 0, False, elapsed_ms, error=error_msg, history_id=history["id"])
        finally:
            try:
                adapter.close()
            except Exception as e:
                logger.warning("关闭数据源连接时出错: %s", e)

        # 成功
        row_count = result.row_count if result.row_count else 0
        is_truncated = (result.row_count or 0) >= self.validator.MAX_RESULT_ROWS
        history = self._record_history(db, sql, datasource_id,
                                       adapter.name if hasattr(adapter, 'name') else str(datasource_id),
                                       status='success', elapsed_ms=elapsed_ms,
                                       row_count=row_count, truncated=is_truncated)
        return self._build_response(
            columns=result.columns or [],
            rows=result.rows or [],
            row_count=row_count,
            truncated=is_truncated,
            elapsed_ms=elapsed_ms,
            history_id=history["id"],
        )

    def execute_sync(self, db: Session, datasource_id: int, sql: str) -> dict:
        """同步执行（测试用）"""
        validation = self._raise_if_invalid(sql)

        adapter = get_adapter_for_datasource(datasource_id)
        if not adapter:
            raise HTTPException(status_code=404, detail="数据源不存在或不可用")

        final_sql = self.validator.apply_row_limit(validation.sanitized_sql)
        start = time.monotonic()

        try:
            result = adapter.execute_query(final_sql)
            elapsed_ms = int((time.monotonic() - start) * 1000)
        except Exception as e:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            error_msg = str(e)
            history = self._record_history(db, sql, datasource_id, str(datasource_id),
                                           status='error', elapsed_ms=elapsed_ms, error_message=error_msg)
            return self._build_response([], [], 0, False, elapsed_ms, error=error_msg, history_id=history["id"])
        finally:
            try:
                adapter.close()
            except Exception:
                pass

        if result.error:
            history = self._record_history(db, sql, datasource_id, str(datasource_id),
                                           status='error', elapsed_ms=elapsed_ms, error_message=result.error)
            return self._build_response([], [], 0, False, elapsed_ms, error=result.error, history_id=history["id"])

        row_count = result.row_count if result.row_count else 0
        is_truncated = (result.row_count or 0) >= self.validator.MAX_RESULT_ROWS
        history = self._record_history(db, sql, datasource_id, str(datasource_id),
                                       status='success', elapsed_ms=elapsed_ms,
                                       row_count=row_count, truncated=is_truncated)
        return self._build_response(
            columns=result.columns or [],
            rows=result.rows or [],
            row_count=row_count,
            truncated=is_truncated,
            elapsed_ms=elapsed_ms,
            history_id=history["id"],
        )

    def _record_history(self, db, sql, datasource_id, datasource_name,
                        status='success', elapsed_ms=None, row_count=None,
                        truncated=False, error_message=None) -> dict:
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

    def _build_response(self, columns, rows, row_count, truncated,
                        elapsed_ms, error=None, history_id=None) -> dict:
        return {
            "columns": columns,
            "rows": rows,
            "row_count": row_count,
            "truncated": truncated,
            "elapsed_ms": elapsed_ms,
            "error": error,
            "history_id": history_id,
        }
