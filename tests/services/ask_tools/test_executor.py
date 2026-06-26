import pytest
from unittest.mock import AsyncMock

from app.services.ask_tools.base import MetadataTool, ToolCall, ToolResult
from app.services.ask_tools.executor import ToolExecutor


@pytest.mark.asyncio
async def test_execute_single_tool(db_session):
    registry = type("R", (), {})()
    registry.get = lambda name: MetadataTool(
        name="echo",
        description="echo",
        parameters={},
        handler=AsyncMock(return_value={"ok": True}),
        result_mode="direct",
    )
    executor = ToolExecutor(registry)
    results = await executor.execute([ToolCall(name="echo", arguments={"x": 1})], db_session)
    assert len(results) == 1
    assert results[0].status == "success"
    assert results[0].result == {"ok": True}


@pytest.mark.asyncio
async def test_execute_tool_not_found(db_session):
    registry = type("R", (), {})()
    registry.get = lambda name: None
    executor = ToolExecutor(registry)
    results = await executor.execute([ToolCall(name="missing", arguments={})], db_session)
    assert results[0].status == "error"


@pytest.mark.asyncio
async def test_execute_tool_exception(db_session):
    async def boom(db, **kwargs):
        raise ValueError("boom")

    registry = type("R", (), {})()
    registry.get = lambda name: MetadataTool(
        name="boom",
        description="boom",
        parameters={},
        handler=boom,
        result_mode="direct",
    )
    executor = ToolExecutor(registry)
    results = await executor.execute([ToolCall(name="boom", arguments={})], db_session)
    assert results[0].status == "error"
    assert "boom" in results[0].error_message
