"""治理待办模型"""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class GovernanceTicket(Base):
    """治理待办——记录缺失指标、缺失语义、口径冲突、表关系不明等问题"""

    __tablename__ = "governance_ticket"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticket_type: Mapped[str] = mapped_column(
        String(50), nullable=False,
        comment="待办类型: missing_metric/missing_semantic/unclear_relation/caliber_conflict/permission_issue/other"
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False, comment="待办标题")
    description: Mapped[str] = mapped_column(Text, nullable=True, comment="详细描述")
    source: Mapped[str] = mapped_column(
        String(50), default="manual_import",
        comment="来源: manual_import/auto_detect/l4_auto_route"
    )
    related_object_type: Mapped[str] = mapped_column(String(50), nullable=True, comment="关联对象类型: table/column/metric/relation")
    related_object_id: Mapped[int] = mapped_column(Integer, nullable=True, comment="关联对象 ID")
    user_question: Mapped[str] = mapped_column(Text, nullable=True, comment="触发问题的原始问题（L4 场景）")
    priority: Mapped[str] = mapped_column(String(20), default="medium", comment="优先级: high/medium/low")
    status: Mapped[str] = mapped_column(
        String(20), default="open",
        comment="状态: open/in_progress/resolved/closed"
    )
    assignee: Mapped[str] = mapped_column(String(100), nullable=True, comment="负责人")
    resolution: Mapped[str] = mapped_column(Text, nullable=True, comment="解决方案")
    resolved_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="解决时间")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    def __repr__(self) -> str:
        return f"<GovernanceTicket(id={self.id}, type={self.ticket_type}, status={self.status})>"
