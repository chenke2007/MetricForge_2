# app/services/ask_tools/base.py
from dataclasses import dataclass
from typing import Any, Awaitable, Callable


@dataclass
class MetadataTool:
    name: str
    description: str
    parameters: dict
    handler: Callable[..., Awaitable[Any]]
    result_mode: str  # "direct" | "llm_summary"


@dataclass
class ToolCall:
    name: str
    arguments: dict


@dataclass
class ToolResult:
    name: str
    arguments: dict
    result: Any | None
    status: str
    error_message: str | None = None

    @staticmethod
    def success(name: str, arguments: dict, result: Any) -> "ToolResult":
        return ToolResult(
            name=name,
            arguments=arguments,
            result=result,
            status="success",
        )

    @staticmethod
    def error(name: str, arguments: dict, message: str) -> "ToolResult":
        return ToolResult(
            name=name,
            arguments=arguments,
            result=None,
            status="error",
            error_message=message,
        )


class MetadataToolRegistry:
    def __init__(self):
        self._tools: dict[str, MetadataTool] = {}

    def register(self, tool: MetadataTool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> MetadataTool | None:
        return self._tools.get(name)

    def list_tools(self) -> list[MetadataTool]:
        return list(self._tools.values())

    def to_openai_tools(self) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                },
            }
            for tool in self._tools.values()
        ]
