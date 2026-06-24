"""Test ask-related SQLAlchemy models: LlmSetting, AskSession, AskMessage."""

import os
import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("METRICFORGE_ENC_KEY", "test-master-key-0123456789")

from app.models.base import Base
from app.models.ask_models import LlmSetting, AskSession, AskMessage


@pytest.fixture
def session():
    engine = create_engine("sqlite://", echo=False)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    s = Session()
    try:
        yield s
    finally:
        s.close()


class TestLlmSetting:
    def test_create_and_read(self, session):
        setting = LlmSetting(
            name="DeepSeek V4",
            base_url="http://test.example.com:8080",
            api_key="encrypted-key-here",
            model_name="DeepSeek-V4-Flash",
        )
        session.add(setting)
        session.commit()

        retrieved = session.query(LlmSetting).first()
        assert retrieved is not None
        assert retrieved.name == "DeepSeek V4"
        assert retrieved.base_url == "http://test.example.com:8080"
        assert retrieved.model_name == "DeepSeek-V4-Flash"

    def test_default_is_active_zero(self, session):
        setting = LlmSetting(
            name="Test", base_url="http://x.com", api_key="key", model_name="m"
        )
        session.add(setting)
        session.commit()
        assert setting.is_active == 0

    def test_update_timestamp(self, session):
        setting = LlmSetting(
            name="Test", base_url="http://x.com", api_key="key", model_name="m"
        )
        session.add(setting)
        session.commit()
        original_updated = setting.updated_at

        setting.name = "Updated"
        session.commit()
        assert setting.updated_at >= original_updated


class TestAskSession:
    def test_create_and_read(self, session):
        ses = AskSession(model_name="DeepSeek-V4-Flash")
        session.add(ses)
        session.commit()

        retrieved = session.query(AskSession).first()
        assert retrieved is not None
        assert retrieved.model_name == "DeepSeek-V4-Flash"

    def test_default_title(self, session):
        ses = AskSession(model_name="m")
        session.add(ses)
        session.commit()
        assert ses.title == "新对话"

    def test_default_message_count_zero(self, session):
        ses = AskSession(model_name="m")
        session.add(ses)
        session.commit()
        assert ses.message_count == 0


class TestAskMessage:
    def test_create_and_read(self, session):
        ses = AskSession(model_name="m")
        session.add(ses)
        session.flush()

        msg = AskMessage(session_id=ses.id, role="user", content="你好")
        session.add(msg)
        session.commit()

        retrieved = session.query(AskMessage).first()
        assert retrieved is not None
        assert retrieved.role == "user"
        assert retrieved.content == "你好"

    def test_default_status_completed(self, session):
        ses = AskSession(model_name="m")
        session.add(ses)
        session.flush()

        msg = AskMessage(session_id=ses.id, role="user", content="test")
        session.add(msg)
        session.commit()
        assert msg.status == "completed"

    def test_default_content_empty(self, session):
        ses = AskSession(model_name="m")
        session.add(ses)
        session.flush()

        msg = AskMessage(session_id=ses.id, role="assistant")
        session.add(msg)
        session.commit()
        assert msg.content == ""

    def test_check_constraint_role_rejects_invalid(self, session):
        ses = AskSession(model_name="m")
        session.add(ses)
        session.flush()

        msg = AskMessage(session_id=ses.id, role="bot", content="test")
        session.add(msg)
        with pytest.raises(Exception):
            session.commit()

    def test_check_constraint_status_rejects_invalid(self, session):
        ses = AskSession(model_name="m")
        session.add(ses)
        session.flush()

        msg = AskMessage(session_id=ses.id, role="user", content="test", status="invalid")
        session.add(msg)
        with pytest.raises(Exception):
            session.commit()


class TestRelationships:
    def test_session_llm_setting_optional(self, session):
        """AskSession.llm_setting_id can be null."""
        ses = AskSession(model_name="m")
        session.add(ses)
        session.commit()
        assert ses.llm_setting_id is None

    def test_message_belongs_to_session(self, session):
        ses = AskSession(model_name="m")
        session.add(ses)
        session.flush()

        msg = AskMessage(session_id=ses.id, role="user", content="hi")
        session.add(msg)
        session.commit()

        assert msg.session_id == ses.id
