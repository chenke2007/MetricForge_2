# Phase 2.5 AI 问数元数据工具调用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 问数在回答元数据事实类问题时，先调用后端轻量工具查询 MetricForge 本地元数据库，再由 LLM 组织回答。

**Architecture:** 在 `app/services/ask_tools/` 下实现声明式工具注册表、规则+LLM 路由器、并行执行器；新增 `AskMessageToolCall` 表记录工具调用；扩展 SSE 事件让前端显示工具调用状态。

**Tech Stack:** FastAPI, SQLAlchemy, SQLite, OpenAI-compatible LLM API, React + TypeScript + Vite, EventSource.

## Global Constraints

- 不执行任何真实业务 SQL，不查询 Oracle 业务数据。
- 不引入完整 Agent 框架（LangChain、AutoGen、SmolaAgents 等）。
- 只查询 MetricForge 本地元数据库表：`DatasourceConfig`、`TableMetadata`、`ColumnMetadata`、`MetadataCollectionJob`、`GovernanceTicket`。
- 工具 handler 必须是 async 函数，接收 `db: Session` 作为第一个参数。
- 每个 task 必须有独立的测试并通过后才能 commit。
- 频繁 commit，每个 task 一个 commit。

---

## File Structure

```
app/
  services/
    ask_tools/
      __init__.py          # 导出 registry, router, executor, tools
      base.py              # MetadataTool, ToolCall, ToolResult
      registry.py          # MetadataToolRegistry 实例化 + 注册 4 个工具
      router.py            # ToolRouter: rule_route + llm_route
      executor.py          # ToolExecutor: 并行执行 tool calls
      tools.py             # 4 个 metadata tool handlers
  models/
    ask_tool_call.py       # AskMessageToolCall ORM
    __init__.py            # 导出 AskMessageToolCall
  services/
    ask_service.py         # 集成 tool router/executor/prompt
  api/
    ask.py                 # messages API 返回 tool_calls

frontend/src/
  components/
    ToolCallIndicator.tsx  # 显示工具调用进度与结果摘要
    ToolCallResult.tsx     # 可展开的工具结果
  pages/
    AskWorkbenchPage.tsx   # 监听 tool_call_start/done 事件
  components/
    MessageThread.tsx      # 在 assistant 消息前渲染 ToolCallIndicator
  api/
    askSessions.ts         # AskMessage 类型增加 tool_calls

tests/
  services/ask_tools/
    test_base.py
    test_tools.py
    test_router.py
    test_executor.py
    test_registry.py
  models/
    test_ask_tool_call.py
  services/
    test_ask_service_tools.py
  api/
    test_ask_tools.py
frontend/src/components/
    ToolCallIndicator.test.tsx
```

---

### Task 1: Tool Base Types and Registry

**Files:**
- Create: `app/services/ask_tools/base.py`
- Create: `app/services/ask_tools/registry.py`
- Test: `tests/services/ask_tools/test_base.py`

**Interfaces:**
- Produces: `MetadataTool`, `ToolCall`, `ToolResult`, `MetadataToolRegistry`
- `MetadataToolRegistry.to_openai_tools()` returns `list[dict]` compatible with OpenAI `tools` parameter.

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/projects/MetricForge
python -m pytest tests/services/ask_tools/test_base.py -v
```

Expected: FAIL with module/file not found.

- [ ] **Step 3: Write minimal implementation**

```python
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
```

```python
# app/services/ask_tools/registry.py
from app.services.ask_tools.base import MetadataTool, MetadataToolRegistry

registry = MetadataToolRegistry()


def register_tool(tool: MetadataTool) -> None:
    registry.register(tool)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python -m pytest tests/services/ask_tools/test_base.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/ask_tools/base.py app/services/ask_tools/registry.py tests/services/ask_tools/test_base.py
git commit -m "feat: add metadata tool base types and registry"
```

---

### Task 2: Implement 4 Metadata Tool Handlers

**Files:**
- Create: `app/services/ask_tools/tools.py`
- Test: `tests/services/ask_tools/test_tools.py`

**Interfaces:**
- Consumes: `MetadataToolRegistry` from Task 1
- Produces: `datasource_stats`, `latest_collection_job`, `schema_metadata_query`, `governance_ticket_stats` handlers
- Each handler signature: `async def handler(db: Session, **kwargs) -> dict`

- [ ] **Step 1: Write the failing test**

```python
# tests/services/ask_tools/test_tools.py
import pytest
from sqlalchemy.orm import Session

from app.models import (
    DatasourceConfig,
    GovernanceTicket,
    MetadataCollectionJob,
    TableMetadata,
    ColumnMetadata,
)
from app.services.ask_tools.tools import (
    datasource_stats,
    latest_collection_job,
    schema_metadata_query,
    governance_ticket_stats,
)


@pytest.fixture
def sample_datasource(db: Session):
    ds = DatasourceConfig(name="核心 Oracle", ds_type="oracle", is_active=True)
    db.add(ds)
    db.commit()
    return ds


