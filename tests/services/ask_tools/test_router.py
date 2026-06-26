import pytest
from unittest.mock import MagicMock

from app.services.ask_tools.base import MetadataTool, MetadataToolRegistry
from app.services.ask_tools.router import ToolRouter
from app.services.ask_tools.tools import datasource_stats


def make_registry():
    r = MetadataToolRegistry()
    r.register(
        MetadataTool(
            name="datasource_stats",
            description="统计数据源",
            parameters={"type": "object", "properties": {}},
            handler=datasource_stats,
            result_mode="direct",
        )
    )
    return r


@pytest.mark.asyncio
async def test_rule_route_datasource():
    router = ToolRouter(make_registry(), client=None, model="gpt")
    calls = await router.route("系统里接了几个数据源？")
    assert len(calls) == 1
    assert calls[0].name == "datasource_stats"


@pytest.mark.asyncio
async def test_rule_route_empty():
    router = ToolRouter(make_registry(), client=None, model="gpt")
    calls = await router.route("你好")
    assert calls == []


@pytest.mark.asyncio
async def test_llm_route_uses_tools():
    fake_response = MagicMock()
    fake_message = MagicMock()
    fake_func = MagicMock()
    fake_func.name = "datasource_stats"
    fake_func.arguments = "{}"
    fake_message.tool_calls = [
        MagicMock(function=fake_func),
    ]
    fake_response.choices = [MagicMock(message=fake_message)]

    client = MagicMock()
    client.chat.completions.create = MagicMock(return_value=fake_response)

    router = ToolRouter(make_registry(), client=client, model="gpt")
    calls = await router.route("请帮我查看当前数据连接情况")
    assert len(calls) == 1
    assert calls[0].name == "datasource_stats"
    client.chat.completions.create.assert_called_once()
