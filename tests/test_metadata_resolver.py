"""MetadataResolver 单元测试"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
from app.models.metadata import TableMetadata, ColumnMetadata
from app.models.field_semantic import FieldSemantic
from app.services.ai_ask.metadata_resolver import (
    MetadataResolver,
    ResolvedTableMetadata,
    ResolvedColumn,
    ResolvedFieldSemantic,
)


@pytest.fixture
def db_session():
    """内存 SQLite 数据库会话，带完整表结构。"""
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def seed_dwhrpt_snapshot(db_session):
    """插入 DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M 表及其字段和语义数据。"""
    table = TableMetadata(
        id=1,
        datasource_id=2,
        schema_name="DWHRPT",
        table_name="DWS_RPT_ZCPZ_CYFL_TF_M",
        table_comment="投放资产分类月度快照表",
        is_active=True,
    )
    db_session.add(table)
    db_session.flush()

    columns = [
        ColumnMetadata(
            table_id=table.id, column_name="pt", column_type="VARCHAR",
            comment="分区字段", column_id=1, is_primary_key=False, is_active=True,
        ),
        ColumnMetadata(
            table_id=table.id, column_name="amt", column_type="NUMBER(18,2)",
            comment="投放金额", column_id=2, is_primary_key=False, is_active=True,
        ),
        ColumnMetadata(
            table_id=table.id, column_name="cust_type", column_type="VARCHAR(20)",
            comment="客户类型（小微/中型/大型）", column_id=3, is_primary_key=False, is_active=True,
        ),
        ColumnMetadata(
            table_id=table.id, column_name="region_code", column_type="VARCHAR(10)",
            comment="区域编码", column_id=4, is_primary_key=False, is_active=True,
        ),
        ColumnMetadata(
            table_id=table.id, column_name="region_name", column_type="VARCHAR(50)",
            comment="区域名称", column_id=5, is_primary_key=False, is_active=True,
        ),
        ColumnMetadata(
            table_id=table.id, column_name="create_dt", column_type="DATE",
            comment="创建时间", column_id=6, is_primary_key=False, is_active=True,
        ),
    ]
    db_session.add_all(columns)
    db_session.flush()

    # FieldSemantic for amt
    sem = FieldSemantic(
        column_id=columns[1].id,  # amt
        business_alias="投放金额",
        meaning="按客户类型汇总的月度投放总金额",
    )
    db_session.add(sem)
    db_session.commit()
    return table, columns


@pytest.fixture
def seed_simple_table(db_session):
    """插入一个简单测试表。"""
    table = TableMetadata(
        id=10,
        datasource_id=2,
        schema_name="DWHBASE",
        table_name="DIM_CUSTOMER",
        table_comment="客户维度表",
        is_active=True,
    )
    db_session.add(table)
    db_session.flush()

    cols = [
        ColumnMetadata(
            table_id=table.id, column_name="cust_id", column_type="NUMBER",
            comment="客户ID", column_id=1, is_primary_key=True, is_active=True,
        ),
        ColumnMetadata(
            table_id=table.id, column_name="cust_name", column_type="VARCHAR(100)",
            comment="客户名称", column_id=2, is_primary_key=False, is_active=True,
        ),
    ]
    db_session.add_all(cols)
    db_session.commit()
    return table, cols


# ── Tests ──────────────────────────────────────────────────────────────────


class TestExtractTablesFromQuestion:
    def test_extract_schema_table_from_question(self):
        question = "查询 DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M 的数据"
        result = MetadataResolver.extract_tables_from_question(question)
        assert result == ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"]

    def test_extract_multiple_tables(self):
        question = "对比 DWHRPT.TABLE_A 和 DWHRPT.TABLE_B 的数据"
        result = MetadataResolver.extract_tables_from_question(question)
        assert "DWHRPT.TABLE_A" in result
        assert "DWHRPT.TABLE_B" in result

    def test_no_schema_table_in_question(self):
        result = MetadataResolver.extract_tables_from_question("各区域销售额排名")
        assert result == []

    def test_question_is_empty(self):
        result = MetadataResolver.extract_tables_from_question("")
        assert result == []

    def test_extract_lowercase_normalized_to_uppercase(self):
        # lowercase input should be normalized to uppercase
        result = MetadataResolver.extract_tables_from_question(
            "select amt from dwhrpt.dws_rpt_zcpz_cyfl_tf_m"
        )
        assert result == ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"]

    def test_extract_mixed_case_normalized_to_uppercase(self):
        result = MetadataResolver.extract_tables_from_question(
            "查询 DwhRpt.Dws_Rpt_Zcpz_Cyfl_Tf_M 的投放金额"
        )
        assert result == ["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"]


class TestResolveWithExactSchema:
    def test_resolve_with_schema_table(self, db_session, seed_dwhrpt_snapshot):
        table, columns = seed_dwhrpt_snapshot
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
            db=db_session,
        )
        assert len(result) == 1
        resolved = result[0]
        assert resolved.schema_name == "DWHRPT"
        assert resolved.table_name == "DWS_RPT_ZCPZ_CYFL_TF_M"
        assert resolved.table_comment == "投放资产分类月度快照表"

    def test_resolve_columns_contain_expected_fields(self, db_session, seed_dwhrpt_snapshot):
        table, columns = seed_dwhrpt_snapshot
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
            db=db_session,
        )
        assert len(result) == 1
        col_names = [c.column_name for c in result[0].columns]
        assert "pt" in col_names
        assert "amt" in col_names
        assert "region_code" in col_names
        assert "region_name" in col_names
        assert "cust_type" in col_names
        assert "create_dt" in col_names
        # Should NOT contain fake fields
        assert "region" not in col_names
        assert "investment_amount" not in col_names

    def test_resolve_columns_have_types_and_comments(self, db_session, seed_dwhrpt_snapshot):
        table, columns = seed_dwhrpt_snapshot
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
            db=db_session,
        )
        amt_col = next(c for c in result[0].columns if c.column_name == "amt")
        assert amt_col.column_type == "NUMBER(18,2)"
        assert amt_col.comment == "投放金额"

    def test_resolve_pt_is_marked_as_partition(self, db_session, seed_dwhrpt_snapshot):
        table, columns = seed_dwhrpt_snapshot
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
            db=db_session,
        )
        pt_col = next(c for c in result[0].columns if c.column_name == "pt")
        assert pt_col.is_partition is True

    def test_resolve_non_pt_is_not_partition(self, db_session, seed_dwhrpt_snapshot):
        table, columns = seed_dwhrpt_snapshot
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
            db=db_session,
        )
        amt_col = next(c for c in result[0].columns if c.column_name == "amt")
        assert amt_col.is_partition is False

    def test_wrong_schema_returns_empty_no_fallback(self, db_session, seed_dwhrpt_snapshot):
        """WRONG.DWS_RPT_ZCPZ_CYFL_TF_M must NOT fallback to table-only match.
        Even though DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M exists, wrong schema → empty."""
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=["WRONG.DWS_RPT_ZCPZ_CYFL_TF_M"],
            db=db_session,
        )
        assert result == []

    def test_uppercase_normalized_exact_schema_match(self, db_session, seed_dwhrpt_snapshot):
        """dwhrpt.dws_rpt_zcpz_cyfl_tf_m (lowercase input) should normalize
        and match DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M."""
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=["dwhrpt.dws_rpt_zcpz_cyfl_tf_m"],
            db=db_session,
        )
        assert len(result) == 1
        assert result[0].schema_name == "DWHRPT"
        assert result[0].table_name == "DWS_RPT_ZCPZ_CYFL_TF_M"


class TestResolveWithTableNameOnly:
    def test_resolve_table_name_only(self, db_session, seed_dwhrpt_snapshot):
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=["DWS_RPT_ZCPZ_CYFL_TF_M"],
            db=db_session,
        )
        assert len(result) == 1
        assert result[0].table_name == "DWS_RPT_ZCPZ_CYFL_TF_M"
        assert result[0].schema_name == "DWHRPT"


class TestResolveFromQuestion:
    def test_resolve_question_extracts_schema_table(self, db_session, seed_dwhrpt_snapshot):
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=[],
            question="查询 DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M 每月的投放金额",
            db=db_session,
        )
        assert len(result) == 1
        assert result[0].table_name == "DWS_RPT_ZCPZ_CYFL_TF_M"

    def test_resolve_question_lowercase_normalizes(self, db_session, seed_dwhrpt_snapshot):
        """Lowercase schema.table in question is normalized to uppercase."""
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=[],
            question="查询 dwhrpt.dws_rpt_zcpz_cyfl_tf_m 每月的投放金额",
            db=db_session,
        )
        assert len(result) == 1
        assert result[0].schema_name == "DWHRPT"
        assert result[0].table_name == "DWS_RPT_ZCPZ_CYFL_TF_M"

    def test_resolve_question_only_no_selected_tables(self, db_session, seed_dwhrpt_snapshot):
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=None,
            question="查询 DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M 的投放金额",
            db=db_session,
        )
        assert len(result) == 1

    def test_resolve_question_none_selected_empty(self, db_session, seed_dwhrpt_snapshot):
        # selected_tables is empty list, but question has schema.table
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=[],
            question="看看 DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M",
            db=db_session,
        )
        assert len(result) == 1

    def test_question_no_schema_table_uses_selected_only(self, db_session, seed_dwhrpt_snapshot, seed_simple_table):
        # question has no SCHEMA.TABLE, but selected_tables has one
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=["DWS_RPT_ZCPZ_CYFL_TF_M"],
            question="各区域投放金额排名",
            db=db_session,
        )
        assert len(result) == 1
        assert result[0].table_name == "DWS_RPT_ZCPZ_CYFL_TF_M"


class TestResolveFieldSemantics:
    def test_resolve_field_semantics_amt(self, db_session, seed_dwhrpt_snapshot):
        table, columns = seed_dwhrpt_snapshot
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
            db=db_session,
        )
        assert len(result) == 1
        semantics = result[0].field_semantics
        assert len(semantics) >= 1
        amt_sem = next(s for s in semantics if s.column_name == "amt")
        assert amt_sem.business_alias == "投放金额"
        assert amt_sem.meaning is not None


class TestResolveTableHints:
    def test_dws_table_has_rule_hints(self, db_session, seed_dwhrpt_snapshot):
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
            db=db_session,
        )
        assert len(result) == 1
        hints = result[0].table_rule_hints
        assert len(hints) >= 1
        assert any("DWS_" in h for h in hints)

    def test_dim_table_has_dim_hints(self, db_session, seed_simple_table):
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=["DWHBASE.DIM_CUSTOMER"],
            db=db_session,
        )
        assert len(result) == 1
        hints = result[0].table_rule_hints
        assert any("DIM_" in h for h in hints)


class TestResolveNotFound:
    def test_table_not_found_returns_empty(self, db_session, seed_dwhrpt_snapshot):
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=["NONEXISTENT_TABLE"],
            db=db_session,
        )
        assert result == []

    def test_wrong_datasource_returns_empty(self, db_session, seed_dwhrpt_snapshot):
        result = MetadataResolver.resolve(
            datasource_id=999,
            table_names=["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
            db=db_session,
        )
        assert result == []

    def test_empty_names_returns_empty(self, db_session):
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=[],
            db=db_session,
        )
        assert result == []

    def test_none_db_returns_empty(self):
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=["DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M"],
            db=None,
        )
        assert result == []


class TestResolveMultipleTables:
    def test_resolve_two_tables(self, db_session, seed_dwhrpt_snapshot, seed_simple_table):
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=[
                "DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M",
                "DWHBASE.DIM_CUSTOMER",
            ],
            db=db_session,
        )
        assert len(result) == 2
        names = {r.table_name for r in result}
        assert "DWS_RPT_ZCPZ_CYFL_TF_M" in names
        assert "DIM_CUSTOMER" in names

    def test_duplicate_names_deduped(self, db_session, seed_dwhrpt_snapshot):
        result = MetadataResolver.resolve(
            datasource_id=2,
            table_names=[
                "DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M",
                "DWS_RPT_ZCPZ_CYFL_TF_M",
            ],
            db=db_session,
        )
        # Both resolve to the same table, should be deduped
        assert len(result) == 1