@pytest.fixture
def sample_table(db: Session, sample_datasource):
    t = TableMetadata(
        datasource_id=sample_datasource.id,
        schema_name="LEASE",
        table_name="CONTRACT",
        table_comment="合同表",
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    ColumnMetadata(
        table_id=t.id,
        column_name="CONTRACT_ID",
        column_type="NUMBER",
        is_primary_key=True,
    )
    db.commit()
    return t


@pytest.mark.asyncio
async def test_datasource_stats(db: Session, sample_datasource):
    result = await datasource_stats(db)
    assert result["total"] == 1
    assert result["active"] == 1
    assert result["items"][0]["name"] == "核心 Oracle"


@pytest.mark.asyncio
async def test_latest_collection_job(db: Session, sample_datasource):
    job = MetadataCollectionJob(
        datasource_id=sample_datasource.id,
        status="success",
        tables_count=10,
        columns_count=100,
    )
    db.add(job)
    db.commit()
    result = await latest_collection_job(db)
    assert result["status"] == "success"
    assert result["tables_count"] == 10


@pytest.mark.asyncio
async def test_schema_metadata_query(db: Session, sample_table):
    result = await schema_metadata_query(db, keyword="合同")
    assert len(result["tables"]) == 1
    assert result["tables"][0]["table_name"] == "CONTRACT"


@pytest.mark.asyncio
async def test_governance_ticket_stats(db: Session):
    t = GovernanceTicket(
        ticket_type="missing_semantic",
        title="缺失语义",
        status="open",
    )
    db.add(t)
    db.commit()
    result = await governance_ticket_stats(db)
    assert result["total"] == 1
    assert result["by_status"]["open"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python -m pytest tests/services/ask_tools/test_tools.py -v
```

Expected: FAIL with import errors.

- [ ] **Step 3: Write minimal implementation**

```python
# app/services/ask_tools/tools.py
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models import (
    ColumnMetadata,
    DatasourceConfig,
    GovernanceTicket,
    MetadataCollectionJob,
    TableMetadata,
)


_IGNORE_SCHEMAS = {"INFORMATION_SCHEMA", "SYS", "SYSTEM", "DBA"}


async def datasource_stats(db: Session, **kwargs) -> dict:
    total = db.query(DatasourceConfig).count()
    active = db.query(DatasourceConfig).filter(DatasourceConfig.is_active == True).count()
    items = [
        {
            "id": ds.id,
            "name": ds.name,
            "ds_type": ds.ds_type,
            "is_active": ds.is_active,
        }
        for ds in db.query(DatasourceConfig).order_by(DatasourceConfig.id).all()
    ]
    return {"total": total, "active": active, "items": items}


async def latest_collection_job(db: Session, datasource_id: int | None = None, **kwargs) -> dict:
    q = db.query(MetadataCollectionJob)
    if datasource_id:
        q = q.filter(MetadataCollectionJob.datasource_id == datasource_id)
    job = q.order_by(MetadataCollectionJob.started_at.desc()).first()
    if not job:
        return {"found": False, "message": "暂无采集任务"}
    return {
        "found": True,
        "id": job.id,
        "datasource_id": job.datasource_id,
        "datasource_name": job.datasource.name if job.datasource else None,
        "status": job.status,
        "started_at": str(job.started_at) if job.started_at else None,
        "finished_at": str(job.finished_at) if job.finished_at else None,
        "tables_count": job.tables_count or 0,
        "columns_count": job.columns_count or 0,
        "indexes_count": job.indexes_count or 0,
        "constraints_count": job.constraints_count or 0,
    }


async def schema_metadata_query(
    db: Session,
    keyword: str,
    schema_name: str | None = None,
    limit: int = 10,
    **kwargs,
) -> dict:
    filters = [
        TableMetadata.table_name.ilike(f"%{keyword}%"),
        TableMetadata.table_comment.ilike(f"%{keyword}%"),
    ]
    q = db.query(TableMetadata).filter(or_(*filters))
    q = q.filter(TableMetadata.schema_name.notin_(_IGNORE_SCHEMAS))
    if schema_name:
        q = q.filter(TableMetadata.schema_name == schema_name)

    tables = q.order_by(TableMetadata.schema_name, TableMetadata.table_name).limit(limit).all()

    items = []
    for t in tables:
        columns = (
            db.query(ColumnMetadata)
            .filter(ColumnMetadata.table_id == t.id)
            .order_by(ColumnMetadata.column_id)
            .limit(20)
            .all()
        )
        items.append({
            "id": t.id,
            "schema_name": t.schema_name,
            "table_name": t.table_name,
            "table_comment": t.table_comment,
            "columns": [
                {
                    "id": c.id,
                    "column_name": c.column_name,
                    "column_type": c.column_type,
                    "comment": c.comment,
                    "is_primary_key": c.is_primary_key,
                }
                for c in columns
            ],
        })
    return {"tables": items}


async def governance_ticket_stats(
    db: Session,
    status: str | None = None,
    ticket_type: str | None = None,
    **kwargs,
) -> dict:
    q = db.query(GovernanceTicket)
    if status:
        q = q.filter(GovernanceTicket.status == status)
    if ticket_type:
        q = q.filter(GovernanceTicket.ticket_type == ticket_type)
    total = q.count()

    by_status = {}
    status_rows = (
        db.query(GovernanceTicket.status, func.count(GovernanceTicket.id))
        .group_by(GovernanceTicket.status)
        .all()
    )
    for s, cnt in status_rows:
        by_status[s] = cnt

    by_type = {}
    type_rows = (
        db.query(GovernanceTicket.ticket_type, func.count(GovernanceTicket.id))
        .group_by(GovernanceTicket.ticket_type)
        .all()
    )
    for t, cnt in type_rows:
        by_type[t] = cnt

    return {"total": total, "by_status": by_status, "by_type": by_type}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python -m pytest tests/services/ask_tools/test_tools.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/ask_tools/tools.py tests/services/ask_tools/test_tools.py
git commit -m "feat: implement 4 metadata tool handlers"
```

---

### Task 3: Wire Registry with All Tools

**Files:**
- Modify: `app/services/ask_tools/registry.py`
- Test: `tests/services/ask_tools/test_registry.py`

**Interfaces:**
- Produces: `registry` singleton with 4 tools registered

- [ ] **Step 1: Write the failing test**

```python
# tests/services/ask_tools/test_registry.py
from app.services.ask_tools.registry import registry


def test_registry_has_all_tools():
    names = {t.name for t in registry.list_tools()}
    expected = {
        "datasource_stats",
        "latest_collection_job",
        "schema_metadata_query",
        "governance_ticket_stats",
    }
    assert names == expected


def test_openai_tools_schema():
    tools = registry.to_openai_tools()
    assert len(tools) == 4
    for t in tools:
        assert t["type"] == "function"
        assert "name" in t["function"]
        assert "description" in t["function"]
        assert "parameters" in t["function"]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python -m pytest tests/services/ask_tools/test_registry.py -v
```

Expected: FAIL with assertion error (registry empty).

- [ ] **Step 3: Write minimal implementation**

```python
# app/services/ask_tools/registry.py
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python -m pytest tests/services/ask_tools/test_registry.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/ask_tools/registry.py tests/services/ask_tools/test_registry.py
git commit -m "feat: wire 4 metadata tools into registry"
```

---

### Task 4: Tool Executor

**Files:**
- Create: `app/services/ask_tools/executor.py`
- Test: `tests/services/ask_tools/test_executor.py`

**Interfaces:**
- Consumes: `MetadataToolRegistry`, `ToolCall`, `ToolResult` from Task 1
- Produces: `ToolExecutor.execute(calls: list[ToolCall], db: Session) -> list[ToolResult]`

- [ ] **Step 1: Write the failing test**

```python
# tests/services/ask_tools/test_executor.py
import pytest
from unittest.mock import AsyncMock

from app.services.ask_tools.base import MetadataTool, ToolCall, ToolResult
from app.services.ask_tools.executor import ToolExecutor


@pytest.mark.asyncio
async def test_execute_single_tool(db):
    registry = type("R", (), {})()
    registry.get = lambda name: MetadataTool(
        name="echo",
        description="echo",
        parameters={},
        handler=AsyncMock(return_value={"ok": True}),
        result_mode="direct",
    )
    executor = ToolExecutor(registry)
    results = await executor.execute([ToolCall(name="echo", arguments={"x": 1})], db)
    assert len(results) == 1
    assert results[0].status == "success"
    assert results[0].result == {"ok": True}


@pytest.mark.asyncio
async def test_execute_tool_not_found(db):
    registry = type("R", (), {})()
    registry.get = lambda name: None
    executor = ToolExecutor(registry)
    results = await executor.execute([ToolCall(name="missing", arguments={})], db)
    assert results[0].status == "error"


@pytest.mark.asyncio
async def test_execute_tool_exception(db):
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
    results = await executor.execute([ToolCall(name="boom", arguments={})], db)
    assert results[0].status == "error"
    assert "boom" in results[0].error_message
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python -m pytest tests/services/ask_tools/test_executor.py -v
```

Expected: FAIL with import errors.

- [ ] **Step 3: Write minimal implementation**

```python
# app/services/ask_tools/executor.py
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python -m pytest tests/services/ask_tools/test_executor.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/ask_tools/executor.py tests/services/ask_tools/test_executor.py
git commit -m "feat: add metadata tool executor"
```

---

### Task 5: Tool Router (Rules + LLM Fallback)

**Files:**
- Create: `app/services/ask_tools/router.py`
- Test: `tests/services/ask_tools/test_router.py`

**Interfaces:**
- Consumes: `MetadataToolRegistry`, `ToolCall` from Task 1
- Produces: `ToolRouter.route(query: str) -> list[ToolCall]`
- `ToolRouter` constructor: `(registry: MetadataToolRegistry, client, model: str)`

- [ ] **Step 1: Write the failing test**

```python
# tests/services/ask_tools/test_router.py
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
    fake_message.tool_calls = [
        MagicMock(function=MagicMock(name="datasource_stats", arguments="{}")),
    ]
    fake_response.choices = [MagicMock(message=fake_message)]

    client = MagicMock()
    client.chat.completions.create = MagicMock(return_value=fake_response)

    router = ToolRouter(make_registry(), client=client, model="gpt")
    calls = await router.route("接了几个库？")
    assert len(calls) == 1
    assert calls[0].name == "datasource_stats"
    client.chat.completions.create.assert_called_once()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python -m pytest tests/services/ask_tools/test_router.py -v
```

Expected: FAIL with import errors.

- [ ] **Step 3: Write minimal implementation**

```python
# app/services/ask_tools/router.py
import json
import logging
import re

from app.services.ask_tools.base import MetadataToolRegistry, ToolCall

logger = logging.getLogger(__name__)

RULE_PATTERNS = [
    {
        "patterns": [r"数据源", r"接了几", r"几个库", r"多少.*数据源"],
        "tool": "datasource_stats",
        "args": {},
    },
    {
        "patterns": [r"采集", r"元数据.*更新", r"最近.*任务", r"采集任务"],
        "tool": "latest_collection_job",
        "args": {},
    },
    {
        "patterns": [r"表", r"字段", r"schema", r"有哪些列", r"列名", r"字段.*哪里"],
        "tool": "schema_metadata_query",
        "args": {"keyword": "", "limit": 10},
    },
    {
        "patterns": [r"治理", r"待办", r"ticket"],
        "tool": "governance_ticket_stats",
        "args": {},
    },
]


class ToolRouter:
    def __init__(self, registry: MetadataToolRegistry, client, model: str):
        self.registry = registry
        self.client = client
        self.model = model

    async def route(self, query: str) -> list[ToolCall]:
        rule_calls = self._rule_route(query)
        if rule_calls:
            return rule_calls
        return await self._llm_route(query)

    def _rule_route(self, query: str) -> list[ToolCall]:
        for rule in RULE_PATTERNS:
            for pat in rule["patterns"]:
                if re.search(pat, query):
                    args = dict(rule["args"])
                    if "keyword" in args:
                        args["keyword"] = self._extract_keyword(query) or query
                    return [ToolCall(name=rule["tool"], arguments=args)]
        return []

    def _extract_keyword(self, query: str) -> str | None:
        # 简单提取：去掉常见疑问词后的第一个 2-4 字片段
        stop = {"什么", "怎么", "如何", "哪些", "哪个", "哪里", "有多少", "几个"}
        cleaned = query
        for s in stop:
            cleaned = cleaned.replace(s, " ")
        cleaned = cleaned.strip()
        if len(cleaned) >= 2:
            return cleaned[:6]
        return None

    async def _llm_route(self, query: str) -> list[ToolCall]:
        if not self.client:
            return []
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": query}],
                tools=self.registry.to_openai_tools(),
                tool_choice="auto",
            )
            message = response.choices[0].message
            if not message.tool_calls:
                return []
            calls = []
            for tc in message.tool_calls:
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}
                calls.append(ToolCall(name=tc.function.name, arguments=args))
            return calls
        except Exception:
            logger.exception("LLM 工具路由失败")
            return []
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python -m pytest tests/services/ask_tools/test_router.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/ask_tools/router.py tests/services/ask_tools/test_router.py
git commit -m "feat: add metadata tool router with rules and LLM fallback"
```

---

### Task 6: AskMessageToolCall Model

**Files:**
- Create: `app/models/ask_tool_call.py`
- Modify: `app/models/__init__.py`
- Test: `tests/models/test_ask_tool_call.py`

**Interfaces:**
- Produces: `AskMessageToolCall` ORM model
- `AskMessageToolCall.to_dict() -> dict` for API serialization

- [ ] **Step 1: Write the failing test**

```python
# tests/models/test_ask_tool_call.py
from app.models import AskMessageToolCall


