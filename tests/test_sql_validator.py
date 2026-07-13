"""Phase 5M Task 3 — SQL Trust Gate with sqlglot 测试

覆盖 9 条规则 + 边界场景：
1. FIELD_NOT_FOUND — 虚构字段
2. TABLE_SCHEMA_MISSING — 缺 schema
3. DDL_DML_NOT_ALLOWED — DDL/DML 拦截
4. 合法 SELECT — valid true
5. PARTITION_FILTER_MISSING — 缺分区过滤
6. CTE/JOIN/子查询 — 正确提取表，不误判 CTE
7. UNKNOWN_TABLE_REFERENCE — 引用未选表
8. CASE_MISMATCH — 大小写不匹配
9. json_extract 等复杂表达式不崩溃
"""

import json
import pytest

from app.services.ai_ask.sql_validator import (
    SqlValidator,
    SqlValidationResult,
    extract_tables,
    extract_columns,
    has_ddl,
)
from app.services.ai_ask.metadata_resolver import (
    ResolvedTableMetadata,
    ResolvedColumn,
    ResolvedFieldSemantic,
)


# ── Fixtures ────────────────────────────────────────────────────────────────────


@pytest.fixture
def base_table():
    """基表：DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"""
    columns = [
        ResolvedColumn(column_name="PT", column_type="VARCHAR", comment="分区字段", is_partition=True),
        ResolvedColumn(column_name="AMT", column_type="NUMBER(18,2)", comment="投放金额"),
        ResolvedColumn(column_name="CUST_TYPE", column_type="VARCHAR(20)", comment="客户类型（小微/中型/大型）"),
        ResolvedColumn(column_name="REGION_CODE", column_type="VARCHAR(10)", comment="区域编码"),
        ResolvedColumn(column_name="REGION_NAME", column_type="VARCHAR(50)", comment="区域名称"),
        ResolvedColumn(column_name="CREATE_DT", column_type="DATE", comment="创建时间"),
    ]
    semantics = [
        ResolvedFieldSemantic(column_name="AMT", business_alias="投放金额", meaning="按客户类型汇总的月度投放总金额"),
    ]
    return ResolvedTableMetadata(
        schema_name="DWHRPT",
        table_name="DWS_RPT_ZCPZ_CYFL_TF_M",
        table_comment="投放资产分类月度快照表",
        columns=columns,
        field_semantics=semantics,
        table_rule_hints=["DWS_: 按主题汇总的宽表，通常按日分区"],
    )


@pytest.fixture
def dim_table():
    """维度表：DWHRPT.DIM_DATE（无分区字段）"""
    columns = [
        ResolvedColumn(column_name="DATE_KEY", column_type="VARCHAR(8)", comment="日期键"),
        ResolvedColumn(column_name="YEAR", column_type="VARCHAR(4)", comment="年份"),
        ResolvedColumn(column_name="MONTH", column_type="VARCHAR(2)", comment="月份"),
    ]
    return ResolvedTableMetadata(
        schema_name="DWHRPT",
        table_name="DIM_DATE",
        table_comment="日期维度表",
        columns=columns,
        field_semantics=[],
        table_rule_hints=[],
    )


@pytest.fixture
def mixed_metadata(base_table, dim_table):
    return [base_table, dim_table]


# ── 测试 SQL 辅助函数 ──────────────────────────────────────────────────────────


