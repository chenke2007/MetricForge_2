"""End-to-end integration test for tool call SSE flow."""

import os
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

os.environ.setdefault("METRICFORGE_ENC_KEY", "test-master-key-0123456789")

from app.main import create_app
from app.models import AskSession, AskMessage, LlmSetting
from app.services.key_encryption import encrypt as encrypt_key


@pytest.fixture
def client(tmp_path):
    db_path = tmp_path / "test.db"
    app = create_app(database_url=f"sqlite:///{db_path}")
    with TestClient(app) as c:
        yield c


@pytest.fixture
def db(client):
    """Provide a db session for direct model manipulation in tests."""
    from app.models.base import get_session
    session = get_session()
    try:
        yield session
    finally:
        session.close()


def test_ask_flow_with_tool_calls(client: TestClient, db):
    """Verify SSE stream includes tool_call_start and tool_call_done events."""
    enc_key = encrypt_key("sk-test-key")
    ls = LlmSetting(name="test", base_url="http://localhost", api_key=enc_key, model_name="gpt", is_active=1)
    db.add(ls)
    db.commit()

    s = AskSession(title="t", model_name="gpt", llm_setting_id=ls.id)
    db.add(s)
    db.commit()
    db.refresh(s)

    # Create user message and assistant placeholder
    user_msg = AskMessage(session_id=s.id, role="user", content="有几个数据源？", status="completed")
    db.add(user_msg)
    db.flush()
    assistant_msg = AskMessage(session_id=s.id, role="assistant", content="", status="pending")
    db.add(assistant_msg)
    db.commit()
    db.refresh(assistant_msg)

    # Mock LLM routing to return datasource_stats tool call
    fake_tool_call = MagicMock()
    fake_tool_call.name = "datasource_stats"
    fake_tool_call.arguments = {}

    fake_msg = MagicMock()
    fake_msg.tool_calls = [fake_tool_call]
    fake_response = MagicMock(choices=[MagicMock(message=fake_msg)])

    # Mock OpenAI client to avoid real network calls
    with patch("app.services.ask_service.OpenAI") as mock_openai:
        instance = MagicMock()
        instance.chat.completions.create = MagicMock(return_value=fake_response)
        mock_openai.return_value = instance

        # Mock the router's LLM call to return our tool call
        with patch("app.services.ask_tools.router.ToolRouter.route") as mock_route:
            mock_route.return_value = [fake_tool_call]

            resp = client.post(
                f"/api/ask/sessions/{s.id}/messages",
                json={"content": "有几个数据源？"},
            )
            assert resp.status_code == 201

            events = []
            with client.stream(
                "GET", f"/api/ask/sessions/{s.id}/stream?after={assistant_msg.id}&_t=x"
            ) as response:
                for line in response.iter_lines():
                    if line:
                        events.append(line)

            assert any("tool_call_start" in ev for ev in events), f"Expected tool_call_start in events: {events}"
            assert any("tool_call_done" in ev for ev in events), f"Expected tool_call_done in events: {events}"
