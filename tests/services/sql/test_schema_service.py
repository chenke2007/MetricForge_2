import pytest
from app.services.sql_schema_service import SqlSchemaService
from app.models import DatasourceConfig, TableMetadata, ColumnMetadata


@pytest.fixture
def service():
    return SqlSchemaService()


@pytest.fixture
def datasource_with_tables(db_session):
    ds = DatasourceConfig(
        name="测试数据源", ds_type="oracle", host="127.0.0.1",
        port=1521, username="ro", dialect="oracle",
    )
    db_session.add(ds)
    db_session.flush()

    t1 = TableMetadata(
        datasource_id=ds.id, schema_name="DW", table_name="T_ORDER",
        table_comment="订单表", is_active=True,
    )
    t2 = TableMetadata(
        datasource_id=ds.id, schema_name="DW", table_name="T_CUSTOMER",
        table_comment="客户表", is_active=True,
    )
    db_session.add_all([t1, t2])
    db_session.flush()

    c1 = ColumnMetadata(
        table_id=t1.id, column_name="ORDER_ID", column_type="NUMBER",
        nullable=False, column_id=1, is_primary_key=True, is_active=True,
    )
    c2 = ColumnMetadata(
        table_id=t1.id, column_name="CUSTOMER_ID", column_type="NUMBER",
        nullable=True, column_id=2, is_active=True,
    )
    db_session.add_all([c1, c2])
    db_session.commit()
    return ds, t1, t2


class TestGetDatasourceTree:
    def test_returns_schema_tree(self, service, datasource_with_tables, db_session):
        ds, t1, t2 = datasource_with_tables
        result = service.get_datasource_tree(ds.id, db_session)
        assert result["datasource_id"] == ds.id
        assert result["datasource_name"] == "测试数据源"
        assert len(result["schemas"]) == 1
        assert result["schemas"][0]["schema_name"] == "DW"
        assert len(result["schemas"][0]["tables"]) == 2

    def test_table_has_column_count(self, service, datasource_with_tables, db_session):
        ds, t1, t2 = datasource_with_tables
        result = service.get_datasource_tree(ds.id, db_session)
        tables = result["schemas"][0]["tables"]
        order = [t for t in tables if t["name"] == "T_ORDER"][0]
        assert order["column_count"] == 2
        assert order["comment"] == "订单表"

    def test_empty_datasource(self, service, db_session):
        result = service.get_datasource_tree(999, db_session)
        assert result["schemas"] == []


class TestGetTableColumns:
    def test_returns_columns(self, service, datasource_with_tables, db_session):
        ds, t1, t2 = datasource_with_tables
        columns = service.get_table_columns(t1.id, db_session)
        assert len(columns) == 2
        assert columns[0]["name"] == "ORDER_ID"
        assert columns[0]["is_primary_key"] is True
        assert columns[0]["nullable"] is False

    def test_empty_table(self, service, datasource_with_tables, db_session):
        ds, t1, t2 = datasource_with_tables
        columns = service.get_table_columns(t2.id, db_session)
        assert columns == []

    def test_missing_table(self, service, db_session):
        columns = service.get_table_columns(999, db_session)
        assert columns == []


class TestSearch:
    def test_search_by_table_name(self, service, datasource_with_tables, db_session):
        ds, t1, t2 = datasource_with_tables
        results = service.search(ds.id, "ORDER", db_session)
        assert len(results) >= 1
        names = [r["table_name"] for r in results if r["match_type"] == "table"]
        assert "T_ORDER" in names

    def test_search_by_column_name(self, service, datasource_with_tables, db_session):
        ds, t1, t2 = datasource_with_tables
        results = service.search(ds.id, "CUSTOMER", db_session)
        assert len(results) >= 1
        col_matches = [r for r in results if r["match_type"] == "column"]
        assert len(col_matches) >= 1

    def test_search_empty_query(self, service, datasource_with_tables, db_session):
        ds, t1, t2 = datasource_with_tables
        results = service.search(ds.id, "", db_session)
        assert results == []
