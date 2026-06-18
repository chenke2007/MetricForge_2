"""指标定义和口径映射模型"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class MetricDefinition(Base):
    """指标定义"""

    __tablename__ = "metric_definition"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    metric_code: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, comment="指标唯一编码")
    metric_name: Mapped[str] = mapped_column(String(200), nullable=False, comment="指标名称")
    metric_name_en: Mapped[str] = mapped_column(String(200), nullable=True, comment="英文名称")
    business_aliases: Mapped[str] = mapped_column(Text, nullable=True, comment="业务别名")
    category: Mapped[str] = mapped_column(String(100), nullable=True, comment="指标分类")
    definition: Mapped[str] = mapped_column(Text, nullable=True, comment="业务定义")
    formula: Mapped[str] = mapped_column(Text, nullable=True, comment="计算公式")
    involved_fields: Mapped[str] = mapped_column(Text, nullable=True, comment="涉及字段（JSON 数组）")
    applicable_dimensions: Mapped[str] = mapped_column(Text, nullable=True, comment="适用维度（JSON 数组）")
    default_time_grain: Mapped[str] = mapped_column(String(50), nullable=True, comment="默认时间粒度")
    default_time_caliber: Mapped[str] = mapped_column(String(100), nullable=True, comment="默认时间口径")
    data_source_id: Mapped[int] = mapped_column(Integer, nullable=True, comment="关联数据源 ID")
    source_table: Mapped[str] = mapped_column(String(200), nullable=True, comment="来源表")
    owner: Mapped[str] = mapped_column(String(100), nullable=True, comment="负责人")
    version: Mapped[str] = mapped_column(String(20), default="1.0", comment="版本号")
    status: Mapped[str] = mapped_column(
        String(20), default="draft",
        comment="状态: draft/pending_review/approved/published/deprecated"
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, comment="启用状态")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="创建时间")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    # 关联
    calibers = relationship("MetricCaliber", back_populates="metric", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<MetricDefinition(id={self.id}, code={self.metric_code}, name={self.metric_name})>"


class MetricCaliber(Base):
    """指标口径映射"""

    __tablename__ = "metric_caliber"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    metric_id: Mapped[int] = mapped_column(Integer, ForeignKey("metric_definition.id"), nullable=False, comment="关联指标")
    caliber_name: Mapped[str] = mapped_column(String(100), nullable=False, comment="口径名称，如自然月、会计期间")
    caliber_rule: Mapped[str] = mapped_column(Text, nullable=True, comment="口径说明（人类可读），如'自然月=每月1日至月末最后一天'")
    filter_template: Mapped[str] = mapped_column(Text, nullable=True, comment="参数化SQL片段，如 TRUNC(report_date, 'MM') = :target_month")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, comment="是否默认口径")

    # 关联
    metric = relationship("MetricDefinition", back_populates="calibers")

    def __repr__(self) -> str:
        return f"<MetricCaliber(id={self.id}, name={self.caliber_name})>"
