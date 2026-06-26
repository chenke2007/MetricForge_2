"""Test AI ask API endpoints (session CRUD, message creation, SSE)."""

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


def test_create_session(client, active_setting):
    resp = client.post("/api/ask/sessions", json={})
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "新对话"
    assert data["id"] > 0


def test_list_sessions_empty(client):
    resp = client.get("/api/ask/sessions")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_create_and_get_session(client, active_setting):
    resp = client.post("/api/ask/sessions", json={"title": "测试会话"})
    sid = resp.json()["id"]

    resp = client.get(f"/api/ask/sessions/{sid}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "测试会话"
    assert "messages" in resp.json()


def test_get_session_not_found(client):
    resp = client.get("/api/ask/sessions/999")
    assert resp.status_code == 404


def test_update_session(client, active_setting):
    resp = client.post("/api/ask/sessions", json={})
    sid = resp.json()["id"]
    resp = client.put(f"/api/ask/sessions/{sid}", json={"title": "新标题"})
    assert resp.status_code == 200
    assert resp.json()["title"] == "新标题"


def test_delete_session(client, active_setting):
    resp = client.post("/api/ask/sessions", json={})
    sid = resp.json()["id"]
    resp = client.delete(f"/api/ask/sessions/{sid}")
    assert resp.status_code == 200
    resp = client.get(f"/api/ask/sessions/{sid}")
    assert resp.status_code == 404


def test_create_message(client, active_setting):
    resp = client.post("/api/ask/sessions", json={})
    sid = resp.json()["id"]

    resp = client.post(f"/api/ask/sessions/{sid}/messages", json={"content": "你好"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["user_message"]["role"] == "user"
    assert data["user_message"]["content"] == "你好"
    assert data["assistant_message"]["role"] == "assistant"
    assert data["assistant_message"]["status"] == "pending"


def test_get_messages(client, active_setting):
    resp = client.post("/api/ask/sessions", json={})
    sid = resp.json()["id"]
    client.post(f"/api/ask/sessions/{sid}/messages", json={"content": "Q1"})
    client.post(f"/api/ask/sessions/{sid}/messages", json={"content": "Q2"})

    resp = client.get(f"/api/ask/sessions/{sid}/messages")
    assert resp.status_code == 200
    messages = resp.json()
    assert len(messages) == 4  # Q1 + assistant1 + Q2 + assistant2
    assert messages[0]["content"] == "Q1"
    assert messages[2]["content"] == "Q2"


def test_create_message_no_session(client):
    resp = client.post("/api/ask/sessions/999/messages", json={"content": "test"})
    assert resp.status_code == 400  # ValueError caught as 400
