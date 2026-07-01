from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, Integer, String, Text, ForeignKey
from .base import Base


class ChartDraft(Base):
    """图表草稿"""
    __tablename__ = "chart_draft"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200), nullable=False, default="", comment="草稿标题")
    sql_text = Column(Text, nullable=False, comment="SQL 文本")
    datasource_id = Column(Integer, ForeignKey("datasource_config.id"), nullable=True, comment="关联数据源")
    chart_config = Column(Text, nullable=False, comment="图表配置 JSON")
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