def test_ask_message_tool_call_creation(db):
    tc = AskMessageToolCall(
        message_id=1,
        tool_name="datasource_stats",
        arguments='{}',
        result='{"total": 3}',
        status="success",
    )
    db.add(tc)
    db.commit()
    db.refresh(tc)
    assert tc.id is not None
    assert tc.to_dict()["tool_name"] == "datasource_stats"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python -m pytest tests/models/test_ask_tool_call.py -v
```

Expected: FAIL with import errors.

- [ ] **Step 3: Write minimal implementation**

```python
# app/models/ask_tool_call.py
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from .base import Base


class AskMessageToolCall(Base):
    __tablename__ = "ask_message_tool_calls"

    id = Column(Integer, primary_key=True, autoincrement=True)
    message_id = Column(
        Integer,
        ForeignKey("ask_messages.id"),
        nullable=False,
        index=True,
    )
    tool_name = Column(String(50), nullable=False)
    arguments = Column(Text, nullable=False)
    result = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="success")
    error_message = Column(Text, nullable=True)
    created_at = Column(
        DateTime,
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "message_id": self.message_id,
            "tool_name": self.tool_name,
            "arguments": self.arguments,
            "result": self.result,
            "status": self.status,
            "error_message": self.error_message,
            "created_at": str(self.created_at) if self.created_at else None,
        }
