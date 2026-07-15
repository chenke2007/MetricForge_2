"""SqlValidator — 基于元数据的 SQL 可信校验门。

Phase 5M Task 3:
使用 sqlglot 解析 LLM 返回的 SQL，基于 resolved_metadata 校验：
- 字段是否存在（FIELD_NOT_FOUND）
- 表名是否 schema 限定（TABLE_SCHEMA_MISSING）
- 是否非 SELECT/DML/DDL（DDL_DML_NOT_ALLOWED）
- 表引用是否在范围内（UNKNOWN_TABLE_REFERENCE）
- 分区表是否含 pt 过滤（PARTITION_FILTER_MISSING）
- 字段大小写是否匹配元数据（CASE_MISMATCH）

所有校验规则全部为 error，不允许 warning 豁免。
解析失败时 fail closed，不允许放行。
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

import sqlglot
from sqlglot import exp

logger = logging.getLogger(__name__)


# ── SQL 解析辅助函数 ──────────────────────────────────────────────────────────


def _safe_parse(sql: str):
    """安全解析 SQL，失败时返回 None（fail closed）。"""
    try:
        return sqlglot.maybe_parse(sql)
    except Exception as exc:
        logger.warning("sqlglot parse failed: %s", exc)
        return None


def _get_cte_names(tree) -> set[str]:
    """从 AST 中提取 CTE 名称（统一小写）。

    sqlglot 30.x: With 子句在 tree.args['with_'] 中，
    CTE 的 alias 是 str 类型，直接作为 CTE 名。
    """
    cte_names: set[str] = set()
    with_clause = tree.args.get("with_")
    if with_clause:
        for cte in with_clause.expressions:
            if isinstance(cte, exp.CTE):
                if cte.alias:
                    cte_names.add(cte.alias.lower())
    return cte_names


def _extract_real_tables(tree, cte_names: set[str]) -> list[dict]:
    """从 AST 中提取真实表引用，排除 CTE 名。

    返回列表，每项包含：
    - name: 表名（不含 schema）
    - db: schema 名，无 schema 时为 None
    - full_name: schema.table 或 table
    - has_schema: bool
    """
    tables: list[dict] = []
    seen: set[str] = set()

    for node in tree.find_all(exp.Table):
        table_name = node.name
        if not table_name:
            continue
        # 排除 CTE 名
        if table_name.lower() in cte_names:
            continue
        # 排除子查询别名（sqlglot 的 Table 节点可能也标记别名，
        # 但通过 cte_names 已经足够排除多数情况）
        db_name = node.db or None

        key = table_name.lower()
        if key not in seen:
            seen.add(key)
            tables.append({
                "name": table_name,
                "db": db_name,
                "full_name": f"{db_name}.{table_name}" if db_name else table_name,
                "has_schema": db_name is not None,
            })

    return tables


def _extract_columns_from_sql(tree) -> list[str]:
    """从 AST 的 SELECT/WHERE/GROUP BY/ORDER BY 中提取字段名。

    返回字段名字符串列表（去重，保留原始大小写）。
    排除 * 号。
    """
    columns: list[str] = []
    seen: set[str] = set()

    for node in tree.find_all(exp.Column):
        col_name = node.name
        if not col_name or col_name == "*":
            continue
        key = col_name.lower()
        if key not in seen:
            seen.add(key)
            columns.append(col_name)

    return columns


def _extract_column_refs(tree) -> list[tuple[exp.Column, str, bool]]:
    """从 AST 提取所有 Column 引用，保留节点身份、名称和 quoted 状态。

    返回 [(Column node, 列名, quoted)], 不去重。同一 SQL 中 quoted 与 unquoted
    同名字段被视为不同 AST 引用，应分别校验。
    """
    refs: list[tuple[exp.Column, str, bool]] = []
    for node in tree.find_all(exp.Column):
        col_name = node.name
        if not col_name or col_name == "*":
            continue
        quoted = bool(node.this.quoted) if isinstance(node.this, exp.Identifier) else False
        refs.append((node, col_name, quoted))
    return refs


def _collect_projection_aliases(select: exp.Select) -> list[tuple[str, bool]]:
    """提取单个 SELECT 查询块中的显式投影别名 (name, quoted)。"""
    aliases: list[tuple[str, bool]] = []
    for expr in select.expressions:
        if not isinstance(expr, exp.Alias):
            continue
        alias_arg = expr.args.get("alias")
        if isinstance(alias_arg, exp.Identifier):
            aliases.append((alias_arg.name, bool(alias_arg.quoted)))
        elif alias_arg:
            aliases.append((str(alias_arg), False))
        elif expr.alias:
            aliases.append((expr.alias, False))
    return aliases


def _oracle_identifier_key(name: str, quoted: bool) -> str:
    """按 Oracle 规则规范化标识符。

    - 未加引号标识符：Oracle 自动转大写
    - 显式加双引号标识符：保持原样
    """
    return name if quoted else name.upper()


def _identifier_matches(name: str, quoted: bool, aliases: list[tuple[str, bool]]) -> bool:
    """按 Oracle 标识符规则判断 name 是否与 aliases 中某一项匹配。

    未加引号与全大写加引号等价；小写加引号与未加引号不等价。
    """
    key = _oracle_identifier_key(name, quoted)
    return any(_oracle_identifier_key(alias_name, alias_quoted) == key for alias_name, alias_quoted in aliases)


def _nearest_select(node: exp.Expression) -> exp.Select | None:
    """返回节点最近的 exp.Select 祖先。如果不在任何 SELECT 内，返回 None。"""
    parent = node.parent
    while parent is not None:
        if isinstance(parent, exp.Select):
            return parent
        parent = parent.parent
    return None


def _order_by_alias_column_ids(tree) -> set[int]:
    """收集各 SELECT 块自己的 ORDER BY 中合法引用本块投影别名的 Column 节点 id。

    只豁免同时满足以下条件的 Column：
    1. 无表限定（table 为空）
    2. 位于当前 SELECT 查询块自己的 ORDER BY 子树
    3. 最近的 exp.Select 祖先就是当前 SELECT（防止嵌套子查询中的列被错误继承）
    4. 匹配该 SELECT 的投影别名

    不跨 SELECT 块共享 alias 白名单。
    """
    allowed: set[int] = set()
    for select in tree.find_all(exp.Select):
        aliases = _collect_projection_aliases(select)
        if not aliases:
            continue
        order = select.args.get("order")
        if order is None:
            continue
        for col in order.find_all(exp.Column):
            if col.table:
                continue
            if _nearest_select(col) is not select:
                continue
            quoted = bool(col.this.quoted) if isinstance(col.this, exp.Identifier) else False
            if _identifier_matches(col.name, quoted, aliases):
                allowed.add(id(col))
    return allowed


def has_ddl(sql: str) -> bool:
    """检查 SQL 是否包含 DDL/DML 操作。

    先用 sqlglot 做 AST 级别检测，再 fallback 到正则检查。
    """
    # sqlglot 检测
    try:
        tree = sqlglot.maybe_parse(sql)
    except Exception:
        return True  # fail closed

    if tree is None:
        return True  # fail closed

    # DDL/DML expression 类型（sqlglot 30.x: TruncateTable, not Truncate）
    ddl_dml_types = {
        exp.Delete, exp.Update, exp.Insert, exp.Drop,
        exp.Alter, exp.Create, exp.TruncateTable,
    }

    statements = tree if isinstance(tree, (list, tuple)) else [tree]
    for stmt in statements:
        if type(stmt) in ddl_dml_types:
            return True

    # 递归检测树中是否包含 DDL/DML 节点（有些嵌套在 script 中）
    for dml_type in ddl_dml_types:
        if list(tree.find_all(dml_type)):
            return True

    # 正则兜底：检查是否包含 DDL/DML 关键字
    ddl_pattern = re.compile(
        r'\b(DELETE\s+|UPDATE\s+|INSERT\s+INTO\s+|DROP\s+TABLE\s+|'
        r'ALTER\s+TABLE\s+|CREATE\s+TABLE\s+|TRUNCATE\s+)',
        re.IGNORECASE,
    )
    if ddl_pattern.search(sql):
        return True

    # 检测是否以 SELECT 或 WITH 开头
    stripped = sql.strip().upper()
    if stripped.startswith("SELECT") or stripped.startswith("WITH"):
        return False

    return True


def _check_has_partition_filter(tree, partition_field: str = "pt") -> bool:
    """检查 AST 的 WHERE 子句中是否包含分区字段过滤。

    同时检查顶层 WHERE 和 CTE 子查询的 WHERE。
    """
    if tree is None:
        return False

    # 收集所有需要检查的 WHERE 子句
    # 1. 主查询的 WHERE
    wheres_to_check: list[exp.Where] = []
    main_where = tree.args.get("where")
    if main_where is not None:
        wheres_to_check.append(main_where)

    # 2. CTE 子查询的 WHERE
    with_clause = tree.args.get("with_")
    if with_clause:
        for cte in with_clause.expressions:
            if isinstance(cte, exp.CTE):
                sub_select = cte.this
                if isinstance(sub_select, exp.Select):
                    sub_where = sub_select.args.get("where")
                    if sub_where is not None:
                        wheres_to_check.append(sub_where)

    for where in wheres_to_check:
        if _where_has_partition_filter(where, partition_field):
            return True

    return False


def _where_has_partition_filter(where, partition_field: str = "pt") -> bool:
    """检查单个 WHERE 子句中是否包含分区字段过滤。"""
    # 查找 pt = '...' 条件
    for eq_node in where.find_all(exp.EQ):
        left, right = eq_node.left, eq_node.right
        for side in (left, right):
            if isinstance(side, exp.Column):
                if side.name.lower() == partition_field.lower():
                    return True

    # 查找 PT IN (...) 条件（sqlglot 30.x: In 使用 .this 而非 .left）
    for in_node in where.find_all(exp.In):
        left = in_node.this if hasattr(in_node, 'this') else getattr(in_node, 'left', None)
        if left is not None and isinstance(left, exp.Column) and left.name.lower() == partition_field.lower():
            return True

    # 查找 pt > / < / >= / <= 范围条件
    for pred_node in where.find_all(exp.Predicate):
        if isinstance(pred_node, (exp.GT, exp.GTE, exp.LT, exp.LTE, exp.NEQ)):
            left = pred_node.left
            if isinstance(left, exp.Column) and left.name.lower() == partition_field.lower():
                return True

    return False


# ── 元数据查找结构 ─────────────────────────────────────────────────────────────


class _MetadataIndex:
    """快速查找的元数据索引。"""

    __slots__ = ("columns_lower", "columns_original", "tables_full",
                 "tables_lower", "partition_fields", "has_partition_table",
                 "metadata_by_full_name")

    def __init__(self, resolved_metadata: list):
        self.columns_lower: dict[str, str] = {}       # 小写列名 → 原始列名
        self.columns_original: set[str] = set()       # 原始大小写的列名集合
        self.tables_full: set[str] = set()             # schema.table 集合
        self.tables_lower: set[str] = set()            # 表名小写集合
        self.partition_fields: set[str] = set()        # 分区字段小写名集合
        self.has_partition_table: bool = False          # 是否有分区表
        self.metadata_by_full_name: dict[str, Any] = {}  # full_name → ResolvedTableMetadata

        for table in resolved_metadata:
            full_name = f"{table.schema_name}.{table.table_name}" if table.schema_name else table.table_name
            self.tables_full.add(full_name.upper())
            self.tables_lower.add(table.table_name.lower())
            self.metadata_by_full_name[full_name.upper()] = table

            for col in table.columns:
                self.columns_lower[col.column_name.lower()] = col.column_name
                self.columns_original.add(col.column_name)
                if col.is_partition:
                    self.partition_fields.add(col.column_name.lower())
                    self.has_partition_table = True

    def column_exists(self, name: str) -> bool:
        """检查列名（大小写不敏感）是否存在于元数据中。"""
        return name.lower() in self.columns_lower

    def table_exists(self, name: str) -> bool:
        """检查表名（大小写不敏感）是否在已解析元数据范围内。"""
        return name.upper() in self.tables_full or name.lower() in self.tables_lower

    def full_table_in_scope(self, full_name: str) -> bool:
        """检查 schema.table 完整名是否在已解析元数据范围内。"""
        return full_name.upper() in self.tables_full

    def get_original_column_name(self, lower_name: str) -> str | None:
        """返回元数据中列名的原始大小写。"""
        return self.columns_lower.get(lower_name)


# ── SqlValidationResult ────────────────────────────────────────────────────────


class SqlValidationResult:
    """SQL 校验结果。"""

    def __init__(self, valid: bool, errors: list[dict], warnings: list[str], sql: str):
        self.valid = valid
        self.errors = errors
        self.warnings = warnings
        self.sql = sql

    def to_dict(self) -> dict:
        return {
            "errors": self.errors,
            "warnings": self.warnings,
            "sql": self.sql,
        }


# ── SqlValidator ────────────────────────────────────────────────────────────────


class SqlValidator:
    """基于元数据的 SQL 校验器。

    在 LLM 返回 SQL 后、返回前端前，执行 metadata-based 校验。
    所有校验规则失败时返回 error，不允许 warning 豁免。
    """

    @staticmethod
    def validate(
        sql_plan: dict,
        resolved_metadata: list,
    ) -> SqlValidationResult:
        """执行全量校验。

        Args:
            sql_plan: LLM 返回的 sqlPlan，包含 sql/tables/fields 等。
            resolved_metadata: MetadataResolver 返回的 ResolvedTableMetadata 列表。

        Returns:
            SqlValidationResult: 校验结果。
        """
        sql: str = sql_plan.get("sql", "")
        plan_fields: list[str] = sql_plan.get("fields", [])
        errors: list[dict] = []
        warnings: list[str] = []

        if not sql.strip():
            errors.append({
                "rule": "PARSE_ERROR",
                "message": "SQL 为空",
            })
            return SqlValidationResult(valid=False, errors=errors, warnings=warnings, sql=sql)

        if not resolved_metadata:
            errors.append({
                "rule": "METADATA_MISSING",
                "message": "无元数据可用于校验",
            })
            return SqlValidationResult(valid=False, errors=errors, warnings=warnings, sql=sql)

        # ── 构建元数据索引 ────────────────────────────────────────────────
        meta_index = _MetadataIndex(resolved_metadata)

        # ── 步骤 1: SQL 解析 ──────────────────────────────────────────────
        tree = _safe_parse(sql)
        if tree is None:
            errors.append({
                "rule": "PARSE_ERROR",
                "message": "SQL 解析失败，无法进行进一步校验",
            })
            return SqlValidationResult(valid=False, errors=errors, warnings=warnings, sql=sql)

        # ── 步骤 2: 提取 CTE 名和真实表引用 ───────────────────────────────
        cte_names = _get_cte_names(tree)
        real_tables = _extract_real_tables(tree, cte_names)

        # ── 步骤 3: 提取 SQL 中的字段引用 ──────────────────────────────────
        # 保留 Column AST 节点身份、quoted 状态，用于后续 FIELD_NOT_FOUND 和 CASE_MISMATCH
        column_refs = _extract_column_refs(tree)
        # ORDER BY 中引用本块 SELECT 投影别名是合法的，不应报 FIELD_NOT_FOUND
        allowed_alias_ids = _order_by_alias_column_ids(tree)

        # ── 校验 1: DDL_DML_NOT_ALLOWED ────────────────────────────────────
        if has_ddl(sql):
            errors.append({
                "rule": "DDL_DML_NOT_ALLOWED",
                "message": "SQL 包含 DDL 或 DML 操作，只允许 SELECT 查询",
            })
            # DDL 命中后仍继续检查其他规则，以便一次性返回所有问题

        # ── 校验 2: FIELD_NOT_FOUND ────────────────────────────────────────
        # 检查 sql_plan.fields
        for field in plan_fields:
            if field.strip() and not meta_index.column_exists(field):
                errors.append({
                    "rule": "FIELD_NOT_FOUND",
                    "field": field,
                    "message": f"字段「{field}」不存在于已解析的元数据表中",
                })

        # 检查 SQL 中提取的字段引用（按 AST 节点分别处理）
        for col_node, col_name, _quoted in column_refs:
            if col_name == "*":
                continue
            # 仅当该 Column 节点确实位于其所属 SELECT 自己的 ORDER BY 且匹配本块别名时，才豁免
            if id(col_node) in allowed_alias_ids:
                continue
            if not meta_index.column_exists(col_name):
                errors.append({
                    "rule": "FIELD_NOT_FOUND",
                    "field": col_name,
                    "message": f"SQL 中引用的字段「{col_name}」不存在于已解析的元数据表中",
                })

        # ── 校验 3: TABLE_SCHEMA_MISSING ────────────────────────────────────
        for t in real_tables:
            if not t["has_schema"]:
                # 跳过 CTE 名（已在 _extract_real_tables 中过滤，此处双重保障）
                if t["name"].lower() in cte_names:
                    continue
                errors.append({
                    "rule": "TABLE_SCHEMA_MISSING",
                    "table": t["name"],
                    "message": f"表「{t['name']}」缺少 schema 限定，应为 SCHEMA.{t['name']}",
                })

        # ── 校验 4: UNKNOWN_TABLE_REFERENCE ────────────────────────────────
        for t in real_tables:
            if t["has_schema"]:
                if not meta_index.full_table_in_scope(t["full_name"]):
                    errors.append({
                        "rule": "UNKNOWN_TABLE_REFERENCE",
                        "table": t["full_name"],
                        "message": f"SQL 引用表「{t['full_name']}」不在已解析元数据范围内",
                    })
            else:
                # 无 schema 的表引用——如果不在 CTE 中，可能不是已知表
                if t["name"].lower() not in cte_names and not meta_index.table_exists(t["name"]):
                    errors.append({
                        "rule": "UNKNOWN_TABLE_REFERENCE",
                        "table": t["name"],
                        "message": f"SQL 引用未知表「{t['name']}」，不在已解析元数据范围内",
                    })

        # ── 校验 5: PARTITION_FILTER_MISSING ────────────────────────────────
        if meta_index.has_partition_table:
            # 检查 SQL 引用的表中是否有分区表
            ref_has_partition = False
            for t in real_tables:
                if t["has_schema"]:
                    table_meta = meta_index.metadata_by_full_name.get(t["full_name"].upper())
                else:
                    # 通过小写表名查找
                    table_meta = None
                    for full, meta in meta_index.metadata_by_full_name.items():
                        if meta.table_name.lower() == t["name"].lower():
                            table_meta = meta
                            break
                if table_meta:
                    for col in table_meta.columns:
                        if col.is_partition:
                            ref_has_partition = True
                            break
                if ref_has_partition:
                    break

            if ref_has_partition:
                has_filter = _check_has_partition_filter(tree)
                if not has_filter:
                    pf_names = ", ".join(sorted(meta_index.partition_fields))
                    errors.append({
                        "rule": "PARTITION_FILTER_MISSING",
                        "message": f"分区表缺少分区字段（{pf_names}）过滤条件",
                    })

        # ── 校验 6: CASE_MISMATCH ──────────────────────────────────────────
        # Oracle 未加引号标识符大小写不敏感，因此：
        # - sql_plan.fields 视为未加引号，不再做大小写校验；
        # - SQL AST 中仅显式加双引号的标识符才严格区分大小写。
        # 只有 quoted=True 且大小写与元数据不一致时才报 CASE_MISMATCH。

        # 检查 SQL AST 中显式加引号的字段大小写。
        # Oracle 未加引号标识符大小写不敏感；只有显式加双引号才严格区分。
        # 按 AST 节点逐个校验，不去重，确保 quoted/unquoted 同名字段都能被检查。
        for _col_node, col_name, quoted in column_refs:
            if col_name == "*":
                continue
            if not quoted:
                # 未加引号：Oracle 大小写不敏感，跳过
                continue
            original = meta_index.get_original_column_name(col_name.lower())
            if original and original != col_name:
                errors.append({
                    "rule": "CASE_MISMATCH",
                    "field": col_name,
                    "message": f"字段「{col_name}」大小写不匹配，元数据中为「{original}」",
                })

        return SqlValidationResult(
            valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            sql=sql,
        )


# ── 便捷导出 ────────────────────────────────────────────────────────────────────


def extract_tables(sql: str) -> list[str]:
    """用 sqlglot 提取 SQL 中的真实表引用（排除 CTE 名）。

    返回表名字符串列表（去重，保留原始大小写/限定形式）。
    解析失败时返回空列表。
    """
    tree = _safe_parse(sql)
    if tree is None:
        return []
    cte_names = _get_cte_names(tree)
    tables = _extract_real_tables(tree, cte_names)
    return [t["full_name"] for t in tables]


def extract_columns(sql: str) -> list[str]:
    """提取 SQL 中 SELECT/WHERE/GROUP BY/ORDER BY 中引用的字段。

    返回字段名字符串列表（去重，保留原始大小写）。
    解析失败时返回空列表。
    """
    tree = _safe_parse(sql)
    if tree is None:
        return []
    return _extract_columns_from_sql(tree)
