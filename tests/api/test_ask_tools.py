"""Test AI ask API messages include tool_calls."""

import os
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("METRICFORGE_ENC_KEY", "test-master-key-0123456789")

from app.main import create_app


@pytest.fixture
def client(tmp_path):
    db_path = tmp_path / "test.db"
    app = create_app(database_url=f"sqlite:///{db_path}")
    with TestClient(app) as c:
        yield c


@pytest.fixture
def active_setting(client):
    """Create and activate an LLM setting so ask endpoints work."""
    resp = client.post("/api/llm-settings", json={
        "name": "Test Model",
        "base_url": "http://test.example.com:8080",
        "api_key": "sk-test-key-1234567890",
        "model_name": "Test-Model",
    })
    sid = resp.json()["id"]
    client.post(f"/api/llm-settings/{sid}/activate")
    return sid


@pytest.fixture
def sample_ask_session(client, active_setting):
    """Create a sample ask session and return its id."""
    resp = client.post("/api/ask/sessions", json={})
    return resp.json()


@pytest.fixture
def db(client):
    """Provide a db session for direct model manipulation in tests."""
    from app.models.base import get_session
    session = get_session()
    try:
        yield session
    finally:
        session.close()


def test_messages_include_tool_calls(client, db, sample_ask_session):
    from app.models import AskMessage, AskMessageToolCall
    msg = AskMessage(session_id=sample_ask_session["id"], role="assistant", content="answer", status="completed")
    db.add(msg)
    db.commit()
    db.refresh(msg)
    tc = AskMessageToolCall(
        message_id=msg.id,
        tool_name="datasource_stats",
        arguments="{}",
        result='{"total": 2}',
        status="success",
    )
    db.add(tc)
    db.commit()

    resp = client.get(f"/api/ask/sessions/{sample_ask_session['id']}/messages")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert len(data[0]["tool_calls"]) == 1
    assert data[0]["tool_calls"][0]["tool_name"] == "datasource_stats"
    assert data[0]["tool_calls"][0]["arguments"] == "{}"
    assert data[0]["tool_calls"][0]["result"] == '{"total": 2}'
    assert data[0]["tool_calls"][0]["status"] == "success"