class TestExtractTables:
    def test_simple_select(self):
        tables = extract_tables("SELECT AMT FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE PT='20260630'")
        assert len(tables) == 1
        assert "DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M" in tables

    def test_join(self):
        sql = """SELECT a.AMT, b.YEAR
FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M a
JOIN DWHRPT.DIM_DATE b ON a.PT = b.DATE_KEY"""
        tables = extract_tables(sql)
        assert len(tables) == 2
        assert "DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M" in tables
        assert "DWHRPT.DIM_DATE" in tables

    def test_cte_excludes_cte_name(self):
        sql = """WITH cte AS (
    SELECT AMT, PT FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE PT='20260630'
)
SELECT * FROM cte"""
        tables = extract_tables(sql)
        # cte 是 CTE 名，不应出现；只应有 DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M
        table_names = [t.upper() for t in tables]
        assert "CTE" not in table_names
        assert any("DWS_RPT_ZCPZ_CYFL_TF_M" in t.upper() for t in tables)

    def test_cte_with_multiple_ctes(self):
        sql = """WITH t1 AS (
    SELECT AMT FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE PT='20260630'
),
t2 AS (
    SELECT * FROM DWHRPT.DIM_DATE
)
SELECT t1.AMT, t2.YEAR FROM t1 JOIN t2 ON 1=1"""
        tables = extract_tables(sql)
        table_names = [t.upper() for t in tables if "." in t]
        assert len(table_names) == 2
        assert any("DWS_RPT_ZCPZ_CYFL_TF_M" in t for t in table_names)
        assert any("DIM_DATE" in t for t in table_names)
        # t1 和 t2 作为 CTE 名不应出现
        all_names = [t.upper() for t in tables]
        assert "T1" not in all_names or all_names.count("T1") == 0

    def test_subquery(self):
        sql = """SELECT REGION_NAME, total
FROM (
    SELECT REGION_NAME, SUM(AMT) as total
    FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M
    WHERE PT='20260630'
    GROUP BY REGION_NAME
) sub"""
        tables = extract_tables(sql)
        table_names = [t.upper() for t in tables if "." in t]
        assert len(table_names) == 1
        assert any("DWS_RPT_ZCPZ_CYFL_TF_M" in t for t in table_names)
        # 子查询别名 sub 不应出现
        all_names = [t.upper() for t in tables]
        assert "SUB" not in all_names

    def test_parse_failure_returns_empty(self):
        # 完全不可解析的 SQL 应当返回空列表
        tables = extract_tables("NOT SQL AT ALL!!!")
        assert tables == []


class TestExtractColumns:
    def test_simple_select(self):
        cols = extract_columns("SELECT AMT, REGION_NAME FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M")
        assert "AMT" in cols
        assert "REGION_NAME" in cols

    def test_select_with_where(self):
        cols = extract_columns(
            "SELECT AMT FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE CUST_TYPE='小微'"
        )
        assert "AMT" in cols
        assert "CUST_TYPE" in cols

    def test_select_with_group_by(self):
        cols = extract_columns(
            "SELECT REGION_CODE, SUM(AMT) FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M GROUP BY REGION_CODE"
        )
        assert "REGION_CODE" in cols
        assert "AMT" in cols

    def test_star_ignored(self):
        cols = extract_columns("SELECT * FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M")
        assert "*" not in cols

    def test_parse_failure_returns_empty(self):
        cols = extract_columns("NOT SQL AT ALL!!!")
        assert cols == []


class TestHasDdl:
    def test_select_is_false(self):
        assert has_ddl("SELECT AMT FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M") is False

    def test_with_cte_is_false(self):
        assert has_ddl("WITH cte AS (SELECT 1) SELECT * FROM cte") is False

    def test_delete_is_true(self):
        assert has_ddl("DELETE FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M") is True

    def test_insert_is_true(self):
        assert has_ddl("INSERT INTO DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M (AMT) VALUES (100)") is True

    def test_drop_is_true(self):
        assert has_ddl("DROP TABLE DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M") is True

    def test_update_is_true(self):
        assert has_ddl("UPDATE DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M SET AMT=0") is True

    def test_alter_is_true(self):
        assert has_ddl("ALTER TABLE DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M ADD COLUMN NEW_COL VARCHAR") is True

    def test_create_is_true(self):
        assert has_ddl("CREATE TABLE DWHRPT.NEW_TABLE (ID INT)") is True

    def test_truncate_is_true(self):
        assert has_ddl("TRUNCATE TABLE DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M") is True


# ── SqlValidator 校验规则测试 ──────────────────────────────────────────────────


