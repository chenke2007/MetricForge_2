"""AskMessageToolCall SQLAlchemy model for persisting tool calls associated with ask messages."""

from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from .base import Base


class AskMessageToolCall(Base):
    __tablename__ = "ask_message_tool_calls"

    id = Column(Integer, primary_key=True, autoincrement=True)
    message_id = Column(
        Integer,
        ForeignKey("ask_messages.id"),
        nullable=False,
        index=True,
    )
    tool_name = Column(String(50), nullable=False)
    arguments = Column(Text, nullable=False)
    result = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="success")
    error_message = Column(Text, nullable=True)
    created_at = Column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "message_id": self.message_id,
            "tool_name": self.tool_name,
            "arguments": self.arguments,
            "result": self.result,
            "status": self.status,
            "error_message": self.error_message,
            "created_at": str(self.created_at) if self.created_at else None,
        }
