"""表关系模型（主外键、推荐 join 路径）"""

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class TableRelation(Base):
    """表关系——事实表与维表关联、常用 join 路径"""

    __tablename__ = "table_relation"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    datasource_id: Mapped[int] = mapped_column(Integer, ForeignKey("datasource_config.id"), nullable=False, comment="所属数据源")
    fact_table_id: Mapped[int] = mapped_column(Integer, ForeignKey("table_metadata.id"), nullable=False, comment="事实表")
    dim_table_id: Mapped[int] = mapped_column(Integer, ForeignKey("table_metadata.id"), nullable=False, comment="维表")
    relation_type: Mapped[str] = mapped_column(String(20), default="FK", comment="关联类型: FK/MANUAL/COMMON_JOIN")
    join_condition: Mapped[str] = mapped_column(Text, nullable=True, comment="关联条件")
    join_type: Mapped[str] = mapped_column(String(20), default="LEFT", comment="关联类型: LEFT/INNER/FULL")
    cardinality: Mapped[str] = mapped_column(String(20), default="N:1", comment="基数: N:1/1:N/N:N")
    confidence: Mapped[str] = mapped_column(String(20), default="medium", comment="置信度: high/medium/low")
    description: Mapped[str] = mapped_column(Text, nullable=True, comment="关联说明")
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, comment="是否已验证")

    def __repr__(self) -> str:
        return f"<TableRelation(id={self.id}, fact={self.fact_table_id}, dim={self.dim_table_id})>"