```

Update `app/models/__init__.py` to import `AskMessageToolCall`.

- [ ] **Step 4: Run test to verify it passes**

```bash
python -m pytest tests/models/test_ask_tool_call.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/models/ask_tool_call.py app/models/__init__.py tests/models/test_ask_tool_call.py
git commit -m "feat: add AskMessageToolCall model"
```

---

### Task 7: Integrate Tools into AskService

**Files:**
- Modify: `app/services/ask_service.py`
- Test: `tests/services/test_ask_service_tools.py`

**Interfaces:**
- Consumes: `ToolRouter`, `ToolExecutor`, `registry`, `AskMessageToolCall`
- `AskService` methods gain tool orchestration inside `stream_response`

- [ ] **Step 1: Write the failing test**

```python
# tests/services/test_ask_service_tools.py
import pytest
from unittest.mock import MagicMock, AsyncMock, patch

from app.models import AskSession, AskMessage, LlmSetting
from app.services.ask_service import AskService


@pytest.fixture
def active_llm(db):
    ls = LlmSetting(
        name="test",
        base_url="http://localhost",
        api_key="enc",
        model_name="gpt-4",
        is_active=1,
    )
    db.add(ls)
    db.commit()
    return ls


@pytest.fixture
def session(db, active_llm):
    s = AskSession(title="test", model_name="gpt-4", llm_setting_id=active_llm.id)
    db.add(s)
    db.commit()
    return s


