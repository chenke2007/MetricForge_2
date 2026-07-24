"""Tests for AskService tool orchestration."""

import json
import os
from datetime import datetime, timezone

os.environ.setdefault("METRICFORGE_ENC_KEY", "test-master-key-0123456789")

import pytest
from unittest.mock import MagicMock, AsyncMock, patch

from app.models import AskSession, AskMessage, LlmSetting
from app.services.ask_service import AskService, _safe_load_response_json
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

    mock_router = MagicMock()
    mock_router.route = AsyncMock(return_value=[mock_tool_call])

    with patch.object(service, "_init_router", return_value=mock_router):
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


# ---- Task 1: response_json 版本化 envelope 基础能力 ----


def test_safe_load_response_json_valid():
    obj = {"schemaVersion": 1, "data": {"narrativeLevel": "sql_pending"}}
    result = _safe_load_response_json(json.dumps(obj))
    assert result == obj


def test_safe_load_response_json_null():
    assert _safe_load_response_json(None) is None


def test_safe_load_response_json_empty():
    assert _safe_load_response_json("") is None


def test_safe_load_response_json_bad_json():
    assert _safe_load_response_json("not json") is None


def test_safe_load_response_json_unknown_version():
    obj = {"schemaVersion": 99, "data": {}}
    assert _safe_load_response_json(json.dumps(obj)) is None


def test_safe_load_response_json_not_dict():
    assert _safe_load_response_json('"string"') is None


def test_response_json_migration_is_idempotent():
    """创建缺少 response_json 列的旧版 ask_messages 表，连续执行两次迁移，
    验证 response_json 列只新增一次。"""
    from app.services.schema_migration_service import ensure_sqlite_schema
    from sqlalchemy import create_engine, MetaData, Table, Column, Integer, String, Text, text

    engine = create_engine("sqlite://", echo=False)

    # 创建旧版 ask_messages 表（无 response_json 列）
    meta = MetaData()
    Table(
        "ask_messages", meta,
        Column("id", Integer, primary_key=True),
        Column("session_id", Integer),
        Column("role", String(20)),
        Column("status", String(20)),
        Column("content", Text),
    )
    meta.create_all(engine)

    # 第一次迁移
    ensure_sqlite_schema(engine)

    # 第二次迁移——不得抛错
    ensure_sqlite_schema(engine)

    with engine.connect() as conn:
        result = conn.execute(text(
            "SELECT COUNT(*) FROM pragma_table_info('ask_messages') "
            "WHERE name='response_json'"
        ))
        assert result.scalar() == 1, "response_json column not added or duplicated"


def _make_assistant_message(response_json):
    return AskMessage(
        id=1,
        session_id=1,
        role="assistant",
        content="",
        status="completed",
        response_json=response_json,
        created_at=datetime.now(timezone.utc),
    )


def test_message_to_dict_returns_parsed_response_json():
    obj = {"schemaVersion": 1, "data": {"narrativeLevel": "sql_pending"}}
    m = _make_assistant_message(json.dumps(obj))
    result = AskService._message_to_dict(m)
    assert result["response_json"] == obj


def test_message_to_dict_invalid_response_json_fails_closed():
    m = _make_assistant_message("not json")
    result = AskService._message_to_dict(m)
    assert result["response_json"] is None
