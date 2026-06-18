"""Oracle 19c 元数据采集实现

通过 Oracle 系统视图采集表结构、字段、注释、索引、约束和统计信息。
"""

import logging
from datetime import datetime

from ..adapters.metadata_collector import (
    ColumnInfo,
    ColumnProfile,
    ConstraintInfo,
    IndexInfo,
    MetadataCollector,
    SchemaInfo,
    TableInfo,
    TableStats,
)

logger = logging.getLogger(__name__)


class OracleMetadataCollector(MetadataCollector):
    """Oracle 19c 元数据采集器"""

    def __init__(self, adapter, config: dict):
        super().__init__(adapter, config)
        self._owner = config.get("username", "").upper()

    def collect_schemas(self) -> list[SchemaInfo]:
        """采集所有可用 schema"""
        sql = """
            SELECT DISTINCT owner
            FROM all_tables
            WHERE owner NOT IN (
                'SYS', 'SYSTEM', 'DBSNMP', 'XDB', 'OJVMSYS',
                'WMSYS', 'ORDDATA', 'CTXSYS', 'ORDSYS', 'MDSYS',
                'LBACSYS', 'OUTLN', 'APPQOSSYS', 'GSMADMIN_INTERNAL'
            )
            ORDER BY owner
        """
        result = self.adapter.execute_query(sql)
        return [SchemaInfo(name=row[0]) for row in result.rows]

    def collect_tables(self, schema: str) -> list[TableInfo]:
        """采集指定 schema 下的表和视图元数据"""
        sql = """
            SELECT
                t.table_name,
                t.table_type,
                COALESCE(c.comments, '') AS table_comment
            FROM all_tables t
            LEFT JOIN all_tab_comments c
                ON t.owner = c.owner AND t.table_name = c.table_name
            WHERE t.owner = :schema
            ORDER BY t.table_name
        """
        result = self.adapter.execute_query(sql, {"schema": schema})
        if result.error:
            logger.error("采集表列表失败 (schema=%s): %s", schema, result.error)
            return []

        tables = []
        for row in result.rows:
            tables.append(TableInfo(
                schema_name=schema,
                table_name=row[0],
                table_type=row[1] if row[1] else "TABLE",
                table_comment=row[2] if row[2] else None,
            ))

        # 采集统计信息
        stats = self._collect_bulk_table_stats(schema, [t.table_name for t in tables])
        for t in tables:
            s = stats.get(t.table_name)
            if s:
                t.row_count_est = s.row_count_est
                t.last_analyzed_at = s.last_analyzed_at
                t.avg_row_len = s.avg_row_len
                t.num_blocks = s.num_blocks

        return tables

    def collect_columns(self, schema: str, table: str) -> list[ColumnInfo]:
        """采集指定表的字段元数据"""
        sql = """
            SELECT
                c.column_name,
                c.data_type || CASE
                    WHEN c.data_type IN ('VARCHAR2', 'CHAR') THEN '(' || c.data_length || ')'
                    WHEN c.data_type = 'NUMBER' AND c.data_precision IS NOT NULL
                        THEN '(' || c.data_precision || ',' || NVL(c.data_scale, 0) || ')'
                    ELSE ''
                END AS column_type,
                c.data_length,
                c.nullable,
                c.column_id,
                c.data_default,
                COALESCE(cmt.comments, '') AS comment
            FROM all_tab_columns c
            LEFT JOIN all_col_comments cmt
                ON c.owner = cmt.owner
                AND c.table_name = cmt.table_name
                AND c.column_name = cmt.column_name
            WHERE c.owner = :schema AND c.table_name = :table_name
            ORDER BY c.column_id
        """
        result = self.adapter.execute_query(sql, {"schema": schema, "table_name": table})
        if result.error:
            logger.error("采集字段失败 (%s.%s): %s", schema, table, result.error)
            return []

        # 获取主键和唯一键字段
        pk_columns = self._get_pk_columns(schema, table)
        fk_columns = self._get_fk_columns(schema, table)
        uq_columns = self._get_uq_columns(schema, table)

        columns = []
        for row in result.rows:
            col_name = row[0]
            columns.append(ColumnInfo(
                column_name=col_name,
                column_type=row[1],
                data_length=row[2],
                nullable=(row[3] == "Y"),
                column_id=row[4],
                default_value=row[5],
                comment=row[6] if row[6] else None,
                is_primary_key=col_name in pk_columns,
                is_unique_key=col_name in uq_columns,
                is_foreign_key=col_name in fk_columns,
            ))
        return columns

    def collect_indexes(self, schema: str, table: str) -> list[IndexInfo]:
        """采集指定表的索引信息"""
        sql = """
            SELECT
                i.index_name,
                i.index_type,
                LISTAGG(c.column_name, ',') WITHIN GROUP (ORDER BY c.column_position) AS cols
            FROM all_indexes i
            JOIN all_ind_columns c
                ON i.owner = c.index_owner
                AND i.index_name = c.index_name
                AND i.table_name = c.table_name
            WHERE i.owner = :schema AND i.table_name = :table_name
                AND i.generated = 'N'  -- 排除系统自动生成的索引
            GROUP BY i.index_name, i.index_type
            ORDER BY i.index_name
        """
        result = self.adapter.execute_query(sql, {"schema": schema, "table_name": table})
        if result.error:
            logger.error("采集索引失败 (%s.%s): %s", schema, table, result.error)
            return []

        return [
            IndexInfo(
                index_name=row[0],
                index_type=row[1],
                column_names=row[2],
            )
            for row in result.rows
        ]

    def collect_constraints(self, schema: str, table: str) -> list[ConstraintInfo]:
        """采集指定表的约束信息（主键、外键、唯一约束）"""
        sql = """
            SELECT
                con.constraint_name,
                con.constraint_type,
                cols.column_names,
                con.r_owner,
                rcon.table_name AS ref_table,
                rcols.column_names AS ref_columns
            FROM all_constraints con
            JOIN (
                SELECT constraint_name, owner,
                       LISTAGG(column_name, ',') WITHIN GROUP (ORDER BY position) AS column_names
                FROM all_cons_columns
                WHERE owner = :schema AND table_name = :table_name
                GROUP BY constraint_name, owner
            ) cols ON con.constraint_name = cols.constraint_name
            LEFT JOIN all_constraints rcon
                ON con.r_owner = rcon.owner AND con.r_constraint_name = rcon.constraint_name
            LEFT JOIN (
                SELECT constraint_name, owner,
                       LISTAGG(column_name, ',') WITHIN GROUP (ORDER BY position) AS column_names
                FROM all_cons_columns
                GROUP BY constraint_name, owner
            ) rcols ON rcon.constraint_name = rcols.constraint_name AND rcon.owner = rcols.owner
            WHERE con.owner = :schema AND con.table_name = :table_name
                AND con.constraint_type IN ('P', 'U', 'R')
            ORDER BY con.constraint_type, con.constraint_name
        """
        result = self.adapter.execute_query(sql, {"schema": schema, "table_name": table})
        if result.error:
            logger.error("采集约束失败 (%s.%s): %s", schema, table, result.error)
            return []

        constraints = []
        for row in result.rows:
            constraints.append(ConstraintInfo(
                constraint_name=row[0],
                constraint_type=row[1],
                column_names=row[2],
                ref_table=f"{row[3]}.{row[4]}" if row[4] else None,
                ref_columns=row[5] if row[5] else None,
            ))
        return constraints

    def collect_table_stats(self, schema: str, table: str) -> TableStats:
        """采集单表的统计信息"""
        sql = """
            SELECT
                num_rows,
                last_analyzed,
                avg_row_len,
                blocks
            FROM all_tables
            WHERE owner = :schema AND table_name = :table_name
        """
        result = self.adapter.execute_query(sql, {"schema": schema, "table_name": table})
        if result.error or not result.rows:
            return TableStats()

        row = result.rows[0]
        return TableStats(
            row_count_est=row[0],
            last_analyzed_at=row[1],
            avg_row_len=row[2],
            num_blocks=row[3],
        )

    def _collect_bulk_table_stats(self, schema: str, table_names: list[str]) -> dict[str, TableStats]:
        """批量采集表的统计信息"""
        if not table_names:
            return {}

        # 使用 IN 列表
        placeholders = ", ".join(f"'{t}'" for t in table_names)
        sql = f"""
            SELECT table_name, num_rows, last_analyzed, avg_row_len, blocks
            FROM all_tables
            WHERE owner = :schema AND table_name IN ({placeholders})
        """
        result = self.adapter.execute_query(sql, {"schema": schema})
        if result.error or not result.rows:
            return {}

        stats = {}
        for row in result.rows:
            stats[row[0]] = TableStats(
                row_count_est=row[1],
                last_analyzed_at=row[2],
                avg_row_len=row[3],
                num_blocks=row[4],
            )
        return stats

    def collect_column_profile(self, schema: str, table: str, column: str) -> ColumnProfile:
        """采集字段画像（空值率、基数、枚举值）

        注意：大表上执行此查询可能较慢。建议通过 sample_percent 配置采样率。
        """
        config = self.config
        sample_pct = config.get("collect_profile", {}).get("sample_percent", 100)
        timeout_sec = config.get("collect_profile", {}).get("profile_timeout_seconds", 300)

        sample_clause = f" SAMPLE({sample_pct})" if sample_pct < 100 else ""

        # 空值率和基数
        sql = f"""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN "{column}" IS NULL THEN 1 ELSE 0 END) AS nulls,
                COUNT(DISTINCT "{column}") AS distinct_cnt
            FROM "{schema}"."{table}"{sample_clause}
        """
        result = self.adapter.execute_query(sql)
        if result.error or not result.rows:
            return ColumnProfile()

        row = result.rows[0]
        total = row[0] or 0
        nulls = row[1] or 0
        distinct_cnt = row[2] or 0

        null_rate = nulls / total if total > 0 else 0.0

        # 枚举值采样（对于低基数字段）
        max_samples = config.get("collect_profile", {}).get("max_enum_samples", 20)
        enum_samples = []
        if distinct_cnt <= max_samples * 2:  # 只在低基数时采集
            sql_enum = f"""
                SELECT DISTINCT "{column}" AS val
                FROM "{schema}"."{table}"{sample_clause}
                WHERE "{column}" IS NOT NULL
                ORDER BY val
                FETCH FIRST {max_samples} ROWS ONLY
            """
            enum_result = self.adapter.execute_query(sql_enum)
            if not enum_result.error:
                enum_samples = [str(r[0]) for r in enum_result.rows]

        return ColumnProfile(
            distinct_count=distinct_cnt,
            null_rate=null_rate,
            enum_samples=enum_samples,
        )

    # === 内部辅助方法 ===

    def _get_pk_columns(self, schema: str, table: str) -> set[str]:
        return self._get_constraint_columns(schema, table, "P")

    def _get_fk_columns(self, schema: str, table: str) -> set[str]:
        return self._get_constraint_columns(schema, table, "R")

    def _get_uq_columns(self, schema: str, table: str) -> set[str]:
        return self._get_constraint_columns(schema, table, "U")

    def _get_constraint_columns(self, schema: str, table: str, ctype: str) -> set[str]:
        sql = """
            SELECT cols.column_name
            FROM all_constraints con
            JOIN all_cons_columns cols
                ON con.owner = cols.owner
                AND con.constraint_name = cols.constraint_name
            WHERE con.owner = :schema
                AND con.table_name = :table_name
                AND con.constraint_type = :ctype
        """
        result = self.adapter.execute_query(sql, {
            "schema": schema,
            "table_name": table,
            "ctype": ctype,
        })
        if result.error or not result.rows:
            return set()
        return {row[0] for row in result.rows}
