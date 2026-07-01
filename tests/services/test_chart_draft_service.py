import pytest
import json
from app.services.chart_draft_service import ChartDraftService
from app.models.chart_draft import ChartDraft
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


def test_create_chart_draft(chart_draft_service, db_session):
    draft = chart_draft_service.create(
        {
            "title": "",
            "sql_text": "SELECT * FROM sales",
            "datasource_id": 1,
            "chart_config": {"chartType": "bar", "xColumn": "category", "yColumn": "amount"},
        },
        db_session,
    )
    assert draft["id"] is not None
    assert draft["title"].startswith("未命名图表")
    assert draft["sql_text"] == "SELECT * FROM sales"
    assert draft["chart_config"]["chartType"] == "bar"
