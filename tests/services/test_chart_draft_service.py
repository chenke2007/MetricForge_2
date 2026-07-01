import pytest
import json
from app.services.chart_draft_service import ChartDraftService
from app.models.chart_draft import ChartDraft
from app.models.datasource import DatasourceConfig
from app.models.base import Base
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def chart_draft_service():
    return ChartDraftService()


@pytest.fixture
def db_session():
    """内存 SQLite 数据库会话"""
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


class TestCreate:
    def test_create_chart_draft_with_all_fields(self, chart_draft_service, db_session):
        draft = chart_draft_service.create(
            {
                "title": "销售趋势",
                "sql_text": "SELECT * FROM sales",
                "datasource_id": None,
                "chart_config": {"chartType": "line", "xColumn": "date", "yColumn": "amount"},
            },
            db_session,
        )
        assert draft["id"] is not None
        assert draft["title"] == "销售趋势"
        assert draft["sql_text"] == "SELECT * FROM sales"
        assert draft["datasource_id"] is None
        assert draft["chart_config"]["chartType"] == "line"
        assert "datasource_available" in draft
        assert draft["datasource_available"] is False

    def test_create_with_empty_title_gets_default_name(self, chart_draft_service, db_session):
        draft = chart_draft_service.create(
            {
                "title": "",
                "sql_text": "SELECT 1",
                "datasource_id": None,
                "chart_config": {"chartType": "bar"},
            },
            db_session,
        )
        assert draft["title"].startswith("未命名图表")

    def test_create_with_whitespace_title_gets_default_name(self, chart_draft_service, db_session):
        draft = chart_draft_service.create(
            {
                "title": "   ",
                "sql_text": "SELECT 1",
                "datasource_id": None,
                "chart_config": {"chartType": "bar"},
            },
            db_session,
        )
        assert draft["title"].startswith("未命名图表")

    def test_create_missing_sql_text_raises(self, chart_draft_service, db_session):
        with pytest.raises(KeyError):
            chart_draft_service.create(
                {
                    "title": "T",
                    "datasource_id": None,
                    "chart_config": {"chartType": "bar"},
                },
                db_session,
            )

    def test_create_missing_chart_config_raises(self, chart_draft_service, db_session):
        with pytest.raises(KeyError):
            chart_draft_service.create(
                {
                    "title": "T",
                    "sql_text": "SELECT 1",
                    "datasource_id": None,
                },
                db_session,
            )

    def test_create_with_existing_datasource_shows_available(self, chart_draft_service, db_session):
        ds = DatasourceConfig(
            name="tmp", ds_type="oracle", host="h", port=1, username="u", dialect="oracle"
        )
        db_session.add(ds)
        db_session.commit()
        db_session.refresh(ds)

        draft = chart_draft_service.create(
            {
                "title": "T",
                "sql_text": "SELECT 1",
                "datasource_id": ds.id,
                "chart_config": {"chartType": "bar"},
            },
            db_session,
        )
        assert draft["datasource_available"] is True

    def test_create_with_nonexistent_datasource_shows_unavailable(self, chart_draft_service, db_session):
        draft = chart_draft_service.create(
            {
                "title": "T",
                "sql_text": "SELECT 1",
                "datasource_id": 9999,
                "chart_config": {"chartType": "bar"},
            },
            db_session,
        )
        assert draft["datasource_available"] is False

    def test_create_chart_config_stored_as_json_text(self, chart_draft_service, db_session):
        draft = chart_draft_service.create(
            {
                "title": "T",
                "sql_text": "SELECT 1",
                "datasource_id": None,
                "chart_config": {"chartType": "bar", "xColumn": "a", "yColumn": "b"},
            },
            db_session,
        )
        # Verify in DB that chart_config is stored as JSON text
        row = db_session.query(ChartDraft).filter(ChartDraft.id == draft["id"]).first()
        assert isinstance(row.chart_config, str)
        parsed = json.loads(row.chart_config)
        assert parsed["chartType"] == "bar"


class TestList:
    def test_list_returns_all_drafts_ordered_by_updated_at_desc(self, chart_draft_service, db_session):
        draft1 = chart_draft_service.create(
            {"title": "First", "sql_text": "SELECT 1", "datasource_id": None, "chart_config": {"chartType": "bar"}},
            db_session,
        )
        draft2 = chart_draft_service.create(
            {"title": "Second", "sql_text": "SELECT 2", "datasource_id": None, "chart_config": {"chartType": "line"}},
            db_session,
        )
        result = chart_draft_service.list(db_session)
        assert len(result) == 2
        assert result[0]["id"] == draft2["id"]
        assert result[1]["id"] == draft1["id"]

    def test_list_empty(self, chart_draft_service, db_session):
        result = chart_draft_service.list(db_session)
        assert result == []


class TestGet:
    def test_get_existing_draft(self, chart_draft_service, db_session):
        created = chart_draft_service.create(
            {"title": "T", "sql_text": "SELECT 1", "datasource_id": None, "chart_config": {"chartType": "bar"}},
            db_session,
        )
        result = chart_draft_service.get(created["id"], db_session)
        assert result is not None
        assert result["id"] == created["id"]
        assert result["title"] == "T"
        assert "datasource_available" in result

    def test_get_nonexistent_returns_none(self, chart_draft_service, db_session):
        result = chart_draft_service.get(9999, db_session)
        assert result is None


