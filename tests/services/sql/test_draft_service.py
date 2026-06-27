import pytest
from datetime import datetime, timezone
from app.services.sql_draft_service import SqlDraftService
from app.models.sql_workbench import SqlDraft


@pytest.fixture
def service():
    return SqlDraftService()


class TestCreate:
    def test_create_with_title(self, service, db_session):
        draft = service.create({
            "title": "测试查询",
            "sql_text": "SELECT * FROM DUAL",
            "datasource_id": 1,
            "description": "测试",
            "tags": '["test"]',
        }, db_session)
        assert draft["title"] == "测试查询"
        assert draft["sql_text"] == "SELECT * FROM DUAL"
        assert draft["id"] is not None

    def test_create_empty_title_generates_name(self, service, db_session):
        draft = service.create({
            "title": "",
            "sql_text": "SELECT 1 FROM DUAL",
            "datasource_id": 1,
        }, db_session)
        assert draft["title"].startswith("未命名查询_")

    def test_list_ordered_by_updated_at(self, service, db_session):
        service.create({"title": "B", "sql_text": "SELECT 1"}, db_session)
        import time; time.sleep(0.01)
        service.create({"title": "A", "sql_text": "SELECT 2"}, db_session)
        drafts = service.list(db_session)
        assert drafts[0]["title"] == "A"
        assert drafts[1]["title"] == "B"


class TestUpdate:
    def test_update_title(self, service, db_session):
        d = service.create({"title": "旧", "sql_text": "SELECT 1"}, db_session)
        updated = service.update(d["id"], {"title": "新"}, db_session)
        assert updated["title"] == "新"

    def test_update_nonexistent(self, service, db_session):
        assert service.update(999, {"title": "x"}, db_session) is None

    def test_delete(self, service, db_session):
        d = service.create({"title": "待删", "sql_text": "SELECT 1"}, db_session)
        assert service.delete(d["id"], db_session) is True
        assert service.get(d["id"], db_session) is None

    def test_delete_nonexistent(self, service, db_session):
        assert service.delete(999, db_session) is False
