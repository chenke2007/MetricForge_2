"""历史 SQL 资产模型

⚠️ 阶段 2 启用。此模型仅作数据模型预览，迁移脚本在阶段 2 创建。
"""

# 阶段 2 时取消注释以下代码
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class HistorySqlAsset(Base):
    \"\"\"历史 SQL 资产\"\"\"

    __tablename__ = "history_sql_asset"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, comment="SQL 名称")
    report_name: Mapped[str] = mapped_column(String(200), nullable=True, comment="所属报表")
    description: Mapped[str] = mapped_column(Text, nullable=True, comment="用途说明")
    sql_text: Mapped[str] = mapped_column(Text, nullable=False, comment="SQL 内容")
    dialect: Mapped[str] = mapped_column(String(50), default="oracle", comment="SQL 方言")
    datasource_id: Mapped[int] = mapped_column(Integer, ForeignKey("datasource_config.id"), nullable=True, comment="关联数据源")
    involved_tables: Mapped[str] = mapped_column(Text, nullable=True, comment="涉及表（JSON 数组）")
    involved_metrics: Mapped[str] = mapped_column(Text, nullable=True, comment="涉及指标（JSON 数组）")
    parameters: Mapped[str] = mapped_column(Text, nullable=True, comment="参数定义（JSON）")
    tags: Mapped[str] = mapped_column(Text, nullable=True, comment="标签")
    usage_frequency: Mapped[str] = mapped_column(String(20), default="medium", comment="使用频率: high/medium/low")
    is_template: Mapped[bool] = mapped_column(Boolean, default=False, comment="是否已沉淀为模板")
    reviewed_by: Mapped[str] = mapped_column(String(100), nullable=True, comment="审核人")
    reviewed_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="审核时间")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="创建时间")
"""
