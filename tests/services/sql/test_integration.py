"""Full-flow integration tests for SQL Workbench API"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from app.models import DatasourceConfig, TableMetadata, ColumnMetadata


@pytest.fixture
def client(tmp_path):
    """App using a file-based SQLite so db_session can connect to the same DB."""
    db_path = tmp_path / "test_integration.db"
    from app.main import create_app
    app = create_app(database_url=f"sqlite:///{db_path}")
    return TestClient(app)


@pytest.fixture
def db_session(tmp_path, client):
    """Session connected to the same file-based DB as the app."""
    from app.models.base import get_session
    session = get_session()
    try:
        yield session
    finally:
        session.close()


class TestFullFlow:
    """Complete user workflow test"""

    def test_full_workflow(self, client, db_session):
        # 1. Create datasource
        ds = DatasourceConfig(
            name="集成测试数据源", ds_type="oracle", host="127.0.0.1",
            port=1521, username="ro", dialect="oracle", is_active=True,
        )
        db_session.add(ds)
        db_session.flush()
        ds_id = ds.id

        # 2. Create metadata
        t = TableMetadata(
            datasource_id=ds_id, schema_name="DW", table_name="T_TEST",
            table_comment="测试表", is_active=True,
        )
        db_session.add(t)
        db_session.flush()
        t_id = t.id

        col = ColumnMetadata(
            table_id=t_id, column_name="COL1", column_type="NUMBER",
            column_id=1, is_active=True,
        )
        db_session.add(col)
        db_session.commit()

        # 3. List datasources
        resp = client.get("/api/sql/datasources")
        assert resp.status_code == 200
        ds_list = resp.json()
        assert len(ds_list) >= 1

        # 4. Schema tree
        resp = client.get(f"/api/sql/schema?datasource_id={ds_id}")
        assert resp.status_code == 200
        tree = resp.json()
        assert tree["datasource_id"] == ds_id

        # 5. Table columns
        resp = client.get(f"/api/sql/tables/{t_id}/columns")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        # 6. Execute (mock adapter)
        with patch('app.services.sql_execution_service.get_adapter_for_datasource') as mock_get:
            mock_adapter = MagicMock()
            mock_adapter.execute_query.return_value = MagicMock(
                columns=["COL1"], rows=[[42]], row_count=1, error=None,
            )
            mock_adapter.name = "集成测试数据源"
            mock_get.return_value = mock_adapter

            resp = client.post("/api/sql/execute", json={
                "datasource_id": ds_id,
                "sql": "SELECT COL1 FROM T_TEST",
            })
            assert resp.status_code == 200
            exec_result = resp.json()
            assert exec_result["columns"] == ["COL1"]
            assert exec_result["row_count"] == 1

        # 7. History
        resp = client.get("/api/sql/history")
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

        # 8. Save draft
        resp = client.post("/api/sql/drafts", json={
            "title": "集成测试草稿",
            "sql_text": "SELECT COL1 FROM T_TEST",
            "datasource_id": ds_id,
        })
        assert resp.status_code == 200
        draft_id = resp.json()["id"]

        # 9. List drafts
        resp = client.get("/api/sql/drafts")
        assert resp.status_code == 200
        assert any(d["id"] == draft_id for d in resp.json())

        # 10. Execute invalid SQL → 422
        resp = client.post("/api/sql/execute", json={
            "datasource_id": ds_id,
            "sql": "DROP TABLE T_TEST",
        })
        assert resp.status_code == 422

    def test_dangerous_sql_does_not_create_history(self, client, db_session):
        # 1. Create datasource
        ds = DatasourceConfig(
            name="danger-test", ds_type="oracle", host="127.0.0.1",
            port=1521, username="ro", dialect="oracle", is_active=True,
        )
        db_session.add(ds)
        db_session.flush()
        ds_id = ds.id

        # 2. Record history count before dangerous SQL
        resp = client.get("/api/sql/history")
        assert resp.status_code == 200
        history_before = len(resp.json())

        # 3. Execute dangerous SQL → 422
        resp = client.post("/api/sql/execute", json={
            "datasource_id": ds_id,
            "sql": "DROP TABLE T_TEST",
        })
        assert resp.status_code == 422

        # 4. Verify no new history entry
        resp = client.get("/api/sql/history")
        assert resp.status_code == 200
        history_after = len(resp.json())
        assert history_after == history_before
