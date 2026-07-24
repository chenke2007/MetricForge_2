import json
import logging
from openai import OpenAI
from fastapi import HTTPException
from sqlalchemy.orm import Session

from ...models import LlmSetting
from ...models.ask_models import AskMessage
from ..key_encryption import decrypt
from .metadata_resolver import MetadataResolver
from .prompt_builder import AiAskPromptBuilder
from .normalizer import AiAskResponseNormalizer
from .validator import validate_ai_ask_response
from .sql_validator import SqlValidator
from ...schemas.ai_ask import (
    AiAskAnalyzeSuccessResponse,
    AiAskAnalyzeErrorResponse,
    AiAskErrorCode,
)

logger = logging.getLogger(__name__)


# ── sql_pending narrative sanitizer ─────────────────────────────────────────


def _build_safe_summary(narrative: dict) -> str:
    """构建安全的分析口径说明，不包含事实性结论。

    sql_pending 状态下，LLM 返回的 summary 可能包含未经 SQL 验证的
    事实性结论（百分比、金额、排名等），必须在返回前端前替换为
    口径级别的说明。
    """
    return "已生成待验证 SQL，请在 SQL Workbench 中验证后查看结论。"


def _sanitize_narrative_for_sql_pending(narrative: dict) -> dict:
    """清空事实性结论，只保留口径说明和分析建议。

    Args:
        narrative: LLM 返回的原始 narrative 字典

    Returns:
        清洗后的 narrative 字典：keyFindings/evidence 被清空，
        summary 替换为安全说明，risks/nextQuestions 保留。
    """
    return {
        "summary": _build_safe_summary(narrative),
        "keyFindings": [],
        "evidence": [],
        "risks": narrative.get("risks", []),
        "nextQuestions": narrative.get("nextQuestions", []),
    }


# ── LLM Service ─────────────────────────────────────────────────────────────


