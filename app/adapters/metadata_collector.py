"""元数据采集适配器接口

不同数据源分别实现库、表、字段、注释、分区、索引、约束、统计信息采集。
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class SchemaInfo:
    name: str


@dataclass
class TableInfo:
    schema_name: str
    table_name: str
    table_type: str = "TABLE"
    table_comment: str | None = None
    row_count_est: int | None = None
    last_analyzed_at: datetime | None = None
    avg_row_len: int | None = None
    num_blocks: int | None = None


@dataclass
class ColumnInfo:
    column_name: str
    column_type: str
    data_length: int | None = None
    nullable: bool = True
    column_id: int | None = None
    default_value: str | None = None
    comment: str | None = None
    is_primary_key: bool = False
    is_unique_key: bool = False
    is_foreign_key: bool = False


@dataclass
class IndexInfo:
    index_name: str
    index_type: str | None = None
    column_names: str | None = None


@dataclass
class ConstraintInfo:
    constraint_name: str
    constraint_type: str  # P/U/R
    column_names: str | None = None
    ref_table: str | None = None
    ref_columns: str | None = None


@dataclass
class TableStats:
    row_count_est: int | None = None
    last_analyzed_at: datetime | None = None
    avg_row_len: int | None = None
    num_blocks: int | None = None


@dataclass
class ColumnProfile:
    distinct_count: int | None = None
    null_rate: float | None = None
    enum_samples: list[str] = field(default_factory=list)


class MetadataCollector(ABC):
    """元数据采集适配器"""

    def __init__(self, adapter: Any, config: dict):
        self.adapter = adapter
        self.config = config

    @abstractmethod
    def collect_schemas(self) -> list[SchemaInfo]:
        """采集 schema 列表"""
        ...

    @abstractmethod
    def collect_tables(self, schema: str) -> list[TableInfo]:
        """采集指定 schema 下的表元数据"""
        ...

    @abstractmethod
    def collect_columns(self, schema: str, table: str) -> list[ColumnInfo]:
        """采集指定表的字段元数据"""
        ...

    @abstractmethod
    def collect_indexes(self, schema: str, table: str) -> list[IndexInfo]:
        """采集指定表的索引信息"""
        ...

    @abstractmethod
    def collect_constraints(self, schema: str, table: str) -> list[ConstraintInfo]:
        """采集指定表的约束信息"""
        ...

    @abstractmethod
    def collect_table_stats(self, schema: str, table: str) -> TableStats:
        """采集表统计信息"""
        ...

    @abstractmethod
    def collect_column_profile(self, schema: str, table: str, column: str) -> ColumnProfile:
        """采集字段画像（空值率、基数、枚举值）"""
        ...
