"""字段语义模型（业务别名、枚举值解释）"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class FieldSemantic(Base):
    """字段语义——字段的业务含义、别名、枚举值解释"""

    __tablename__ = "field_semantic"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    column_id: Mapped[int] = mapped_column(Integer, ForeignKey("column_metadata.id"), unique=True, nullable=False, comment="关联字段")
    business_alias: Mapped[str] = mapped_column(String(200), nullable=True, comment="业务别名")
    meaning: Mapped[str] = mapped_column(Text, nullable=True, comment="字段含义说明")
    unit: Mapped[str] = mapped_column(String(100), nullable=True, comment="单位")
    enum_values: Mapped[str] = mapped_column(Text, nullable=True, comment="枚举值及含义（JSON 对象，如 {\"0\":\"无效\",\"1\":\"有效\"}）")
    data_quality_note: Mapped[str] = mapped_column(Text, nullable=True, comment="数据质量说明")
    is_governed: Mapped[bool] = mapped_column(Boolean, default=False, comment="是否已完成治理")
    governed_by: Mapped[str] = mapped_column(String(100), nullable=True, comment="治理负责人")
    governed_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="治理时间")

    # 关联
    column = relationship("ColumnMetadata", back_populates="semantic")

    def __repr__(self) -> str:
        return f"<FieldSemantic(id={self.id}, alias={self.business_alias})>"
