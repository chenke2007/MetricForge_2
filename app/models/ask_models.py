"""Ask-related SQLAlchemy models: LLM settings, sessions, messages."""

from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, CheckConstraint
from .base import Base


def _utcnow():
    return datetime.now(timezone.utc)


class LlmSetting(Base):
    """LLM 连接配置（API Key 加密存储）"""
    __tablename__ = "llm_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    base_url = Column(String(500), nullable=False)
    api_key = Column(String(500), nullable=False)  # Fernet 加密密文
    model_name = Column(String(100), nullable=False)
    is_active = Column(Integer, nullable=False, default=0)
    last_tested_at = Column(DateTime, nullable=True)
    last_tested_ok = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    updated_at = Column(DateTime, nullable=False, default=_utcnow, onupdate=_utcnow)


class AskSession(Base):
    """AI 问数会话"""
    __tablename__ = "ask_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200), nullable=False, default="新对话")
    llm_setting_id = Column(Integer, ForeignKey("llm_settings.id"), nullable=True)
    model_name = Column(String(100), nullable=False)
    message_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=_utcnow)
    updated_at = Column(DateTime, nullable=False, default=_utcnow, onupdate=_utcnow)


class AskMessage(Base):
    """AI 问数对话消息"""
    __tablename__ = "ask_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey("ask_sessions.id"), nullable=False)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False, default="")
    status = Column(String(20), nullable=False, default="completed")
    error_message = Column(Text, nullable=True)
    tokens_prompt = Column(Integer, nullable=True)
    tokens_completion = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_utcnow)

    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant', 'system')", name="ck_message_role"),
        CheckConstraint("status IN ('pending', 'streaming', 'completed', 'failed')", name="ck_message_status"),
    )
