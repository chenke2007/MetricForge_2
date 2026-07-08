"""MetadataResolver — 基于已采集元数据的表/字段信息服务。

输入 datasource_id + selected_tables（和/或问题文本），
从 TableMetadata / ColumnMetadata / FieldSemantic 查询表结构，
输出结构化的 ResolvedTableMetadata 列表供 PromptBuilder 和 SQL Validator 使用。

找不到元数据时返回空列表（不抛错），由调用方决定 METADATA_NOT_FOUND 路径。
"""

import re
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy.orm import Session

from ...models import TableMetadata, ColumnMetadata, FieldSemantic
from .domain_rules import get_table_hints


# ── 输出结构 ──────────────────────────────────────────────────────────────


@dataclass
class ResolvedColumn:
    """单个字段的解析结果。"""
    column_name: str
    column_type: str
    comment: Optional[str] = None
    is_primary_key: bool = False
    is_partition: bool = False  # 是否为分区字段（由 domain rules 推导）


@dataclass
class ResolvedFieldSemantic:
    """字段语义信息（从 FieldSemantic 表获取）。"""
    column_name: str
    business_alias: Optional[str] = None
    meaning: Optional[str] = None


@dataclass
class ResolvedTableMetadata:
    """单表的完整解析结果。"""
    schema_name: str
    table_name: str
    table_comment: Optional[str] = None
    columns: list[ResolvedColumn] = field(default_factory=list)
    field_semantics: list[ResolvedFieldSemantic] = field(default_factory=list)
    table_rule_hints: list[str] = field(default_factory=list)


# ── Resolver ──────────────────────────────────────────────────────────────


class MetadataResolver:
    """元数据解析器，从已采集的元数据中查询表和字段结构。"""

    # 正则：SCHEMA.TABLE — 全大写字母数字下划线
    SCHEMA_TABLE_PATTERN = re.compile(r'[A-Z][A-Z0-9_]+\.[A-Z][A-Z0-9_]+')

    @staticmethod
    def extract_tables_from_question(question: str) -> list[str]:
        """从问题文本中提取 schema.table 格式的表引用。

        Args:
            question: 用户问题文本

        Returns:
            提取到的 schema.table 字符串列表
        """
        if not question:
            return []
        return MetadataResolver.SCHEMA_TABLE_PATTERN.findall(question)

    @staticmethod
    def resolve(
        datasource_id: int,
        table_names: list[str] | None = None,
        question: str = "",
        db: Session | None = None,
    ) -> list[ResolvedTableMetadata]:
        """解析给定表名（和问题中的表引用），返回元数据列表。

        Args:
            datasource_id: 数据源 ID
            table_names: 用户选中的表名列表（可选）
            question: 用户问题文本（用于从中提取 schema.table 引用）
            db: SQLAlchemy 会话

        Returns:
            ResolvedTableMetadata 列表。表不存在时返回空列表，不抛错。
        """
        if db is None:
            return []

        # 1. 收集所有待解析的表名
        names_to_resolve: set[str] = set()
        if table_names:
            names_to_resolve.update(name.strip() for name in table_names if name.strip())

        # 2. 从问题中提取 SCHEMA.TABLE 格式的表引用
        extracted = MetadataResolver.extract_tables_from_question(question)
        names_to_resolve.update(extracted)

        if not names_to_resolve:
            return []

        # 3. 逐个解析
        results: list[ResolvedTableMetadata] = []
        seen: set[tuple[str, str]] = set()  # (schema_name, table_name) 去重

        for raw_name in names_to_resolve:
            schema_part: str | None = None
            table_part: str = raw_name

            if "." in raw_name:
                parts = raw_name.split(".", 1)
                schema_part = parts[0].strip()
                table_part = parts[1].strip()

            # 查询 TableMetadata
            resolved = MetadataResolver._resolve_table(
                datasource_id=datasource_id,
                schema_name=schema_part,
                table_name=table_part,
                db=db,
            )
            if resolved is not None:
                key = (resolved.schema_name, resolved.table_name)
                if key not in seen:
                    seen.add(key)
                    results.append(resolved)

        return results

    @staticmethod
    def _resolve_table(
        datasource_id: int,
        schema_name: str | None,
        table_name: str,
        db: Session,
    ) -> ResolvedTableMetadata | None:
        """查询单表的元数据。

        先尝试 schema_name.table_name 精确匹配，
        如果 schema_name 为 None 或未匹配到，则按 table_name 模糊匹配。
        """
        table_meta: TableMetadata | None = None

        if schema_name:
            table_meta = (
                db.query(TableMetadata)
                .filter(
                    TableMetadata.datasource_id == datasource_id,
                    TableMetadata.schema_name == schema_name,
                    TableMetadata.table_name == table_name,
                    TableMetadata.is_active == True,
                )
                .first()
            )

        # 如果 schema 精确匹配失败，或不带 schema，按 table_name 匹配
        if table_meta is None:
            table_meta = (
                db.query(TableMetadata)
                .filter(
                    TableMetadata.datasource_id == datasource_id,
                    TableMetadata.table_name == table_name,
                    TableMetadata.is_active == True,
                )
                .first()
            )

        if table_meta is None:
            return None

        # 查询 columns
        columns = (
            db.query(ColumnMetadata)
            .filter(
                ColumnMetadata.table_id == table_meta.id,
                ColumnMetadata.is_active == True,
            )
            .order_by(ColumnMetadata.column_id)
            .all()
        )

        # 查询 field_semantics
        column_ids = [c.id for c in columns]
        semantics_list: list[FieldSemantic] = []
        if column_ids:
            semantics_list = (
                db.query(FieldSemantic)
                .filter(FieldSemantic.column_id.in_(column_ids))
                .all()
            )
        semantics_by_column_id: dict[int, FieldSemantic] = {
            s.column_id: s for s in semantics_list
        }

        # 判断分区字段：如果 domain rules 中定义了分区字段，
        # 且列名匹配，则标记 is_partition = True
        from .domain_rules import get_partition_field

        partition_field = get_partition_field()

        resolved_columns: list[ResolvedColumn] = []
        resolved_semantics: list[ResolvedFieldSemantic] = []
        for col in columns:
            resolved_columns.append(
                ResolvedColumn(
                    column_name=col.column_name,
                    column_type=col.column_type,
                    comment=col.comment,
                    is_primary_key=col.is_primary_key or False,
                    is_partition=(
                        col.column_name.lower() == partition_field.lower()
                    ),
                )
            )

            sem = semantics_by_column_id.get(col.id)
            if sem:
                resolved_semantics.append(
                    ResolvedFieldSemantic(
                        column_name=col.column_name,
                        business_alias=sem.business_alias,
                        meaning=sem.meaning,
                    )
                )

        # 表规则提示
        hints = get_table_hints(table_meta.table_name)

        return ResolvedTableMetadata(
            schema_name=table_meta.schema_name,
            table_name=table_meta.table_name,
            table_comment=table_meta.table_comment,
            columns=resolved_columns,
            field_semantics=resolved_semantics,
            table_rule_hints=hints,
        )
