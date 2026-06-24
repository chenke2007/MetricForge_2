"""Test LLM settings CRUD API."""

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


def test_list_empty(client):
    resp = client.get("/api/llm-settings")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_setting(client):
    resp = client.post("/api/llm-settings", json={
        "name": "DeepSeek V4",
        "base_url": "http://test.example.com:8080",
        "api_key": "sk-test-key-1234567890",
        "model_name": "DeepSeek-V4-Flash",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "DeepSeek V4"
    assert data["model_name"] == "DeepSeek-V4-Flash"
    assert "sk-****7890" in data["api_key_masked"]
    assert data["is_active"] is False
    assert "api_key" not in data  # never return plaintext


def test_get_setting(client):
    resp = client.post("/api/llm-settings", json={
        "name": "Qwen",
        "base_url": "http://localhost:8000",
        "api_key": "sk-qwen-key-demo",
        "model_name": "qwen2.5",
    })
    sid = resp.json()["id"]

    resp = client.get(f"/api/llm-settings/{sid}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Qwen"


def test_get_setting_not_found(client):
    resp = client.get("/api/llm-settings/999")
    assert resp.status_code == 404


def test_update_setting(client):
    resp = client.post("/api/llm-settings", json={
        "name": "Old",
        "base_url": "http://old.com",
        "api_key": "sk-old-key",
        "model_name": "old-model",
    })
    sid = resp.json()["id"]

    resp = client.put(f"/api/llm-settings/{sid}", json={"name": "New Name"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "New Name"
    # API key unchanged when not provided
    assert "sk-****" in resp.json()["api_key_masked"]


def test_activate_only_one(client):
    """激活一个配置时，其他配置应自动停用。"""
    resp1 = client.post("/api/llm-settings", json={
        "name": "A", "base_url": "http://a.com", "api_key": "sk-a", "model_name": "a"
    })
    id1 = resp1.json()["id"]
    resp2 = client.post("/api/llm-settings", json={
        "name": "B", "base_url": "http://b.com", "api_key": "sk-b", "model_name": "b"
    })
    id2 = resp2.json()["id"]

    client.post(f"/api/llm-settings/{id1}/activate")
    resp = client.get("/api/llm-settings")
    items = resp.json()
    active = [i for i in items if i["is_active"]]
    assert len(active) == 1
    assert active[0]["id"] == id1

    client.post(f"/api/llm-settings/{id2}/activate")
    resp = client.get("/api/llm-settings")
    items = resp.json()
    active = [i for i in items if i["is_active"]]
    assert len(active) == 1
    assert active[0]["id"] == id2


def test_delete_setting(client):
    resp = client.post("/api/llm-settings", json={
        "name": "Temp", "base_url": "http://t.com", "api_key": "sk-t", "model_name": "t"
    })
    sid = resp.json()["id"]
    resp = client.delete(f"/api/llm-settings/{sid}")
    assert resp.status_code == 200
    resp = client.get(f"/api/llm-settings/{sid}")
    assert resp.status_code == 404
