"""数据源配置模型"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class DatasourceConfig(Base):
    """数据源配置"""

    __tablename__ = "datasource_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, comment="数据源名称")
    ds_type: Mapped[str] = mapped_column(String(50), nullable=False, comment="数据源类型: oracle/hive/spark/doris/clickhouse")
    host: Mapped[str] = mapped_column(String(255), nullable=False, comment="主机地址")
    port: Mapped[int] = mapped_column(Integer, nullable=False, comment="端口")
    service_name: Mapped[str] = mapped_column(String(100), nullable=True, comment="Oracle SID 或 Service Name")
    username: Mapped[str] = mapped_column(String(100), nullable=False, comment="只读用户名")
    password_enc: Mapped[str] = mapped_column(String(500), nullable=True, comment="加密后的密码")
    dialect: Mapped[str] = mapped_column(String(50), nullable=False, default="oracle", comment="SQL 方言")
    schema_names: Mapped[str] = mapped_column(Text, nullable=True, comment="关注 schema 列表（逗号分隔）")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, comment="是否启用")
    metadata_schedule_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, comment="是否启用自动元数据采集")
    metadata_schedule_interval_minutes: Mapped[int] = mapped_column(Integer, default=1440, nullable=False, comment="元数据自动采集间隔分钟")
    metadata_schedule_time: Mapped[str] = mapped_column(String(5), nullable=True, comment="每日固定采集时间 HH:MM")
    metadata_next_run_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="下一次自动采集时间")
    metadata_last_scheduled_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="最近一次自动调度时间")
    metadata_last_schedule_status: Mapped[str] = mapped_column(String(30), nullable=True, comment="最近一次自动调度结果")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    # 关联
    tables = relationship("TableMetadata", back_populates="datasource", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<DatasourceConfig(id={self.id}, name={self.name}, type={self.ds_type})>"