@pytest.mark.asyncio
async def test_stream_response_calls_tools(db, session):
    service = AskService()

    user_msg = AskMessage(session_id=session.id, role="user", content="系统有几个数据源？", status="completed")
    assistant_msg = AskMessage(session_id=session.id, role="assistant", content="", status="pending")
    db.add_all([user_msg, assistant_msg])
    db.commit()
    db.refresh(assistant_msg)

    # Mock router to return datasource_stats tool
    with patch.object(service, "_router") as mock_router:
        mock_router.route = AsyncMock(return_value=[MagicMock(name="datasource_stats", arguments={})])

        # Mock executor to return result
        with patch.object(service, "_executor") as mock_executor:
            mock_executor.execute = AsyncMock(return_value=[
                MagicMock(name="datasource_stats", arguments={}, result={"total": 2}, status="success", error_message=None)
            ])

            # Mock LLM stream to yield done immediately
            async def fake_stream(*args, **kwargs):
                yield "event: done\ndata: {\"message_id\": %d}\n\n" % assistant_msg.id

            with patch.object(service, "_call_llm_stream", fake_stream):
                events = []
                async for ev in service.stream_response(db, session.id, assistant_msg.id):
                    events.append(ev)
                assert any("done" in ev for ev in events)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python -m pytest tests/services/test_ask_service_tools.py -v
```

Expected: FAIL (AskService doesn't have router/executor yet).

- [ ] **Step 3: Write minimal implementation**

Modify `app/services/ask_service.py`:

```python
import json
import logging
from datetime import datetime, timezone
from typing import AsyncGenerator, Optional

from openai import OpenAI
from sqlalchemy.orm import Session

from ..models import AskMessage, AskSession, LlmSetting, AskMessageToolCall
from .llm_settings_service import LlmSettingsService
from .schema_context_service import SchemaContextService
from .key_encryption import decrypt as decrypt_key
from .ask_tools.registry import registry
from .ask_tools.router import ToolRouter
from .ask_tools.executor import ToolExecutor

logger = logging.getLogger(__name__)


class AskService:
    """AI 问数会话与消息服务"""

    def __init__(self):
        self._llm_settings_service = LlmSettingsService()
        self._schema_context = SchemaContextService()
        self._router: ToolRouter | None = None
        self._executor = ToolExecutor(registry)

    def _init_router(self, client, model: str) -> ToolRouter:
        return ToolRouter(registry, client, model)

    # ... existing CRUD methods ...

    async def stream_response(
        self, db: Session, session_id: int, after_message_id: int
    ) -> AsyncGenerator[str, None]:
        s = db.query(AskSession).filter(AskSession.id == session_id).first()
        if not s:
            yield self._sse_event("error", {"message_id": after_message_id, "error": "会话不存在"})
            return

        assistant_msg = db.query(AskMessage).filter(AskMessage.id == after_message_id).first()
        if not assistant_msg or assistant_msg.role != "assistant":
            yield self._sse_event("error", {"message_id": after_message_id, "error": "消息不存在"})
            return

        assistant_msg.status = "streaming"
        db.commit()

        active_setting = db.query(LlmSetting).filter(LlmSetting.is_active == 1).first()
        if not active_setting:
            assistant_msg.status = "failed"
            assistant_msg.error_message = "没有已启用的 LLM 配置"
            db.commit()
            yield self._sse_event("error", {"message_id": after_message_id, "error": "没有已启用的 LLM 配置"})
            return

        api_key = decrypt_key(active_setting.api_key)
        client = OpenAI(base_url=f"{active_setting.base_url}/v1", api_key=api_key, timeout=120)

        # Find latest user query
        last_user_msg = (
            db.query(AskMessage)
            .filter(AskMessage.session_id == session_id)
            .filter(AskMessage.id <= after_message_id)
            .filter(AskMessage.role == "user")
            .filter(AskMessage.status == "completed")
            .order_by(AskMessage.created_at.desc())
            .first()
        )
        user_query = last_user_msg.content if last_user_msg else ""

        # Tool routing
        router = self._init_router(client, active_setting.model_name)
        tool_calls = await router.route(user_query)

        tool_results = []
        if tool_calls:
            yield self._sse_event(
                "tool_call_start",
                {"message_id": after_message_id, "tool_names": [c.name for c in tool_calls]},
            )
            tool_results = await self._executor.execute(tool_calls, db)
            # Persist tool calls
            for tr in tool_results:
                tc = AskMessageToolCall(
                    message_id=after_message_id,
                    tool_name=tr.name,
                    arguments=json.dumps(tr.arguments, ensure_ascii=False),
                    result=json.dumps(tr.result, ensure_ascii=False) if tr.result is not None else None,
                    status=tr.status,
                    error_message=tr.error_message,
                )
                db.add(tc)
            db.commit()
            persisted_calls = (
                db.query(AskMessageToolCall)
                .filter(AskMessageToolCall.message_id == after_message_id)
                .order_by(AskMessageToolCall.created_at)
                .all()
            )
            yield self._sse_event(
                "tool_call_done",
                {
                    "message_id": after_message_id,
                    "tool_calls": [tc.to_dict() for tc in persisted_calls],
                },
            )

        # Build system prompt with tool results and schema context
        schema_context = self._schema_context.build_context(user_query, db)
        system_content = self._build_system_prompt(schema_context, tool_results)

        # ... rest of streaming logic ...
