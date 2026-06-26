"""Shared fixtures for ask API tests."""

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
def db(client):
    """Provide a db session for direct model manipulation in tests."""
    from app.models.base import get_session
    session = get_session()
    try:
        yield session
    finally:
        session.close()