class TestUpdate:
    def test_update_title(self, chart_draft_service, db_session):
        created = chart_draft_service.create(
            {"title": "Old", "sql_text": "SELECT 1", "datasource_id": None, "chart_config": {"chartType": "bar"}},
            db_session,
        )
        result = chart_draft_service.update(created["id"], {"title": "New"}, db_session)
        assert result["title"] == "New"
        assert result["sql_text"] == "SELECT 1"

    def test_update_sql_text(self, chart_draft_service, db_session):
        created = chart_draft_service.create(
            {"title": "T", "sql_text": "SELECT 1", "datasource_id": None, "chart_config": {"chartType": "bar"}},
            db_session,
        )
        result = chart_draft_service.update(created["id"], {"sql_text": "SELECT 2"}, db_session)
        assert result["sql_text"] == "SELECT 2"

    def test_update_datasource_id(self, chart_draft_service, db_session):
        created = chart_draft_service.create(
            {"title": "T", "sql_text": "SELECT 1", "datasource_id": None, "chart_config": {"chartType": "bar"}},
            db_session,
        )
        result = chart_draft_service.update(created["id"], {"datasource_id": 123}, db_session)
        assert result["datasource_id"] == 123

    def test_update_chart_config(self, chart_draft_service, db_session):
        created = chart_draft_service.create(
            {"title": "T", "sql_text": "SELECT 1", "datasource_id": None, "chart_config": {"chartType": "bar"}},
            db_session,
        )
        result = chart_draft_service.update(
            created["id"], {"chart_config": {"chartType": "line", "xColumn": "x"}}, db_session
        )
        assert result["chart_config"]["chartType"] == "line"
        assert result["chart_config"]["xColumn"] == "x"

    def test_update_whitespace_title_ignored(self, chart_draft_service, db_session):
        created = chart_draft_service.create(
            {"title": "Original", "sql_text": "SELECT 1", "datasource_id": None, "chart_config": {"chartType": "bar"}},
            db_session,
        )
        result = chart_draft_service.update(created["id"], {"title": "   "}, db_session)
        assert result["title"] == "Original"

    def test_update_nonexistent_returns_none(self, chart_draft_service, db_session):
        result = chart_draft_service.update(9999, {"title": "New"}, db_session)
        assert result is None

    def test_update_datasource_available_changes(self, chart_draft_service, db_session):
        ds = DatasourceConfig(
            name="tmp", ds_type="oracle", host="h", port=1, username="u", dialect="oracle"
        )
        db_session.add(ds)
        db_session.commit()
        db_session.refresh(ds)

        created = chart_draft_service.create(
            {"title": "T", "sql_text": "SELECT 1", "datasource_id": None, "chart_config": {"chartType": "bar"}},
            db_session,
        )
        # Update to existing datasource
        result = chart_draft_service.update(created["id"], {"datasource_id": ds.id}, db_session)
        assert result["datasource_available"] is True

        # Delete datasource
        db_session.delete(ds)
        db_session.commit()

        # Get should show unavailable
        result = chart_draft_service.get(created["id"], db_session)
        assert result["datasource_available"] is False


class TestDelete:
    def test_delete_existing(self, chart_draft_service, db_session):
        created = chart_draft_service.create(
            {"title": "T", "sql_text": "SELECT 1", "datasource_id": None, "chart_config": {"chartType": "bar"}},
            db_session,
        )
        assert chart_draft_service.delete(created["id"], db_session) is True
        assert chart_draft_service.get(created["id"], db_session) is None

    def test_delete_nonexistent_returns_false(self, chart_draft_service, db_session):
        assert chart_draft_service.delete(9999, db_session) is False


class TestDatasourceAvailableBehavior:
    def test_datasource_available_true_when_datasource_exists(self, chart_draft_service, db_session):
        ds = DatasourceConfig(
            name="tmp", ds_type="oracle", host="h", port=1, username="u", dialect="oracle"
        )
        db_session.add(ds)
        db_session.commit()
        db_session.refresh(ds)

        draft = chart_draft_service.create(
            {"title": "T", "sql_text": "SELECT 1", "datasource_id": ds.id, "chart_config": {"chartType": "bar"}},
            db_session,
        )
        assert draft["datasource_available"] is True

    def test_datasource_available_false_when_datasource_deleted(self, chart_draft_service, db_session):
        ds = DatasourceConfig(
            name="tmp", ds_type="oracle", host="h", port=1, username="u", dialect="oracle"
        )
        db_session.add(ds)
        db_session.commit()
        db_session.refresh(ds)

        draft = chart_draft_service.create(
            {"title": "T", "sql_text": "SELECT 1", "datasource_id": ds.id, "chart_config": {"chartType": "bar"}},
            db_session,
        )
        db_session.delete(ds)
        db_session.commit()

        result = chart_draft_service.get(draft["id"], db_session)
        assert result["datasource_available"] is False
        # Draft still readable
        assert result["id"] == draft["id"]

    def test_datasource_available_false_when_no_datasource_id(self, chart_draft_service, db_session):
        draft = chart_draft_service.create(
            {"title": "T", "sql_text": "SELECT 1", "datasource_id": None, "chart_config": {"chartType": "bar"}},
            db_session,
        )
        assert draft["datasource_available"] is False