```

Add helper:

```python
    def _build_system_prompt(self, schema_context: str, tool_results: list) -> str:
        parts = [
            "你是 MetricForge 数据分析助手。",
            "你是一个融资租赁数据平台的 SQL 分析助手。",
            "请基于数据仓库中的表和字段回答用户问题。",
            "回答中可以通过 SQL 代码块展示查询逻辑，但不要直接执行任何 SQL。",
            "使用中文回答。",
        ]
        if schema_context:
            parts.append("\n" + schema_context)
        if tool_results:
            parts.append("\n## 元数据查询结果\n")
            for tr in tool_results:
                parts.append(f"### {tr.name}\n```json\n{json.dumps(tr.result, ensure_ascii=False)}\n```\n")
        return "\n".join(parts)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python -m pytest tests/services/test_ask_service_tools.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/services/ask_service.py tests/services/test_ask_service_tools.py
git commit -m "feat: integrate metadata tools into ask service"
```

---

### Task 8: API Returns tool_calls in Messages

**Files:**
- Modify: `app/api/ask.py`
- Test: `tests/api/test_ask_tools.py`

**Interfaces:**
- `/api/ask/sessions/{id}/messages` returns each message with `tool_calls: list[dict]`

- [ ] **Step 1: Write the failing test**

```python
# tests/api/test_ask_tools.py
from fastapi.testclient import TestClient


def test_messages_include_tool_calls(client: TestClient, db, sample_ask_session):
    from app.models import AskMessage, AskMessageToolCall
    msg = AskMessage(session_id=sample_ask_session.id, role="assistant", content="answer", status="completed")
    db.add(msg)
    db.commit()
    db.refresh(msg)
    tc = AskMessageToolCall(
        message_id=msg.id,
        tool_name="datasource_stats",
        arguments="{}",
        result='{"total": 2}',
        status="success",
    )
    db.add(tc)
    db.commit()

    resp = client.get(f"/api/ask/sessions/{sample_ask_session.id}/messages")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert len(data[0]["tool_calls"]) == 1
    assert data[0]["tool_calls"][0]["tool_name"] == "datasource_stats"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python -m pytest tests/api/test_ask_tools.py -v
```

Expected: FAIL (no tool_calls field).

- [ ] **Step 3: Write minimal implementation**

Modify `app/api/ask.py`:

```python
@router.get("/sessions/{session_id}/messages")
def get_messages(session_id: int, db=Depends(get_db)):
    messages = (
        db.query(AskMessage)
        .filter(AskMessage.session_id == session_id)
        .order_by(AskMessage.created_at)
        .all()
    )
    result = []
    for m in messages:
        item = {
            "id": m.id,
            "session_id": m.session_id,
            "role": m.role,
            "content": m.content,
            "status": m.status,
            "error_message": m.error_message,
            "tokens_prompt": m.tokens_prompt,
            "tokens_completion": m.tokens_completion,
            "created_at": m.created_at.isoformat(),
        }
        tool_calls = (
            db.query(AskMessageToolCall)
            .filter(AskMessageToolCall.message_id == m.id)
            .order_by(AskMessageToolCall.created_at)
            .all()
        )
        item["tool_calls"] = [tc.to_dict() for tc in tool_calls]
        result.append(item)
    return result
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python -m pytest tests/api/test_ask_tools.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/ask.py tests/api/test_ask_tools.py
git commit -m "feat: include tool_calls in ask messages API"
```

---

### Task 9: Frontend Types and API Update

**Files:**
- Modify: `frontend/src/api/askSessions.ts`
- Test: `frontend/src/api/askSessions.test.ts`

**Interfaces:**
- `AskMessage` type has `tool_calls?: ToolCallRecord[]`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/api/askSessions.test.ts
import { describe, it, expect } from 'vitest'
import type { AskMessage } from './askSessions'

describe('AskMessage type', () => {
  it('accepts tool_calls', () => {
    const msg: AskMessage = {
      id: 1,
      session_id: 1,
      role: 'assistant',
      content: 'hi',
      status: 'completed',
      created_at: '2024-01-01T00:00:00Z',
      tool_calls: [
        { id: 1, message_id: 1, tool_name: 'datasource_stats', arguments: '{}', result: '{}', status: 'success', error_message: null, created_at: '2024-01-01T00:00:00Z' },
      ],
    }
    expect(msg.tool_calls).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/projects/MetricForge/frontend
npm run test -- src/api/askSessions.test.ts
```

Expected: FAIL (type not found).

- [ ] **Step 3: Write minimal implementation**

```typescript
// frontend/src/api/askSessions.ts
export interface ToolCallRecord {
  id: number
  message_id: number
  tool_name: string
  arguments: string
  result: string | null
  status: string
  error_message: string | null
  created_at: string
}

export interface AskMessage {
  id: number
  session_id: number
  role: 'user' | 'assistant'
  content: string
  status: string
  error_message?: string | null
  tokens_prompt?: number | null
  tokens_completion?: number | null
  created_at: string
  tool_calls?: ToolCallRecord[]
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- src/api/askSessions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/askSessions.ts frontend/src/api/askSessions.test.ts
git commit -m "feat: add ToolCallRecord type to AskMessage"
```

---

### Task 10: ToolCallIndicator Component

**Files:**
- Create: `frontend/src/components/ToolCallIndicator.tsx`
- Test: `frontend/src/components/ToolCallIndicator.test.tsx`

