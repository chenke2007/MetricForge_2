"""Oracle 元数据模型（表、字段、索引、约束）"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class TableMetadata(Base):
    """表元数据"""

    __tablename__ = "table_metadata"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    datasource_id: Mapped[int] = mapped_column(Integer, ForeignKey("datasource_config.id"), nullable=False, comment="所属数据源")
    schema_name: Mapped[str] = mapped_column(String(100), nullable=False, comment="Schema 名称")
    table_name: Mapped[str] = mapped_column(String(200), nullable=False, comment="表名")
    table_comment: Mapped[str] = mapped_column(Text, nullable=True, comment="表注释")
    table_type: Mapped[str] = mapped_column(String(50), default="TABLE", comment="TABLE / VIEW")
    row_count_est: Mapped[int] = mapped_column(Integer, nullable=True, comment="预估行数")
    last_analyzed_at: Mapped[datetime] = mapped_column(DateTime, nullable=True, comment="最近分析时间")
    avg_row_len: Mapped[int] = mapped_column(Integer, nullable=True, comment="平均行长度（字节）")
    num_blocks: Mapped[int] = mapped_column(Integer, nullable=True, comment="块数")
    is_sensitive: Mapped[bool] = mapped_column(Boolean, default=False, comment="是否敏感表")
    collected_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="采集时间")

    # 关联
    datasource = relationship("DatasourceConfig", back_populates="tables")
    columns = relationship("ColumnMetadata", back_populates="table", cascade="all, delete-orphan")
    indexes = relationship("IndexMetadata", back_populates="table", cascade="all, delete-orphan")
    constraints = relationship("ConstraintMetadata", back_populates="table", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<TableMetadata(id={self.id}, {self.schema_name}.{self.table_name})>"


class ColumnMetadata(Base):
    """字段元数据"""

    __tablename__ = "column_metadata"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    table_id: Mapped[int] = mapped_column(Integer, ForeignKey("table_metadata.id"), nullable=False, comment="所属表")
    column_name: Mapped[str] = mapped_column(String(200), nullable=False, comment="字段名")
    column_type: Mapped[str] = mapped_column(String(100), nullable=False, comment="字段类型")
    data_length: Mapped[int] = mapped_column(Integer, nullable=True, comment="长度")
    nullable: Mapped[bool] = mapped_column(Boolean, default=True, comment="是否可空")
    column_id: Mapped[int] = mapped_column(Integer, nullable=True, comment="字段序号")
    default_value: Mapped[str] = mapped_column(String(500), nullable=True, comment="默认值")
    comment: Mapped[str] = mapped_column(Text, nullable=True, comment="字段注释")
    is_primary_key: Mapped[bool] = mapped_column(Boolean, default=False, comment="是否主键")
    is_unique_key: Mapped[bool] = mapped_column(Boolean, default=False, comment="是否唯一键")
    is_foreign_key: Mapped[bool] = mapped_column(Boolean, default=False, comment="是否外键（从 constraint 派生，用于UI快速筛选）")
    distinct_count: Mapped[int] = mapped_column(Integer, nullable=True, comment="不同值数量")
    null_rate: Mapped[float] = mapped_column(Float, nullable=True, comment="空值率")
    enum_samples: Mapped[str] = mapped_column(Text, nullable=True, comment="枚举值样例")
    is_sensitive: Mapped[bool] = mapped_column(Boolean, default=False, comment="是否敏感字段")
    collected_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), comment="采集时间")

    # 关联
    table = relationship("TableMetadata", back_populates="columns")
    semantic = relationship("FieldSemantic", back_populates="column", uselist=False, cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<ColumnMetadata(id={self.id}, {self.column_name})>"


class IndexMetadata(Base):
    """索引元数据"""

    __tablename__ = "index_metadata"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    table_id: Mapped[int] = mapped_column(Integer, ForeignKey("table_metadata.id"), nullable=False, comment="所属表")
    index_name: Mapped[str] = mapped_column(String(200), nullable=False, comment="索引名")
    index_type: Mapped[str] = mapped_column(String(50), nullable=True, comment="索引类型: NORMAL/UNIQUE/BITMAP/FUNCTION-BASED")
    column_names: Mapped[str] = mapped_column(Text, nullable=True, comment="涉及字段列表（逗号分隔）")

    # 关联
    table = relationship("TableMetadata", back_populates="indexes")

    def __repr__(self) -> str:
        return f"<IndexMetadata(id={self.id}, {self.index_name})>"


class ConstraintMetadata(Base):
    """约束/主外键元数据"""

    __tablename__ = "constraint_metadata"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    table_id: Mapped[int] = mapped_column(Integer, ForeignKey("table_metadata.id"), nullable=False, comment="约束表")
    constraint_name: Mapped[str] = mapped_column(String(200), nullable=False, comment="约束名")
    constraint_type: Mapped[str] = mapped_column(String(10), nullable=False, comment="约束类型: P/U/R (Primary/Unique/Foreign)")
    column_names: Mapped[str] = mapped_column(Text, nullable=True, comment="涉及字段（逗号分隔）")
    ref_table: Mapped[str] = mapped_column(String(200), nullable=True, comment="引用表（外键）")
    ref_columns: Mapped[str] = mapped_column(Text, nullable=True, comment="引用字段（逗号分隔）")

    # 关联
    table = relationship("TableMetadata", back_populates="constraints")

    def __repr__(self) -> str:
        return f"<ConstraintMetadata(id={self.id}, {self.constraint_name}, type={self.constraint_type})>"
