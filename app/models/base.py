"""SQLAlchemy 数据库引擎和会话管理"""

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    """声明式基类"""
    pass


# 全局引擎和会话工厂（由 init_db 初始化）
_engine = None
_SessionLocal = None


def init_db(database_url: str, debug: bool = False):
    """初始化数据库引擎和会话工厂"""
    global _engine, _SessionLocal
    _engine = create_engine(database_url, echo=debug, connect_args={"check_same_thread": False} if "sqlite" in database_url else {})
    _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)


def get_engine():
    """获取数据库引擎"""
    if _engine is None:
        raise RuntimeError("数据库未初始化，请先调用 init_db()")
    return _engine


def get_session():
    """获取数据库会话"""
    if _SessionLocal is None:
        raise RuntimeError("数据库未初始化，请先调用 init_db()")
    return _SessionLocal()


def init_tables():
    """创建所有表（基于 Base 的元数据），并补齐轻量迁移。"""
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    from app.services.schema_migration_service import ensure_sqlite_schema

    ensure_sqlite_schema(engine)
