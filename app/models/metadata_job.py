"""元数据采集任务模型"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class MetadataCollectionJob(Base):
    """元数据采集任务记录"""

    __tablename__ = "metadata_collection_job"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    datasource_id: Mapped[int] = mapped_column(Integer, ForeignKey("datasource_config.id"), nullable=False, comment="数据源 ID")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running", comment="running/success/failed/partial_success")
    triggered_by: Mapped[str] = mapped_column(String(100), nullable=True, comment="触发人")
    schema_filter: Mapped[str] = mapped_column(Text, nullable=True, comment="采集 schema 范围")
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now(), comment="开始时间")
    finished_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="结束时间")
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=True, comment="耗时毫秒")
    tables_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="表数量")
    columns_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="字段数量")
    indexes_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="索引数量")
    constraints_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="约束数量")
    collection_mode: Mapped[str] = mapped_column(String(30), nullable=False, default="safe_refresh", comment="采集模式")
    reused_running_job: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, comment="是否复用运行中任务")
    tables_added_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="新增表数量")
    tables_updated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="更新表数量")
    tables_deactivated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="下线表数量")
    columns_added_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="新增字段数量")
    columns_updated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="更新字段数量")
    columns_deactivated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="下线字段数量")
    columns_type_changed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="字段类型变化数量")
    columns_comment_changed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="字段注释变化数量")
    indexes_added_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="新增索引数量")
    indexes_deactivated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="下线索引数量")
    constraints_added_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="新增约束数量")
    constraints_deactivated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="下线约束数量")
    governance_tickets_created_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, comment="本次生成治理待办数量")
    change_summary: Mapped[str] = mapped_column(Text, nullable=True, comment="变更摘要 JSON")
    error_message: Mapped[str] = mapped_column(Text, nullable=True, comment="错误摘要")
    error_details: Mapped[str] = mapped_column(Text, nullable=True, comment="错误详情")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="创建时间")

    datasource = relationship("DatasourceConfig")

    def __repr__(self) -> str:
        return f"<MetadataCollectionJob(id={self.id}, datasource_id={self.datasource_id}, status={self.status})>"
