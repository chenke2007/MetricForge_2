import json
import logging
from openai import OpenAI

from ...models import LlmSetting
from ..key_encryption import decrypt
from .prompt_builder import AiAskPromptBuilder
from .normalizer import AiAskResponseNormalizer
from .validator import validate_ai_ask_response
from ...schemas.ai_ask import (
    AiAskAnalyzeSuccessResponse,
    AiAskAnalyzeErrorResponse,
    AiAskErrorCode,
)

logger = logging.getLogger(__name__)


class AiAskLlmService:
    def analyze(self, request: dict, db) -> AiAskAnalyzeSuccessResponse | AiAskAnalyzeErrorResponse:
        active = db.query(LlmSetting).filter(LlmSetting.is_active == 1).first()
        if not active:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.LLM_NOT_CONFIGURED,
                error_message="没有已启用的 LLM 配置，请先在 LLM 连接管理中启用一个模型",
            )

        api_key = decrypt(active.api_key)
        client = OpenAI(base_url=f"{active.base_url}/v1", api_key=api_key, timeout=60)

        prompt = AiAskPromptBuilder.build(request)
        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": request["question"]},
        ]

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

        normalized = AiAskResponseNormalizer.normalize(parsed)

        # Phase 5L: Force sqlPlan datasource to match the request — LLM may
        # return arbitrary values that would cause downstream data routing errors.
        if isinstance(normalized, dict) and isinstance(normalized.get("sqlPlan"), dict):
            normalized["sqlPlan"]["datasourceId"] = request["datasource_id"]
            normalized["sqlPlan"]["datasourceName"] = request["datasource_name"]

        validation = validate_ai_ask_response(normalized)
        if not validation["valid"]:
            return AiAskAnalyzeErrorResponse(
                error_code=AiAskErrorCode.INVALID_RESPONSE,
                error_message="模型返回的结构化响应未通过校验",
                details={"errors": validation["errors"], "warnings": validation["warnings"]},
            )

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
