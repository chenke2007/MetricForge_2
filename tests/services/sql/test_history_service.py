import pytest
from app.services.sql_history_service import SqlHistoryService
from app.models.sql_workbench import SqlExecutionHistory


@pytest.fixture
def service():
    return SqlHistoryService()


class TestCreateAndList:
    def test_create(self, service, db_session):
        h = service.create({
            "sql_text": "SELECT 1 FROM DUAL",
            "sql_hash": "abc",
            "datasource_id": 1,
            "datasource_name": "ds1",
            "status": "success",
            "elapsed_ms": 100,
            "row_count": 5,
            "truncated": False,
        }, db_session)
        assert h["sql_text"] == "SELECT 1 FROM DUAL"
        assert h["status"] == "success"
        assert h["row_count"] == 5

    def test_list_empty(self, service, db_session):
        result = service.list(db_session)
        assert result == []

    def test_list_with_data(self, service, db_session):
        service.create({"sql_text": "SELECT 1", "sql_hash": "a", "datasource_id": 1, "datasource_name": "ds1"}, db_session)
        service.create({"sql_text": "SELECT 2", "sql_hash": "b", "datasource_id": 1, "datasource_name": "ds1"}, db_session)
        result = service.list(db_session)
        assert len(result) == 2

    def test_list_with_limit(self, service, db_session):
        for i in range(5):
            service.create({"sql_text": f"SELECT {i}", "sql_hash": str(i), "datasource_id": 1, "datasource_name": "ds1"}, db_session)
        result = service.list(db_session, limit=3)
        assert len(result) == 3

    def test_list_filter_by_datasource(self, service, db_session):
        service.create({"sql_text": "SELECT 1", "sql_hash": "a", "datasource_id": 1, "datasource_name": "ds1"}, db_session)
        service.create({"sql_text": "SELECT 2", "sql_hash": "b", "datasource_id": 2, "datasource_name": "ds2"}, db_session)
        result = service.list(db_session, datasource_id=1)
        assert len(result) == 1
        assert result[0]["datasource_id"] == 1


class TestGet:
    def test_get_by_id(self, service, db_session):
        h = service.create({"sql_text": "SELECT 1", "sql_hash": "a", "datasource_id": 1, "datasource_name": "ds1"}, db_session)
        fetched = service.get(h["id"], db_session)
        assert fetched is not None
        assert fetched["sql_text"] == "SELECT 1"

    def test_get_nonexistent(self, service, db_session):
        assert service.get(999, db_session) is None
