import pytest
from datetime import datetime
from app.models.sql_workbench import SqlDraft, SqlExecutionHistory


def test_create_sql_draft(db_session):
    draft = SqlDraft(
        title="",
        sql_text="SELECT * FROM DUAL",
        datasource_id=1,
        dialect="oracle",
        description="测试草稿",
        tags='["test"]',
        is_template=False,
    )
    db_session.add(draft)
    db_session.commit()

    saved = db_session.query(SqlDraft).first()
    assert saved is not None
    assert saved.sql_text == "SELECT * FROM DUAL"
    assert saved.title == ""
    assert saved.dialect == "oracle"
    assert saved.description == "测试草稿"
    assert saved.tags == '["test"]'
    assert saved.is_template is False
    assert saved.created_at is not None
    assert saved.updated_at is not None


def test_create_sql_execution_history(db_session):
    history = SqlExecutionHistory(
        sql_text="SELECT * FROM DUAL",
        sql_hash="abc123",
        datasource_id=1,
        datasource_name="测试数据源",
        status="success",
        elapsed_ms=100,
        row_count=10,
        truncated=False,
        error_message=None,
    )
    db_session.add(history)
    db_session.commit()

    saved = db_session.query(SqlExecutionHistory).first()
    assert saved is not None
    assert saved.sql_text == "SELECT * FROM DUAL"
    assert saved.sql_hash == "abc123"
    assert saved.datasource_name == "测试数据源"
    assert saved.status == "success"
    assert saved.elapsed_ms == 100
    assert saved.row_count == 10
    assert saved.truncated is False
    assert saved.error_message is None


def test_execution_history_status_constraint(db_session):
    """测试 status 字段 CHECK 约束"""
    import sqlalchemy
    history = SqlExecutionHistory(
        sql_text="SELECT 1",
        sql_hash="def456",
        datasource_id=1,
        datasource_name="test",
        status="invalid_status",
    )
    db_session.add(history)
    with pytest.raises((sqlalchemy.exc.IntegrityError, sqlalchemy.exc.OperationalError)):
        db_session.commit()


def test_sql_draft_default_title_empty(db_session):
    draft = SqlDraft(sql_text="SELECT 1", datasource_id=1)
    db_session.add(draft)
    db_session.commit()
    assert draft.title == ""
