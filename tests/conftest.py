"""测试配置"""

import os

os.environ["METRICFORGE_DB_URL"] = "sqlite:///:memory:"

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.base import Base


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


@pytest.fixture
def app(tmp_path):
    """测试用 FastAPI 应用，使用临时 SQLite 数据库"""
    from app.main import create_app

    db_path = tmp_path / "metricforge-api-test.db"
    return create_app(database_url=f"sqlite:///{db_path}")


@pytest.fixture
def client(app):
    """测试用 HTTP 客户端"""
    from fastapi.testclient import TestClient
    return TestClient(app)
