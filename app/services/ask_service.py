"""AI 问数编排服务。"""

import json
import logging
from datetime import datetime, timezone
from typing import AsyncGenerator, Optional

from openai import OpenAI
from sqlalchemy.orm import Session

from ..models import AskSession, AskMessage, LlmSetting
from .llm_settings_service import LlmSettingsService
from .schema_context_service import SchemaContextService
from .key_encryption import decrypt as decrypt_key

logger = logging.getLogger(__name__)


class AskService:
    """AI 问数会话与消息服务"""

    def __init__(self):
        self._llm_settings_service = LlmSettingsService()
        self._schema_context = SchemaContextService()

    # ---- Session CRUD ----

    def list_sessions(self, db: Session) -> list[dict]:
        sessions = db.query(AskSession).order_by(AskSession.updated_at.desc()).limit(50).all()
        return [self._session_to_dict(s) for s in sessions]

    def create_session(self, db: Session, title: str = "新对话", llm_setting_id: Optional[int] = None) -> dict:
        # Determine LLM setting
        if llm_setting_id:
            setting = self._llm_settings_service.get(db, llm_setting_id)
            if not setting:
                raise ValueError("LLM 配置不存在")
            model_name = setting["model_name"]
        else:
            active = self._llm_settings_service.get_active(db)
            if not active:
                raise ValueError("没有已启用的 LLM 配置，请先在 LLM 连接管理中启用一个模型")
            model_name = active["model_name"]
            llm_setting_id = active["id"]

        session = AskSession(
            title=title,
            llm_setting_id=llm_setting_id,
            model_name=model_name,
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return self._session_to_dict(session)

    def get_session(self, db: Session, session_id: int) -> Optional[dict]:
        s = db.query(AskSession).filter(AskSession.id == session_id).first()
        if not s:
            return None
        messages = (
            db.query(AskMessage)
            .filter(AskMessage.session_id == session_id)
            .order_by(AskMessage.created_at)
            .all()
        )
        result = self._session_to_dict(s)
        result["messages"] = [self._message_to_dict(m) for m in messages]
        return result

    def update_session(self, db: Session, session_id: int, title: str) -> Optional[dict]:
        s = db.query(AskSession).filter(AskSession.id == session_id).first()
        if not s:
            return None
        s.title = title
        db.commit()
        db.refresh(s)
        return self._session_to_dict(s)

    def delete_session(self, db: Session, session_id: int) -> bool:
        s = db.query(AskSession).filter(AskSession.id == session_id).first()
        if not s:
            return False
        # Delete all messages in session
        db.query(AskMessage).filter(AskMessage.session_id == session_id).delete()
        db.delete(s)
        db.commit()
        return True

    # ---- Messages ----

    def create_message(self, db: Session, session_id: int, content: str) -> dict:
        """创建用户消息 + assistant 占位消息。"""
        s = db.query(AskSession).filter(AskSession.id == session_id).first()
        if not s:
            raise ValueError("会话不存在")

        user_msg = AskMessage(
            session_id=session_id,
            role="user",
            content=content,
            status="completed",
        )
        db.add(user_msg)
        db.flush()

        assistant_msg = AskMessage(
            session_id=session_id,
            role="assistant",
            content="",
            status="pending",
        )
        db.add(assistant_msg)
        db.flush()

        s.message_count = db.query(AskMessage).filter(AskMessage.session_id == session_id).count()
        s.updated_at = datetime.now(timezone.utc)
        db.commit()

        return {
            "user_message": self._message_to_dict(user_msg),
            "assistant_message": self._message_to_dict(assistant_msg),
        }

    def get_messages(self, db: Session, session_id: int) -> list[dict]:
        messages = (
            db.query(AskMessage)
            .filter(AskMessage.session_id == session_id)
            .order_by(AskMessage.created_at)
            .all()
        )
        return [self._message_to_dict(m) for m in messages]

    # ---- SSE Streaming ----

    async def stream_response(self, db: Session, session_id: int, after_message_id: int) -> AsyncGenerator[str, None]:
        """SSE 流式生成 assistant 回复。

        逐 token 产出生成结果，通过 async generator 返回 SSE 格式事件。
        """
        s = db.query(AskSession).filter(AskSession.id == session_id).first()
        if not s:
            yield self._sse_event("error", {"message_id": after_message_id, "error": "会话不存在"})
            return

        # Update assistant message to streaming
        assistant_msg = db.query(AskMessage).filter(AskMessage.id == after_message_id).first()
        if not assistant_msg or assistant_msg.role != "assistant":
            yield self._sse_event("error", {"message_id": after_message_id, "error": "消息不存在"})
            return

        assistant_msg.status = "streaming"
        db.commit()

        # Get active LLM setting directly to access the encrypted api_key
        active_setting = db.query(LlmSetting).filter(LlmSetting.is_active == 1).first()
        if not active_setting:
            assistant_msg.status = "failed"
            assistant_msg.error_message = "没有已启用的 LLM 配置"
            db.commit()
            yield self._sse_event("error", {"message_id": after_message_id, "error": "没有已启用的 LLM 配置，请先在 LLM 连接管理中启用一个模型"})
            return

        # Build messages for LLM API
        api_key = decrypt_key(active_setting.api_key)
        client = OpenAI(base_url=f"{active_setting.base_url}/v1", api_key=api_key, timeout=120)

        # Build system prompt with schema context
        schema_context = self._schema_context.build_context("", db)
        system_content = "你是 MetricForge 数据分析助手。\n" \
                         "你是一个融资租赁数据平台的 SQL 分析助手。" \
                         "请基于数据仓库中的表和字段回答用户问题。\n" \
                         "回答中可以通过 SQL 代码块展示查询逻辑，但不要直接执行任何 SQL。\n" \
                         "使用中文回答。"
        if schema_context:
            system_content += "\n\n" + schema_context

        system_message = {
            "role": "system",
            "content": system_content,
        }

        # Collect conversation history
        history = (
            db.query(AskMessage)
            .filter(AskMessage.session_id == session_id)
            .filter(AskMessage.id <= after_message_id)
            .filter(AskMessage.status == "completed")
            .order_by(AskMessage.created_at)
            .all()
        )

        openai_messages = [system_message]
        for m in history:
            if m.id == after_message_id:
                continue  # skip the assistant placeholder
            openai_messages.append({"role": m.role, "content": m.content})

        yield self._sse_event("meta", {
            "message_id": after_message_id,
            "model": active_setting.model_name,
            "started_at": datetime.now(timezone.utc).isoformat(),
        })

        # Call OpenAI-compatible API
        accumulated = ""
        tokens_prompt = None
        tokens_completion = None

        try:
            stream = client.chat.completions.create(
                model=active_setting.model_name,
                messages=openai_messages,
                stream=True,
                stream_options={"include_usage": True},
            )

            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
                    delta = chunk.choices[0].delta.content
                    accumulated += delta
                    yield self._sse_event("token", {"delta": delta})

                if chunk.usage:
                    tokens_prompt = chunk.usage.prompt_tokens
                    tokens_completion = chunk.usage.completion_tokens

            # Success - save accumulated content
            assistant_msg.content = accumulated
            assistant_msg.status = "completed"
            if tokens_prompt:
                assistant_msg.tokens_prompt = tokens_prompt
            if tokens_completion:
                assistant_msg.tokens_completion = tokens_completion
            db.commit()

            yield self._sse_event("done", {
                "message_id": after_message_id,
                "tokens_prompt": tokens_prompt,
                "tokens_completion": tokens_completion,
            })

        except Exception as e:
            logger.exception("LLM 流式调用失败")
            error_msg = self._sanitize_llm_error(e)
            assistant_msg.status = "failed"
            assistant_msg.error_message = error_msg
            if accumulated:
                assistant_msg.content = accumulated
            db.commit()
            yield self._sse_event("error", {"message_id": after_message_id, "error": error_msg})

    def _sanitize_llm_error(self, e: Exception) -> str:
        msg = str(e).lower()
        if "connect" in msg or "refused" in msg:
            return "无法连接到 LLM 服务，请检查 LLM 配置"
        if "401" in msg or "auth" in msg:
            return "LLM 认证失败"
        if "timeout" in msg:
            return "LLM 响应超时，请稍后重试"
        if "rate" in msg or "quota" in msg:
            return "LLM 请求频率过高，请稍后重试"
        return "LLM 调用失败，请检查配置或稍后重试"

    @staticmethod
    def _sse_event(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    @staticmethod
    def _session_to_dict(s: AskSession) -> dict:
        return {
            "id": s.id,
            "title": s.title,
            "llm_setting_id": s.llm_setting_id,
            "model_name": s.model_name,
            "message_count": s.message_count,
            "created_at": s.created_at.isoformat(),
            "updated_at": s.updated_at.isoformat(),
        }

    @staticmethod
    def _message_to_dict(m: AskMessage) -> dict:
        return {
            "id": m.id,
            "session_id": m.session_id,
            "role": m.role,
            "content": m.content,
            "status": m.status,
            "error_message": m.error_message,
            "tokens_prompt": m.tokens_prompt,
            "tokens_completion": m.tokens_completion,
            "created_at": m.created_at.isoformat(),
        }
