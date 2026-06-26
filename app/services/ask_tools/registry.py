# app/services/ask_tools/registry.py
from app.services.ask_tools.base import MetadataTool, MetadataToolRegistry

registry = MetadataToolRegistry()


def register_tool(tool: MetadataTool) -> None:
    registry.register(tool)