class TestSqlValidator:
    """核心校验规则测试"""

    def test_field_not_found_in_sql_plan_fields(self, mixed_metadata):
        """sql_plan.fields 中存在虚构字段 → FIELD_NOT_FOUND"""
        sql_plan = {
            "sql": "SELECT AMT, REGION_NAME FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE PT='20260630'",
            "fields": ["AMT", "region"],  # "region" 不存在
            "tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
        }
        result = SqlValidator.validate(sql_plan, mixed_metadata)
        assert result.valid is False
        rule_names = [e["rule"] for e in result.errors]
        assert "FIELD_NOT_FOUND" in rule_names
        field_errs = [e for e in result.errors if e["rule"] == "FIELD_NOT_FOUND"]
        assert any("region" in e.get("field", "") for e in field_errs)

    def test_field_not_found_from_sql_text(self, mixed_metadata):
        """SQL 文本中包含不存在字段 → FIELD_NOT_FOUND"""
        sql_plan = {
            "sql": "SELECT investment_amount FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE PT='20260630'",
            "fields": ["investment_amount"],
            "tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
        }
        result = SqlValidator.validate(sql_plan, mixed_metadata)
        assert result.valid is False
        rule_names = [e["rule"] for e in result.errors]
        assert "FIELD_NOT_FOUND" in rule_names

    def test_table_schema_missing(self, mixed_metadata):
        """FROM DWS_RPT_ZCPZ_CYFL_TF_M 缺 schema → TABLE_SCHEMA_MISSING"""
        sql_plan = {
            "sql": "SELECT AMT, PT FROM DWS_RPT_ZCPZ_CYFL_TF_M WHERE PT='20260630'",
            "fields": ["AMT", "PT"],
            "tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
        }
        result = SqlValidator.validate(sql_plan, mixed_metadata)
        assert result.valid is False
        rule_names = [e["rule"] for e in result.errors]
        assert "TABLE_SCHEMA_MISSING" in rule_names
        schema_errs = [e for e in result.errors if e["rule"] == "TABLE_SCHEMA_MISSING"]
        assert any("DWS_RPT_ZCPZ_CYFL_TF_M" in e.get("table", "") for e in schema_errs)

    def test_ddl_dml_not_allowed(self, mixed_metadata):
        """DELETE FROM → DDL_DML_NOT_ALLOWED"""
        sql_plan = {
            "sql": "DELETE FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M",
            "fields": [],
            "tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
        }
        result = SqlValidator.validate(sql_plan, mixed_metadata)
        assert result.valid is False
        rule_names = [e["rule"] for e in result.errors]
        assert "DDL_DML_NOT_ALLOWED" in rule_names

    def test_valid_select_with_partition(self, mixed_metadata):
        """合法 SELECT + pt 过滤 → valid true, errors empty"""
        sql_plan = {
            "sql": "SELECT AMT, REGION_NAME FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE PT='20260630'",
            "fields": ["AMT", "REGION_NAME"],
            "tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
        }
        result = SqlValidator.validate(sql_plan, mixed_metadata)
        assert result.valid is True
        assert len(result.errors) == 0

    def test_partition_filter_missing(self, mixed_metadata):
        """分区表缺少 pt 过滤 → PARTITION_FILTER_MISSING"""
        sql_plan = {
            "sql": "SELECT AMT, REGION_NAME FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE REGION_CODE='010'",
            "fields": ["AMT", "REGION_NAME", "REGION_CODE"],
            "tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
        }
        result = SqlValidator.validate(sql_plan, mixed_metadata)
        assert result.valid is False
        rule_names = [e["rule"] for e in result.errors]
        assert "PARTITION_FILTER_MISSING" in rule_names

    def test_unknown_table_reference(self, mixed_metadata):
        """SQL 引用未在 resolved_metadata 范围的表 → UNKNOWN_TABLE_REFERENCE"""
        sql_plan = {
            "sql": "SELECT COL1 FROM DWHRPT.UNKNOWN_TABLE WHERE PT='20260630'",
            "fields": ["COL1"],
            "tables": ["DWHRPT.UNKNOWN_TABLE"],
        }
        result = SqlValidator.validate(sql_plan, mixed_metadata)
        assert result.valid is False
        rule_names = [e["rule"] for e in result.errors]
        assert "UNKNOWN_TABLE_REFERENCE" in rule_names

    def test_case_mismatch(self, mixed_metadata):
        """元数据为大写但 SQL 用小写引用 → CASE_MISMATCH"""
        sql_plan = {
            "sql": "SELECT amt FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE pt='20260630'",
            "fields": ["amt"],
            "tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
        }
        result = SqlValidator.validate(sql_plan, mixed_metadata)
        assert result.valid is False
        rule_names = [e["rule"] for e in result.errors]
        assert "CASE_MISMATCH" in rule_names

    def test_json_extract_does_not_crash(self, mixed_metadata):
        """json_extract 等复杂表达式不崩溃"""
        sql_plan = {
            "sql": """SELECT AMT, JSON_EXTRACT(meta, '$.name') as extracted_name
FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M
WHERE PT='20260630'""",
            "fields": ["AMT"],
            "tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
        }
        # 不应抛出异常
        result = SqlValidator.validate(sql_plan, mixed_metadata)
        # json_extract 提取的 extracted_name 不是字段引用，
        # 但 AMT 应当在 FIELD_NOT_FOUND 之外，提取的 extracted_name 不是 Column，不触发 FIELD_NOT_FOUND
        # 结果至少 valid 或 其它 error
        assert result is not None

    def test_mixed_errors_returned_together(self, mixed_metadata):
        """多条错误应一次性返回"""
        sql_plan = {
            "sql": "DELETE FROM DWS_RPT_ZCPZ_CYFL_TF_M WHERE region='010'",
            "fields": ["region"],
            "tables": ["DWS_RPT_ZCPZ_CYFL_TF_M"],
        }
        result = SqlValidator.validate(sql_plan, mixed_metadata)
        assert result.valid is False
        rules_found = {e["rule"] for e in result.errors}
        # 应当同时命中多条规则
        assert "DDL_DML_NOT_ALLOWED" in rules_found
        assert "TABLE_SCHEMA_MISSING" in rules_found
        assert "FIELD_NOT_FOUND" in rules_found

    def test_non_partition_table_valid(self, mixed_metadata):
        """非分区表（如 DIM_DATE）不要求 pt 过滤，不报 PARTITION_FILTER_MISSING"""
        sql_plan = {
            "sql": "SELECT YEAR, MONTH FROM DWHRPT.DIM_DATE",
            "fields": ["YEAR", "MONTH"],
            "tables": ["DWHRPT.DIM_DATE"],
        }
        result = SqlValidator.validate(sql_plan, mixed_metadata)
        # 非分区表不应报 PARTITION_FILTER_MISSING
        rules_found = {e["rule"] for e in result.errors}
        assert "PARTITION_FILTER_MISSING" not in rules_found
        # 其它规则应正常
        # DIM_DATE 没有分区字段，所以不报分区过滤缺少
        # 所有字段都有效，应 valid
        assert result.valid is True

    def test_partition_filter_in_clause(self, mixed_metadata):
        """pt IN (...) 也能满足分区过滤要求"""
        sql_plan = {
            "sql": "SELECT AMT FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE PT IN ('20260630', '20260629')",
            "fields": ["AMT"],
            "tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
        }
        result = SqlValidator.validate(sql_plan, mixed_metadata)
        rules_found = {e["rule"] for e in result.errors}
        assert "PARTITION_FILTER_MISSING" not in rules_found
        assert result.valid is True

    def test_empty_sql(self, mixed_metadata):
        """空 SQL → PARSE_ERROR"""
        sql_plan = {
            "sql": "",
            "fields": [],
            "tables": [],
        }
        result = SqlValidator.validate(sql_plan, mixed_metadata)
        assert result.valid is False
        assert any(e["rule"] == "PARSE_ERROR" for e in result.errors)

    def test_empty_metadata(self):
        """无元数据 → METADATA_MISSING"""
        sql_plan = {
            "sql": "SELECT 1",
            "fields": [],
            "tables": [],
        }
        result = SqlValidator.validate(sql_plan, [])
        assert result.valid is False
        assert any(e["rule"] == "METADATA_MISSING" for e in result.errors)

    def test_valid_cte_query(self, mixed_metadata):
        """CTE 查询合法且表达式正确解析"""
        sql_plan = {
            "sql": """WITH filtered AS (
    SELECT AMT, REGION_NAME FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE PT='20260630'
)
SELECT REGION_NAME, SUM(AMT) as total_amt FROM filtered GROUP BY REGION_NAME""",
            "fields": ["AMT", "REGION_NAME"],
            "tables": ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
        }
        result = SqlValidator.validate(sql_plan, mixed_metadata)
        assert result.valid is True
        assert len(result.errors) == 0


class TestSqlValidationResult:
    def test_to_dict(self):
        result = SqlValidationResult(
            valid=False,
            errors=[{"rule": "FIELD_NOT_FOUND", "field": "fake", "message": "faked"}],
            warnings=["warning1"],
            sql="SELECT *",
        )
        d = result.to_dict()
        assert "errors" in d
        assert "warnings" in d
        assert "sql" in d
        assert len(d["errors"]) == 1

    def test_valid_result_to_dict(self):
        result = SqlValidationResult(valid=True, errors=[], warnings=[], sql="SELECT 1")
        d = result.to_dict()
        assert d["errors"] == []
        assert d["warnings"] == []
        assert d["sql"] == "SELECT 1"
