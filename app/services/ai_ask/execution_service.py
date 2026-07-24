"""
Phase 5N Task 7 follow-up — Safe AI Ask SQL Execution Service

状态机：
1. Read-first 身份校验 → 消息存在 / session 匹配 / role=assistant
2. 加载 response_json envelope → 检查 schemaVersion=1、sqlPlan、datasourceId、tables
3. 幂等 + 状态复合校验 → msg.status==completed + narrativeLevel==executed 才幂等
   → streaming 返回 409, pending/failed 返回 422
4. 原子 CAS claim → UPDATE id+status+response_json，失败则退回
5. Post-claim 二次验证 → MetadataResolver + SqlValidator（不信任 analyze 结论）
6. 执行 → SqlExecutionService.execute_sync
7. 检查 exec_result.get("error") 后才会构建 narrative
8. 写回 → 统一 envelope（camelCase queryResult），status=completed，CAS 条件写回
9. 所有 claim 后失败路径由单一 finally 块恢复 status，不得手动恢复
"""

import json
import logging

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ...models.ask_models import AskMessage
from ...schemas.ai_ask import (
    AiAskAnalyzeSuccessResponse,
    AiAskAnalyzeErrorResponse,
    AiAskErrorCode,
)
from ...services.ask_service import _safe_load_response_json
from ..sql_execution_service import SqlExecutionService
from .metadata_resolver import MetadataResolver
from .narrative_builder import build_executed_narrative
from .sql_validator import SqlValidator

logger = logging.getLogger(__name__)

# ── 规范化表名 ────────────────────────────────────────────────────────────


def _normalize_table(name: str) -> str:
    """将表名统一为大写 SCHEMA.TABLE 格式。"""
    return name.upper().strip()


# ── 异常恢复：从 streaming 回到 completed ────────────────────────────────


def _recover_from_streaming(
    db: Session,
    message_id: int,
    original_response_json: str,
) -> None:
    """Best-effort 将卡在 streaming 的消息恢复为 completed。

    约束条件保证不覆盖已由其他请求完成的 executed 响应：
      id == message_id
      status == 'streaming'
      response_json == original_response_json
    """
    try:
        db.rollback()
        db.query(AskMessage).filter(
            AskMessage.id == message_id,
            AskMessage.status == "streaming",
            AskMessage.response_json == original_response_json,
        ).update({"status": "completed"})
        db.commit()
    except Exception:
        logger.exception("Failed to recover message %s from streaming", message_id)
        try:
            db.rollback()
        except Exception:
            logger.exception("Rollback also failed during recovery")


# ── snake_case → camelCase 转换 ──────────────────────────────────────────


def _to_camel_case_query_result(query_result: dict) -> dict:
    """将 SQL 执行结果的 snake_case 字段转为 camelCase。"""
    return {
        "columns": query_result.get("columns", []),
        "rows": query_result.get("rows", []),
        "rowCount": query_result.get("row_count", 0),
        "elapsedMs": query_result.get("elapsed_ms", 0),
        "truncated": query_result.get("truncated", False),
        "historyId": query_result.get("history_id"),
        "columnTypes": query_result.get("column_types", []),
    }


# ── 主入口 ────────────────────────────────────────────────────────────────


