import asyncio

from sqlalchemy.orm import Session

from app.services.ask_tools.base import MetadataToolRegistry, ToolCall, ToolResult


class ToolExecutor:
    def __init__(self, registry: MetadataToolRegistry):
        self.registry = registry

    async def execute(self, calls: list[ToolCall], db: Session) -> list[ToolResult]:
        coros = [self._execute_one(call, db) for call in calls]
        return await asyncio.gather(*coros)

    async def _execute_one(self, call: ToolCall, db: Session) -> ToolResult:
        tool = self.registry.get(call.name)
        if not tool:
            return ToolResult.error(
                name=call.name,
                arguments=call.arguments,
                message=f"工具 {call.name} 未注册",
            )
        try:
            result = await tool.handler(db, **call.arguments)
            return ToolResult.success(
                name=call.name,
                arguments=call.arguments,
                result=result,
            )
        except Exception as e:
            return ToolResult.error(
                name=call.name,
                arguments=call.arguments,
                message=str(e),
            )
