from app.services.ask_tools.base import MetadataTool, MetadataToolRegistry
from app.services.ask_tools.tools import (
    datasource_stats,
    governance_ticket_stats,
    latest_collection_job,
    schema_metadata_query,
)

registry = MetadataToolRegistry()


def _register_all() -> None:
    registry.register(
        MetadataTool(
            name="datasource_stats",
            description="查询 MetricForge 当前接入的数据源统计信息，包括数量、类型、启用状态。",
            parameters={
                "type": "object",
                "properties": {},
                "required": [],
            },
            handler=datasource_stats,
            result_mode="direct",
        )
    )
    registry.register(
        MetadataTool(
            name="latest_collection_job",
            description="查询最近一次元数据采集任务的状态、执行时间、采集到的表/字段数量。",
            parameters={
                "type": "object",
                "properties": {
                    "datasource_id": {
                        "type": "integer",
                        "description": "可选，按数据源 ID 筛选",
                    }
                },
                "required": [],
            },
            handler=latest_collection_job,
            result_mode="direct",
        )
    )
    registry.register(
        MetadataTool(
            name="schema_metadata_query",
            description="按表名、字段名或注释搜索 schema/table/column 元数据。",
            parameters={
                "type": "object",
                "properties": {
                    "keyword": {
                        "type": "string",
                        "description": "搜索关键词，例如表名、字段名、注释中的关键词",
                    },
                    "schema_name": {
                        "type": "string",
                        "description": "可选，按 schema 筛选",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "返回表数量上限，默认 10",
                        "default": 10,
                    },
                },
                "required": ["keyword"],
            },
            handler=schema_metadata_query,
            result_mode="llm_summary",
        )
    )
    registry.register(
        MetadataTool(
            name="governance_ticket_stats",
            description="查询治理待办的统计信息，可按状态、类型分组。",
            parameters={
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "description": "可选，按状态筛选: open/in_progress/resolved/closed",
                    },
                    "ticket_type": {
                        "type": "string",
                        "description": "可选，按待办类型筛选",
                    },
                },
                "required": [],
            },
            handler=governance_ticket_stats,
            result_mode="direct",
        )
    )


_register_all()
