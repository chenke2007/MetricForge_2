import pytest
from fastapi.testclient import TestClient


def test_create_chart_draft(client: TestClient):
    response = client.post(
        "/api/chart-drafts",
        json={
            "title": "销售趋势",
            "sql_text": "SELECT * FROM sales",
            "datasource_id": None,
            "chart_config": {"chartType": "line", "xColumn": "date", "yColumn": "amount"},
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "销售趋势"
    assert data["chart_config"]["chartType"] == "line"
    assert "datasource_available" in data
    assert data["datasource_available"] is False


def test_create_chart_draft_with_empty_title(client: TestClient):
    response = client.post(
        "/api/chart-drafts",
        json={
            "title": "",
            "sql_text": "SELECT 1",
            "datasource_id": None,
            "chart_config": {"chartType": "bar", "xColumn": "a", "yColumn": "b"},
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["title"].startswith("未命名图表")


def test_create_chart_draft_missing_sql_text(client: TestClient):
    response = client.post(
        "/api/chart-drafts",
        json={
            "title": "T",
            "datasource_id": None,
            "chart_config": {"chartType": "bar"},
        },
    )
    assert response.status_code == 422


def test_create_chart_draft_missing_chart_config(client: TestClient):
    response = client.post(
        "/api/chart-drafts",
        json={
            "title": "T",
            "sql_text": "SELECT 1",
            "datasource_id": None,
        },
    )
    assert response.status_code == 422


def test_list_chart_drafts(client: TestClient):
    client.post(
        "/api/chart-drafts",
        json={
            "title": "T1",
            "sql_text": "SELECT 1",
            "datasource_id": None,
            "chart_config": {"chartType": "bar", "xColumn": "a", "yColumn": "b"},
        },
    )
    response = client.get("/api/chart-drafts")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["title"] == "T1"
    assert "datasource_available" in data[0]


def test_get_chart_draft(client: TestClient):
    create_resp = client.post(
        "/api/chart-drafts",
        json={
            "title": "T",
            "sql_text": "SELECT 1",
            "datasource_id": None,
            "chart_config": {"chartType": "bar"},
        },
    )
    draft_id = create_resp.json()["id"]
    response = client.get(f"/api/chart-drafts/{draft_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == draft_id
    assert data["title"] == "T"


def test_get_nonexistent_chart_draft(client: TestClient):
    response = client.get("/api/chart-drafts/9999")
    assert response.status_code == 404


def test_update_chart_draft(client: TestClient):
    create_resp = client.post(
        "/api/chart-drafts",
        json={
            "title": "Old",
            "sql_text": "SELECT 1",
            "datasource_id": None,
            "chart_config": {"chartType": "bar"},
        },
    )
    draft_id = create_resp.json()["id"]
    response = client.put(
        f"/api/chart-drafts/{draft_id}",
        json={"title": "New"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "New"
    assert data["sql_text"] == "SELECT 1"


def test_update_chart_draft_nonexistent(client: TestClient):
    response = client.put(
        "/api/chart-drafts/9999",
        json={"title": "New"},
    )
    assert response.status_code == 404


def test_delete_chart_draft(client: TestClient):
    create_resp = client.post(
        "/api/chart-drafts",
        json={
            "title": "T",
            "sql_text": "SELECT 1",
            "datasource_id": None,
            "chart_config": {"chartType": "bar"},
        },
    )
    draft_id = create_resp.json()["id"]
    response = client.delete(f"/api/chart-drafts/{draft_id}")
    assert response.status_code == 200
    assert response.json()["ok"] is True

    # Verify deleted
    response = client.get(f"/api/chart-drafts/{draft_id}")
    assert response.status_code == 404


def test_delete_chart_draft_nonexistent(client: TestClient):
    response = client.delete("/api/chart-drafts/9999")
    assert response.status_code == 404


def test_chart_draft_shows_datasource_unavailable(client: TestClient, db):
    from app.models.datasource import DatasourceConfig
    ds = DatasourceConfig(name="tmp", ds_type="oracle", host="h", port=1, username="u", dialect="oracle")
    db.add(ds)
    db.commit()
    db.refresh(ds)

    response = client.post(
        "/api/chart-drafts",
        json={
            "title": "T",
            "sql_text": "SELECT 1",
            "datasource_id": ds.id,
            "chart_config": {"chartType": "bar", "xColumn": "a", "yColumn": "b"},
        },
    )
    draft_id = response.json()["id"]

    db.delete(ds)
    db.commit()

    response = client.get(f"/api/chart-drafts/{draft_id}")
    data = response.json()
    assert data["datasource_available"] is False
    # Draft still readable after datasource deleted
    assert data["id"] == draft_id


def test_create_with_nonexistent_datasource_allowed(client: TestClient):
    """Drafts may reference datasources that don't exist yet; creation should not reject."""
    response = client.post(
        "/api/chart-drafts",
        json={
            "title": "T",
            "sql_text": "SELECT 1",
            "datasource_id": 9999,
            "chart_config": {"chartType": "bar"},
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["datasource_id"] == 9999
    assert data["datasource_available"] is False


def test_update_with_nonexistent_datasource_allowed(client: TestClient):
    create_resp = client.post(
        "/api/chart-drafts",
        json={
            "title": "T",
            "sql_text": "SELECT 1",
            "datasource_id": None,
            "chart_config": {"chartType": "bar"},
        },
    )
    draft_id = create_resp.json()["id"]
    response = client.put(
        f"/api/chart-drafts/{draft_id}",
        json={"datasource_id": 9999},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["datasource_id"] == 9999
    assert data["datasource_available"] is False