def execute_sql_analysis(
    db: Session,
    session_id: int,
    assistant_message_id: int,
) -> AiAskAnalyzeSuccessResponse | AiAskAnalyzeErrorResponse:
    """安全执行 SQL 分析的主入口。

    Args:
        db: 数据库会话
        session_id: 会话 ID（用于身份校验）
        assistant_message_id: assistant 消息 ID（主键加载）

    Returns:
        成功时返回 AiAskAnalyzeSuccessResponse（data 含 queryResult + narrative）
        失败时返回 AiAskAnalyzeErrorResponse（含 errorCode/errorMessage）
    """

    # ═════════════════════════════════════════════════════════════════════
    # Step 1: Read-first 身份校验
    # ═════════════════════════════════════════════════════════════════════

    msg = db.query(AskMessage).filter(AskMessage.id == assistant_message_id).first()
    if not msg:
        raise HTTPException(404, detail="message not found")
    if msg.session_id != session_id:
        raise HTTPException(422, detail="session mismatch")
    if msg.role != "assistant":
        raise HTTPException(422, detail="wrong role")

    # ═════════════════════════════════════════════════════════════════════
    # Step 2: 加载并验证 response_json envelope
    # ═════════════════════════════════════════════════════════════════════

    envelope = _safe_load_response_json(msg.response_json)
    if envelope is None:
        raise HTTPException(422, detail="invalid or unsupported response_json")

    data: dict = envelope.get("data", {})
    narrative_level: str = data.get("narrativeLevel", "")

    # ═════════════════════════════════════════════════════════════════════
    # Step 3: 幂等 + 状态复合校验
    # 只有 msg.status==completed + narrativeLevel==executed 才幂等成功
    # streaming → 409, pending/failed → 422
    # ═════════════════════════════════════════════════════════════════════

    if msg.status == "streaming":
        raise HTTPException(409, detail="message is currently being executed by another request")
    if msg.status in ("pending", "failed"):
        raise HTTPException(422, detail=f"message status is {msg.status}, expected completed")

    if narrative_level == "executed":
        # msg.status == "completed" 已由上方校验保证
        return AiAskAnalyzeSuccessResponse(data=data)

    if narrative_level != "sql_pending":
        raise HTTPException(422, detail=f"unexpected narrativeLevel: {narrative_level}")

    # ═════════════════════════════════════════════════════════════════════
    # 从消息的 response_json 中提取执行计划信息
    # ═════════════════════════════════════════════════════════════════════

    sql_plan: dict = data.get("sqlPlan", {}) or {}
    sql: str | None = sql_plan.get("sql")
    datasource_id: int | None = sql_plan.get("datasourceId")
    tables: list[str] | None = sql_plan.get("tables")

    if not sql:
        raise HTTPException(422, detail="sql plan missing sql")
    if not datasource_id:
        raise HTTPException(422, detail="sql plan missing datasourceId")
    if not tables:
        raise HTTPException(422, detail="sql plan missing tables")

    # ═════════════════════════════════════════════════════════════════════
    # Step 4: 原子 CAS claim
    # ═════════════════════════════════════════════════════════════════════

    original_response_json: str = msg.response_json or ""
    claim_acquired = False

    cas_result = db.query(AskMessage).filter(
        AskMessage.id == assistant_message_id,
        AskMessage.status == "completed",
        AskMessage.response_json == original_response_json,
    ).update({"status": "streaming"})
    db.commit()

    if cas_result != 1:
        db.rollback()
        fresh = db.query(AskMessage).filter(AskMessage.id == assistant_message_id).first()
        if fresh is None:
            raise HTTPException(404, detail="message disappeared after CAS failure")
        if fresh.status == "streaming":
            raise HTTPException(409, detail="message is already being executed by another request")
        fresh_envelope = _safe_load_response_json(fresh.response_json)
        if fresh_envelope is None:
            raise HTTPException(422, detail="message response_json changed")
        fresh_data = fresh_envelope.get("data", {})
        fresh_narrative_level = fresh_data.get("narrativeLevel", "")
        if fresh_narrative_level == "executed":
            return AiAskAnalyzeSuccessResponse(data=fresh_data)
        raise HTTPException(422, detail="message state changed unexpectedly")

    claim_acquired = True

    # ═════════════════════════════════════════════════════════════════════
    # Step 5–9: Claim 后的工作 — 由唯一 finally 块处理 claim 恢复
    # ═════════════════════════════════════════════════════════════════════

    try:
        # Step 5: Post-claim 二次验证 — MetadataResolver
        resolved = MetadataResolver.resolve(
            datasource_id=datasource_id,
            table_names=tables,
            db=db,
        )

        expected_normalized = {_normalize_table(t) for t in tables}
        resolved_normalized = {
            _normalize_table(f"{r.schema_name}.{r.table_name}")
            for r in resolved
        }
        if expected_normalized != resolved_normalized:
            missing = expected_normalized - resolved_normalized
            logger.warning(
                "Metadata mismatch for message %s: missing tables %s",
                assistant_message_id, missing,
            )
            # finally 块会自动恢复 claim
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.METADATA_NOT_FOUND,
                error_message=f"元数据不完整，缺少表：{', '.join(sorted(missing))}",
            )

        # SqlValidator 二次校验
        sql_validation = SqlValidator.validate(sql_plan, resolved)
        if not sql_validation.valid:
            logger.warning(
                "SQL validation failed for message %s: %s",
                assistant_message_id, sql_validation.errors,
            )
            # finally 块会自动恢复 claim
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.INVALID_RESPONSE,
                error_message="SQL 校验未通过",
                details={"sqlValidation": sql_validation.to_dict()},
            )

        # Step 6: 执行 SQL
        exec_service = SqlExecutionService()
        query_result = exec_service.execute_sync(
            db=db,
            datasource_id=datasource_id,
            sql=sql,
        )

        # Step 7: 检查执行错误 — 所有 supervision error 映射为 EXECUTION_ERROR，使用安全固定文案
        if query_result.get("error"):
            logger.warning(
                "SQL execution failed for message %s: %s",
                assistant_message_id, query_result["error"],
            )
            # finally 块会自动恢复 claim
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.EXECUTION_ERROR,
                error_message="查询执行失败",
            )

        # Step 7b: 构建 narrative
        columns = query_result.get("columns", [])
        rows = query_result.get("rows", [])
        is_truncated = query_result.get("truncated", False)
        elapsed_ms = query_result.get("elapsed_ms", 0)

        executed_narrative = build_executed_narrative(
            columns=columns,
            rows=rows,
            is_truncated=is_truncated,
            elapsed_ms=elapsed_ms,
        )

        # Step 8: 写回统一 envelope（camelCase queryResult）
        result_data = dict(data)
        result_data["narrativeLevel"] = "executed"
        result_data["narrative"] = executed_narrative
        result_data["queryResult"] = _to_camel_case_query_result(query_result)

        new_envelope = {
            "schemaVersion": 1,
            "data": result_data,
        }
        new_envelope_json = json.dumps(new_envelope, ensure_ascii=False, default=str)

        # 最终 CAS 写回：仅当 status=streaming 且 response_json 未变时更新
        update_result = db.query(AskMessage).filter(
            AskMessage.id == assistant_message_id,
            AskMessage.status == "streaming",
            AskMessage.response_json == original_response_json,
        ).update({
            "status": "completed",
            "response_json": new_envelope_json,
        })
        db.commit()

        if update_result != 1:
            # CAS 写回失败 — 有其他请求插入了变更，不得覆盖
            logger.warning(
                "Final CAS write-back failed for message %s: expected 1 row, got %s",
                assistant_message_id, update_result,
            )
            # 不设置 claim_acquired=False —— finally 块会处理恢复
            raise HTTPException(409, detail="concurrent update conflict: result already modified")

        # rowcount==1 + commit 成功：清除 claim 标志
        claim_acquired = False
        return AiAskAnalyzeSuccessResponse(data=result_data)

    except HTTPException:
        raise
    except Exception:
        raise
    finally:
        if claim_acquired:
            _recover_from_streaming(db, assistant_message_id, original_response_json)
