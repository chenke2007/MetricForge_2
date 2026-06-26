"""AI Ask metadata tools package.

Exports:
    registry: Global MetadataToolRegistry instance
    router: ToolRouter class
    executor: ToolExecutor class
    tools: Built-in metadata tool definitions module
"""

from .base import MetadataToolRegistry, ToolCall, ToolResult, MetadataTool
from .registry import registry
from .router import ToolRouter
from .executor import ToolExecutor
from . import tools

__all__ = [
    "MetadataToolRegistry",
    "ToolCall",
    "ToolResult",
    "MetadataTool",
    "registry",
    "ToolRouter",
    "ToolExecutor",
    "tools",
]
