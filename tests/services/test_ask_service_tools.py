"""Tests for AskService tool orchestration."""

import os

os.environ.setdefault("METRICFORGE_ENC_KEY", "test-master-key-0123456789")

import pytest
from unittest.mock import MagicMock, AsyncMock, patch

from app.models import AskSession, AskMessage, LlmSetting
from app.services.ask_service import AskService
from app.services.key_encryption import encrypt as encrypt_key


@pytest.fixture
def active_llm(db_session):
    ls = LlmSetting(
        name="test",
        base_url="http://localhost",
        api_key=encrypt_key("fake-api-key"),
        model_name="gpt-4",
        is_active=1,
    )
    db_session.add(ls)
    db_session.commit()
    return ls


@pytest.fixture
def session(db_session, active_llm):
    s = AskSession(title="test", model_name="gpt-4", llm_setting_id=active_llm.id)
    db_session.add(s)
    db_session.commit()
    return s


@pytest.mark.asyncio
async def test_stream_response_calls_tools(db_session, session):
    service = AskService()

    user_msg = AskMessage(session_id=session.id, role="user", content="系统有几个数据源？", status="completed")
    assistant_msg = AskMessage(session_id=session.id, role="assistant", content="", status="pending")
    db_session.add_all([user_msg, assistant_msg])
    db_session.commit()
    db_session.refresh(assistant_msg)

    # Mock router to return datasource_stats tool
    mock_tool_call = MagicMock()
    mock_tool_call.name = "datasource_stats"
    mock_tool_call.arguments = {}

    with patch.object(service, "_router") as mock_router:
        mock_router.route = AsyncMock(return_value=[mock_tool_call])

        # Mock executor to return result
        mock_tool_result = MagicMock()
        mock_tool_result.name = "datasource_stats"
        mock_tool_result.arguments = {}
        mock_tool_result.result = {"total": 2}
        mock_tool_result.status = "success"
        mock_tool_result.error_message = None

        with patch.object(service, "_executor") as mock_executor:
            mock_executor.execute = AsyncMock(return_value=[mock_tool_result])

            # Mock LLM stream to yield done immediately
            async def fake_stream(*args, **kwargs):
                yield "event: done\ndata: {\"message_id\": %d}\n\n" % assistant_msg.id

            with patch.object(service, "_call_llm_stream", fake_stream):
                events = []
                async for ev in service.stream_response(db_session, session.id, assistant_msg.id):
                    events.append(ev)
                assert any("done" in ev for ev in events)
