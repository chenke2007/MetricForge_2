"""SQL Workbench API integration tests (without actual Oracle connection).

Both client and db_session fixtures connect to the same file-based SQLite database,
ensuring data inserted in tests is visible via API calls.
"""

import pytest
from fastapi.testclient import TestClient
from app.models import DatasourceConfig, TableMetadata, ColumnMetadata
from tests.support.sql_worker_factories import success_factory


@pytest.fixture
def client(tmp_path):
    """App using a file-based SQLite so db_session can connect to the same DB."""
    db_path = tmp_path / "test_api.db"
    from app.main import create_app
    app = create_app(database_url=f"sqlite:///{db_path}")
    # Patch the module-level execution_service to use test factory
    from app.api.sql_workbench import execution_service as _svc
    # save defaults for teardown
    _saved = (_svc._adapter_factory, _svc._cleanup_callback, _svc._temp_root)
    _svc._adapter_factory = success_factory
    _svc._cleanup_callback = None
    _svc._temp_root = str(tmp_path)
    yield TestClient(app)
    # teardown — restore defaults to avoid singleton pollution
    _svc._adapter_factory, _svc._cleanup_callback, _svc._temp_root = _saved


@pytest.fixture
def db_session(tmp_path, client):
    """Session connected to the same file-based DB as the app."""
    from app.models.base import get_session
    session = get_session()
    try:
        yield session
    finally:
        session.close()


class TestSqlApi:
    """SQL Workbench API integration tests"""

    def test_execute_success(self, client, db_session):
        # Create a datasource
        ds = DatasourceConfig(
            name="api-test", ds_type="oracle", host="127.0.0.1",
            port=1521, username="ro", password_enc="secret",
            dialect="oracle", is_active=True,
        )
        db_session.add(ds)
        db_session.commit()
        ds_id = ds.id

        resp = client.post("/api/sql/execute", json={
            "datasource_id": ds_id,
            "sql": "SELECT * FROM DUAL",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["columns"] == ["ID", "NAME"]
        assert data["row_count"] == 1
        assert data["history_id"] is not None
        assert "column_types" in data

    def test_execute_validation_failure(self, client):
        resp = client.post("/api/sql/execute", json={
            "datasource_id": 1,
            "sql": "DROP TABLE t",
        })
        assert resp.status_code == 422
        data = resp.json()
        assert "detail" in data
        assert "code" in data["detail"]

    def test_list_datasources(self, client, db_session):
        ds = DatasourceConfig(
            name="ds-for-sql", ds_type="oracle", host="127.0.0.1",
            port=1521, username="ro", dialect="oracle", is_active=True,
        )
        db_session.add(ds)
        db_session.commit()

        resp = client.get("/api/sql/datasources")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert data[0]["name"] == "ds-for-sql"

    def test_schema_tree(self, client, db_session):
        ds = DatasourceConfig(
            name="schema-test", ds_type="oracle", host="127.0.0.1",
            port=1521, username="ro", dialect="oracle", is_active=True,
        )
        db_session.add(ds)
        db_session.flush()
        t = TableMetadata(
            datasource_id=ds.id, schema_name="DW", table_name="T_TEST",
            table_comment="test", is_active=True,
        )
        db_session.add(t)
        db_session.commit()

        resp = client.get(f"/api/sql/schema?datasource_id={ds.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["datasource_id"] == ds.id
        assert len(data["schemas"]) == 1

    def test_table_columns(self, client, db_session):
        ds = DatasourceConfig(
            name="col-test", ds_type="oracle", host="127.0.0.1",
            port=1521, username="ro", dialect="oracle", is_active=True,
        )
        db_session.add(ds)
        db_session.flush()
        t = TableMetadata(
            datasource_id=ds.id, schema_name="DW", table_name="T_COL",
            is_active=True,
        )
        db_session.add(t)
        db_session.flush()
        c = ColumnMetadata(
            table_id=t.id, column_name="COL1", column_type="NUMBER",
            column_id=1, is_active=True,
        )
        db_session.add(c)
        db_session.commit()

        resp = client.get(f"/api/sql/tables/{t.id}/columns")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "COL1"

    def test_draft_create_and_list(self, client):
        resp = client.post("/api/sql/drafts", json={
            "title": "测试草稿",
            "sql_text": "SELECT 1 FROM DUAL",
            "datasource_id": 1,
        })
        assert resp.status_code == 200
        draft_id = resp.json()["id"]

        resp = client.get("/api/sql/drafts")
        assert resp.status_code == 200
        data = resp.json()
        assert any(d["id"] == draft_id for d in data)

    def test_draft_update_and_delete(self, client):
        resp = client.post("/api/sql/drafts", json={
            "title": "旧标题",
            "sql_text": "SELECT 1",
            "datasource_id": 1,
        })
        draft_id = resp.json()["id"]

        resp = client.put(f"/api/sql/drafts/{draft_id}", json={"title": "新标题"})
        assert resp.status_code == 200
        assert resp.json()["title"] == "新标题"

        resp = client.delete(f"/api/sql/drafts/{draft_id}")
        assert resp.status_code == 200

        resp = client.get(f"/api/sql/drafts/{draft_id}")
        assert resp.status_code == 404

    def test_history_list(self, client, db_session):
        ds = DatasourceConfig(
            name="hist-test", ds_type="oracle", host="127.0.0.1",
            port=1521, username="ro", password_enc="secret",
            dialect="oracle", is_active=True,
        )
        db_session.add(ds)
        db_session.commit()

        client.post("/api/sql/execute", json={
            "datasource_id": ds.id,
            "sql": "SELECT 1 FROM DUAL",
        })

        resp = client.get("/api/sql/history")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1

    def test_get_draft_not_found(self, client):
        resp = client.get("/api/sql/drafts/999")
        assert resp.status_code == 404
        assert resp.json()["detail"] == "草稿不存在"

    def test_get_history_not_found(self, client):
        resp = client.get("/api/sql/history/999")
        assert resp.status_code == 404
        assert resp.json()["detail"] == "执行历史不存在"

    def test_search_schema(self, client, db_session):
        ds = DatasourceConfig(
            name="search-test", ds_type="oracle", host="127.0.0.1",
            port=1521, username="ro", dialect="oracle", is_active=True,
        )
        db_session.add(ds)
        db_session.flush()
        t = TableMetadata(
            datasource_id=ds.id, schema_name="DW", table_name="T_SEARCH",
            table_comment="search test", is_active=True,
        )
        db_session.add(t)
        db_session.commit()

        resp = client.get(f"/api/sql/schema/search?datasource_id={ds.id}&q=SEARCH")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert data[0]["match_type"] == "table"
        assert data[0]["matched_on"] == "table_name"
