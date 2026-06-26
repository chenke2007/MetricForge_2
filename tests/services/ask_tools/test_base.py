# tests/services/ask_tools/test_base.py
import pytest
from app.services.ask_tools.base import MetadataTool, ToolCall, ToolResult, MetadataToolRegistry


async def fake_handler(db, name: str):
    return {"hello": name}


def test_metadata_tool_creation():
    tool = MetadataTool(
        name="greet",
        description="Say hello",
        parameters={"type": "object", "properties": {"name": {"type": "string"}}},
        handler=fake_handler,
        result_mode="direct",
    )
    assert tool.name == "greet"


def test_registry_register_and_get():
    registry = MetadataToolRegistry()
    tool = MetadataTool(
        name="greet",
        description="Say hello",
        parameters={"type": "object", "properties": {"name": {"type": "string"}}},
        handler=fake_handler,
        result_mode="direct",
    )
    registry.register(tool)
    assert registry.get("greet") == tool


def test_registry_to_openai_tools():
    registry = MetadataToolRegistry()
    tool = MetadataTool(
        name="greet",
        description="Say hello",
        parameters={"type": "object", "properties": {"name": {"type": "string"}}},
        handler=fake_handler,
        result_mode="direct",
    )
    registry.register(tool)
    openai_tools = registry.to_openai_tools()
    assert len(openai_tools) == 1
    assert openai_tools[0]["type"] == "function"
    assert openai_tools[0]["function"]["name"] == "greet"


def test_tool_result_success_and_error():
    success = ToolResult.success("greet", {"name": "Alice"}, {"hello": "Alice"})
    assert success.status == "success"
    error = ToolResult.error("greet", {"name": "Alice"}, "boom")
    assert error.status == "error"
    assert error.error_message == "boom"
