from datetime import datetime, timezone

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Integer, String, Text, ForeignKey
from .base import Base


class SqlDraft(Base):
    """查询草稿"""
    __tablename__ = "sql_draft"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200), nullable=False, default="", comment="草稿标题，空字符串表示未命名")
    sql_text = Column(Text, nullable=False, comment="SQL 文本")
    datasource_id = Column(Integer, ForeignKey("datasource_config.id"), nullable=True, comment="关联数据源")
    dialect = Column(String(50), nullable=False, default="oracle", comment="SQL 方言")
    description = Column(Text, nullable=True, comment="描述")
    tags = Column(Text, nullable=True, comment="标签（JSON array）")
    is_template = Column(Boolean, nullable=False, default=False, comment="是否模板")
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class SqlExecutionHistory(Base):
    """执行历史"""
    __tablename__ = "sql_execution_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sql_text = Column(Text, nullable=False, comment="原始 SQL")
    sql_hash = Column(String(64), nullable=False, comment="SHA256(去首尾空白SQL)")
    datasource_id = Column(Integer, ForeignKey("datasource_config.id"), nullable=True, comment="数据源ID")
    datasource_name = Column(String(100), nullable=True, comment="执行时数据源名称（快照）")
    status = Column(String(20), nullable=False, default="success", comment="success / error / cancelled")
    elapsed_ms = Column(Integer, nullable=True, comment="执行耗时（毫秒）")
    row_count = Column(Integer, nullable=True, comment="返回行数")
    truncated = Column(Boolean, nullable=False, default=False, comment="是否因 LIMIT 截断")
    error_message = Column(Text, nullable=True, comment="错误信息")
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        CheckConstraint("status IN ('success', 'error', 'cancelled')", name="ck_history_status"),
    )