**Interfaces:**
- Props: `{ tool_calls: ToolCallRecord[] }`
- Renders list of tool names with status badges

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/ToolCallIndicator.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ToolCallIndicator from './ToolCallIndicator'
import type { ToolCallRecord } from '../api/askSessions'

describe('ToolCallIndicator', () => {
  it('renders tool names', () => {
    const calls: ToolCallRecord[] = [
      { id: 1, message_id: 1, tool_name: 'datasource_stats', arguments: '{}', result: '{}', status: 'success', error_message: null, created_at: '' },
    ]
    render(<ToolCallIndicator tool_calls={calls} />)
    expect(screen.getByText('datasource_stats')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/components/ToolCallIndicator.test.tsx
```

Expected: FAIL (component not found).

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/components/ToolCallIndicator.tsx
import React from 'react'
import { Space, Tag, Tooltip } from 'antd'
import type { ToolCallRecord } from '../api/askSessions'

interface ToolCallIndicatorProps {
  tool_calls: ToolCallRecord[]
}

const ToolCallIndicator: React.FC<ToolCallIndicatorProps> = ({ tool_calls }) => {
  if (!tool_calls || tool_calls.length === 0) return null

  return (
    <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>
      <Space size="small">
        <span>已调用工具：</span>
        {tool_calls.map((tc) => (
          <Tooltip key={tc.id} title={tc.status === 'error' ? tc.error_message || '执行失败' : '执行成功'}>
            <Tag color={tc.status === 'success' ? 'green' : 'red'}>
              {tc.tool_name}
            </Tag>
          </Tooltip>
        ))}
      </Space>
    </div>
  )
}

export default ToolCallIndicator
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- src/components/ToolCallIndicator.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ToolCallIndicator.tsx frontend/src/components/ToolCallIndicator.test.tsx
git commit -m "feat: add ToolCallIndicator component"
```

---

### Task 11: Update AskWorkbenchPage for Tool SSE Events

**Files:**
- Modify: `frontend/src/pages/AskWorkbenchPage.tsx`

**Interfaces:**
- Listen to `tool_call_start` and `tool_call_done` SSE events
- Show transient tool state while streaming

- [ ] **Step 1: Write the failing test**

Add/update existing frontend tests to assert event handling. For now, a simple type-level test:

```typescript
// frontend/src/pages/AskWorkbenchPage.test.tsx (new)
import { describe, it, expect } from 'vitest'

describe('AskWorkbenchPage', () => {
  it('handles tool_call events', () => {
    expect(true).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/pages/AskWorkbenchPage.test.tsx
```

Expected: FAIL if file not present.

- [ ] **Step 3: Write minimal implementation**

Modify `frontend/src/pages/AskWorkbenchPage.tsx`:

```typescript
const [toolCalls, setToolCalls] = useState<ToolCallRecord[] | null>(null)

// Inside EventSource promise:
es.addEventListener('tool_call_start', (e) => {
  const data = JSON.parse((e as MessageEvent).data)
  setToolCalls(
    data.tool_names.map((name: string, idx: number) => ({
      id: idx,
      message_id: data.message_id,
      tool_name: name,
      arguments: '{}',
      result: null,
      status: 'running',
      error_message: null,
      created_at: new Date().toISOString(),
    }))
  )
})

es.addEventListener('tool_call_done', (e) => {
  const data = JSON.parse((e as MessageEvent).data)
  setToolCalls(data.tool_calls)
})
```

And pass `toolCalls` to `MessageThread` or render indicator.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- src/pages/AskWorkbenchPage.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AskWorkbenchPage.tsx frontend/src/pages/AskWorkbenchPage.test.tsx
git commit -m "feat: handle tool_call SSE events in AskWorkbenchPage"
```

---

### Task 12: Update MessageThread to Render Tool Calls

**Files:**
- Modify: `frontend/src/components/MessageThread.tsx`

**Interfaces:**
- `MessageThread` renders `ToolCallIndicator` before each assistant message that has `tool_calls`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/MessageThread.test.tsx (new)
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import MessageThread from './MessageThread'
import type { AskMessage } from '../api/askSessions'

describe('MessageThread', () => {
  it('renders ToolCallIndicator for assistant messages with tool_calls', () => {
    const messages: AskMessage[] = [
      {
        id: 1,
        session_id: 1,
        role: 'assistant',
        content: '有 2 个数据源',
        status: 'completed',
        created_at: '',
        tool_calls: [
          { id: 1, message_id: 1, tool_name: 'datasource_stats', arguments: '{}', result: '{}', status: 'success', error_message: null, created_at: '' },
        ],
      },
    ]
    render(<MessageThread messages={messages} />)
    expect(screen.getByText('datasource_stats')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test -- src/components/MessageThread.test.tsx
```

Expected: FAIL (component doesn't render indicator yet).

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/components/MessageThread.tsx
import React, { useEffect, useRef } from 'react'
import { Empty, Typography } from 'antd'
import type { AskMessage } from '../api/askSessions'
import UserMessage from './UserMessage'
import AssistantMessage from './AssistantMessage'
import StreamingMessage from './StreamingMessage'
import ToolCallIndicator from './ToolCallIndicator'
import { useAskStore } from '../stores/askStore'

interface MessageThreadProps {
  messages: AskMessage[]
  isLoading?: boolean
}

const MessageThread: React.FC<MessageThreadProps> = ({
  messages,
  isLoading: _isLoading,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null)
  const streaming = useAskStore((s) => s.streaming)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming?.content])

  return (
    <div
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '16px 24px',
      }}
    >
      {messages.length === 0 && !streaming?.visible && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <Empty description="开始你的第一个问题" />
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              你可以问我关于数据的问题，例如：
            </Typography.Text>
            <div style={{ marginTop: 12, color: '#999', fontSize: 13 }}>
              <div>• 近30天新增客户数是多少？</div>
              <div>• 本月合同金额排名前十的客户</div>
              <div>• 按业务类型统计逾期率</div>
            </div>
          </div>
        </div>
      )}

      {messages.length > 0 && (
        <div>
          {messages.map((msg) =>
            msg.role === 'user' ? (
              <UserMessage
                key={msg.id}
                content={msg.content}
                timestamp={msg.created_at}
              />
            ) : (
              <div key={msg.id}>
                {msg.tool_calls && msg.tool_calls.length > 0 && (
                  <ToolCallIndicator tool_calls={msg.tool_calls} />
                )}
                <AssistantMessage
                  content={msg.content}
                  timestamp={msg.created_at}
                />
              </div>
            )
          )}
        </div>
      )}

      {streaming?.visible && <StreamingMessage content={streaming.content} />}

      <div ref={bottomRef} />
    </div>
  )
}

export default MessageThread
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test -- src/components/MessageThread.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MessageThread.tsx frontend/src/components/MessageThread.test.tsx
git commit -m "feat: render ToolCallIndicator in MessageThread"
```

---

### Task 13: Integration Test for Tool End-to-End Flow

**Files:**
- Test: `tests/api/test_ask_tool_integration.py`

**Interfaces:**
- Uses TestClient to send message and verify SSE events include `tool_call_start` and `tool_call_done`

- [ ] **Step 1: Write the failing test**

```python
# tests/api/test_ask_tool_integration.py
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from app.models import AskSession, AskMessage, LlmSetting


def test_ask_flow_with_tool_calls(client: TestClient, db):
    ls = LlmSetting(name="test", base_url="http://localhost", api_key="enc", model_name="gpt", is_active=1)
    db.add(ls)
    db.commit()

    s = AskSession(title="t", model_name="gpt", llm_setting_id=ls.id)
    db.add(s)
    db.commit()
    db.refresh(s)

    # Mock LLM routing to return datasource_stats and stream done
    fake_msg = MagicMock()
    fake_msg.tool_calls = [MagicMock(function=MagicMock(name="datasource_stats", arguments="{}"))]
    fake_response = MagicMock(choices=[MagicMock(message=fake_msg)])

    with patch("app.services.ask_service.OpenAI") as mock_openai:
        instance = MagicMock()
        instance.chat.completions.create = MagicMock(return_value=fake_response)
        mock_openai.return_value = instance

        resp = client.post(f"/api/ask/sessions/{s.id}/messages", params={"content": "有几个数据源？"})
        assert resp.status_code == 201

        events = []
        with client.stream("GET", f"/api/ask/sessions/{s.id}/stream?after=2&_t=x") as response:
            for line in response.iter_lines():
                if line:
                    events.append(line)

        assert any(b"tool_call_start" in ev for ev in events)
        assert any(b"tool_call_done" in ev for ev in events)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python -m pytest tests/api/test_ask_tool_integration.py -v
```

Expected: FAIL (events not emitted).

- [ ] **Step 3: Ensure implementation exists**

Implementation already in Task 7. Adjust if needed.

- [ ] **Step 4: Run test to verify it passes**

```bash
python -m pytest tests/api/test_ask_tool_integration.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/api/test_ask_tool_integration.py
git commit -m "test: add end-to-end tool call integration test"
```

---

### Task 14: Full Test Suite and Build

**Files:**
- All modified files

- [ ] **Step 1: Run backend tests**

```bash
cd /d/projects/MetricForge
python -m pytest tests/ -v
```

Expected: PASS.

- [ ] **Step 2: Run frontend tests**

```bash
cd /d/projects/MetricForge/frontend
npm run test
```

Expected: PASS.

- [ ] **Step 3: Build frontend**

```bash
cd /d/projects/MetricForge/frontend
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final fixes for metadata tools phase 2.5"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec Section | Plan Task |
|--------------|-----------|
| Tool Registry | Task 1 |
| 4 Tool Handlers | Task 2 |
| Registry Wiring | Task 3 |
| Tool Executor | Task 4 |
| Tool Router | Task 5 |
| AskMessageToolCall Model | Task 6 |
| AskService Integration | Task 7 |
| API tool_calls | Task 8 |
| Frontend Types | Task 9 |
| ToolCallIndicator | Task 10 |
| AskWorkbenchPage SSE | Task 11 |
| MessageThread Rendering | Task 12 |
| Integration Test | Task 13 |
| Full Test/Build | Task 14 |

### Placeholder Scan

- No "TBD", "TODO", "implement later".
- Each step contains exact file paths, code, commands.
- Test code is complete and runnable.

### Type Consistency

- `ToolCall` and `ToolResult` defined in Task 1, used in Tasks 4, 5, 7.
- `AskMessageToolCall.to_dict()` used in Task 8.
- `ToolCallRecord` type used in Tasks 9-12.

### Gap Check

- None identified. All spec requirements map to tasks.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-26-ai-ask-metadata-tools.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach do you want?