class AiAskLlmService:
    def analyze(self, request: dict, db: Session) -> AiAskAnalyzeSuccessResponse | AiAskAnalyzeErrorResponse:
        """公共入口：精确消息绑定 + response_json 持久化 + 异常恢复。

        身份校验（session/role/status）必须先只读完成，校验失败不得修改任何记录。
        身份合法后，_analyze_core 的业务错误、HTTPException 和普通异常
        都会把这条精确 assistant message 标记为 failed。
        """
        session_id = request.get("session_id")
        assistant_message_id = request.get("assistant_message_id")

        # ── 只读身份校验（失败不得修改记录）────────────────────────────────
        msg = db.query(AskMessage).filter(AskMessage.id == assistant_message_id).first()
        if not msg:
            raise HTTPException(404, detail="message not found")
        if msg.session_id != session_id:
            raise HTTPException(422, detail="session mismatch")
        if msg.role != "assistant":
            raise HTTPException(422, detail="wrong role")
        if msg.status != "pending":
            raise HTTPException(422, detail="status not pending")

        # ── 身份合法：后续失败可更新这条精确消息 ────────────────────────────
        bound_msg = msg

        try:
            analysis_result = self._analyze_core(request, db)

            if not analysis_result.ok:
                bound_msg.status = "failed"
                bound_msg.error_message = analysis_result.error_message or "analysis failed"
                db.commit()
                return analysis_result

            # 成功：持久化版本化 response_json
            response_json = json.dumps({
                "schemaVersion": 1,
                "data": analysis_result.data,
            }, ensure_ascii=False)
            bound_msg.response_json = response_json
            bound_msg.status = "completed"
            bound_msg.error_message = None
            db.commit()
            return analysis_result
        except HTTPException:
            self._mark_failed_best_effort(db, assistant_message_id, session_id)
            raise
        except Exception:
            self._mark_failed_best_effort(db, assistant_message_id, session_id)
            raise

    def _mark_failed_best_effort(self, db: Session, message_id: int, session_id: int) -> None:
        """Best-effort 标记 assistant message 为 failed。

        rollback → 按主键重新加载 → 校验 session/role → 标记 failed → commit。
        成功或失败均不向调用者抛异常，保证 analyze() 的裸 raise 始终重新抛出原异常。
        """
        try:
            db.rollback()
            fresh = db.query(AskMessage).filter(
                AskMessage.id == message_id,
                AskMessage.session_id == session_id,
                AskMessage.role == "assistant",
            ).first()
            if not fresh:
                return
            fresh.status = "failed"
            fresh.error_message = "analysis failed"
            db.commit()
        except Exception:
            logger.exception("Failed to persist assistant message failure state")
            try:
                db.rollback()
            except Exception:
                logger.exception("Rollback also failed while marking assistant message failed")

    def _analyze_core(self, request: dict, db) -> AiAskAnalyzeSuccessResponse | AiAskAnalyzeErrorResponse:
        """核心 LLM 分析流程（无会话/身份绑定逻辑）。

        即原 analyze() 的完整流程：metadata resolve → OpenAI → normalizer →
        validator → SQL Trust Gate → sanitize。由公共 analyze() 调用。
        """
        # ── Step 0: 检查 LLM 配置 ──────────────────────────────────────────
        active = db.query(LlmSetting).filter(LlmSetting.is_active == 1).first()
        if not active:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.LLM_NOT_CONFIGURED,
                error_message="没有已启用的 LLM 配置，请先在 LLM 连接管理中启用一个模型",
            )

        # ── Step 1: 解析元数据 ─────────────────────────────────────────────
        resolved = MetadataResolver.resolve(
            datasource_id=request["datasource_id"],
            table_names=request.get("selected_tables", []),
            question=request.get("question", ""),
            db=db,
        )

        # ── Step 2: 无元数据 → 提前返回（不调 LLM）────────────────────────
        if not resolved:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.METADATA_NOT_FOUND,
                error_message="未找到所选表的元数据，请先采集/选择正确数据表",
            )

        # ── Step 3: 构建 prompt（注入元数据）───────────────────────────────
        prompt = AiAskPromptBuilder.build(request, metadata_context=resolved)

        api_key = decrypt(active.api_key)
        client = OpenAI(base_url=f"{active.base_url}/v1", api_key=api_key, timeout=60)

        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": request["question"]},
        ]

        # ── Step 4: 调用 LLM ───────────────────────────────────────────────
        try:
            completion = client.chat.completions.create(
                model=active.model_name,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=0.2,
            )
        except Exception as e:
            logger.exception("LLM 调用失败")
            return self._map_exception(e)

        if not completion.choices or not completion.choices[0].message or not completion.choices[0].message.content:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.INVALID_RESPONSE,
                error_message="模型返回为空或不完整",
            )

        raw_content = completion.choices[0].message.content or ""
        try:
            parsed = json.loads(raw_content)
        except json.JSONDecodeError:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.INVALID_RESPONSE,
                error_message="模型返回的不是合法 JSON",
                details={"raw": raw_content[:500]},
            )

        # ── Step 5: Normalize ───────────────────────────────────────────────
        normalized = AiAskResponseNormalizer.normalize(parsed)

        # ── Step 6: Phase 5L datasource override ────────────────────────────
        if isinstance(normalized, dict) and isinstance(normalized.get("sqlPlan"), dict):
            normalized["sqlPlan"]["datasourceId"] = request["datasource_id"]
            normalized["sqlPlan"]["datasourceName"] = request["datasource_name"]

        # ── Step 7: 结构校验 ────────────────────────────────────────────────
        validation = validate_ai_ask_response(normalized)
        if not validation["valid"]:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.INVALID_RESPONSE,
                error_message="模型返回的结构化响应未通过校验",
                details={"errors": validation["errors"], "warnings": validation["warnings"]},
            )

        # ── Step 8: SQL Trust Gate ──────────────────────────────────────────
        if isinstance(normalized.get("sqlPlan"), dict):
            sql_validation = SqlValidator.validate(normalized["sqlPlan"], resolved)
            if not sql_validation.valid:
                return AiAskAnalyzeErrorResponse(
                    error_code=AiAskErrorCode.INVALID_RESPONSE,
                    error_message="SQL 校验未通过",
                    details={"sqlValidation": sql_validation.to_dict()},
                )

        # ── Step 9: SQL 合法 → 设置 sql_pending 状态 ───────────────────────
        if "narrative" in normalized:
            normalized["narrative"] = _sanitize_narrative_for_sql_pending(normalized["narrative"])
        normalized["narrativeLevel"] = "sql_pending"

        return AiAskAnalyzeSuccessResponse(data=normalized)

    def _map_exception(self, e: Exception) -> AiAskAnalyzeErrorResponse:
        msg = str(e).lower()
        if "timeout" in msg:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.ANALYSIS_TIMEOUT,
                error_message="LLM 响应超时，请稍后重试",
            )
        if "401" in msg or "403" in msg or "auth" in msg or "unauthorized" in msg:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.LLM_AUTH_ERROR,
                error_message="LLM 认证失败，请检查 API Key",
            )
        if "connect" in msg or "connection" in msg or "refused" in msg or "dns" in msg:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.LLM_CONNECTION_ERROR,
                error_message="无法连接到 LLM 服务，请检查 Base URL",
            )
        if "rate" in msg or "quota" in msg or "429" in msg:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.LLM_RATE_LIMIT,
                error_message="LLM 请求频率过高，请稍后重试",
            )
        return AiAskAnalyzeErrorResponse(
            error_code=AiAskErrorCode.UNKNOWN,
            error_message=f"LLM 调用失败（{type(e).__name__}）",
        )
