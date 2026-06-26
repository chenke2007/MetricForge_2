# Phase 2.5: AI 问数元数据工具调用与统计问答增强

## 1. 目标与范围

让 AI 问数在回答**元数据事实类问题**时，先调用后端轻量工具查询 MetricForge 本地元数据库，再由 LLM 组织回答。

### 1.1 覆盖的问题类型

| 类型 | 示例 |
|------|------|
| 统计类 | 系统里接了几个数据源？一共采集了多少张表？ |
| 最新状态类 | 最近一次元数据采集成功了吗？什么时候跑的？ |
| 存在性/详情类 | 合同表有哪些字段？客户编号字段在哪里？ |
| 治理统计类 | 当前未关闭的治理待办有多少？ |

### 1.2 明确不做

- 不执行任何真实业务 SQL。
- 不查询 Oracle 业务数据。
- 不引入完整 Agent 框架（如 LangChain、AutoGen、SmolaAgents）。
- 不做多轮 ReAct/Plan-and-Execute 工具链。
- 不打乱后续 SQL 工作台计划。

## 2. 总体架构

```
┌─────────────┐     POST /api/ask/sessions/{id}/messages
│   Frontend  │ ──────────────────────────────────────────▶
└─────────────┘                                          │
                                                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                         AskService.create_message                 │
│  1. 创建 user + assistant placeholder（status=pending）           │
│  2. 提取最新 user query                                           │
│  3. Router：规则匹配 → LLM 兜底 → list[ToolCall]                  │
│  4. 若 ToolCall 为空：走 SchemaContextService + 流式回答          │
│  5. 若不为空：执行工具 → 写入 AskMessageToolCall → 流式回答        │
└──────────────────────────────────────────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
        ┌──────────────┐ ┌─────────────┐ ┌──────────────┐
        │ Tool Router  │ │ Tool Executor│ │ Prompt Builder│
        └──────────────┘ └─────────────┘ └──────────────┘
                │               │               │
                ▼               ▼               ▼
        ┌──────────────┐ ┌─────────────┐ ┌──────────────┐
        │ Rule Patterns│ │ 4 Tool       │ │ System Prompt│
        │ LLM tools API│ │ Handlers     │ │ + Tool Results│
        └──────────────┘ └─────────────┘ └──────────────┘
```

## 3. 组件设计

### 3.1 Tool Registry（`app/services/ask_tools/`）

```python
# app/services/ask_tools/base.py
from dataclasses import dataclass
from typing import Callable, Awaitable, Any

@dataclass
class MetadataTool:
    name: str
    description: str
    parameters: dict  # JSON Schema
    handler: Callable[..., Awaitable[Any]]
    result_mode: str  # "direct" | "llm_summary"

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
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                },
            }
            for t in self._tools.values()
        ]


@dataclass
class ToolCall:
    name: str
    arguments: dict


@dataclass
class ToolResult:
    name: str
    arguments: dict
    result: Any | None
    status: str  # "success" | "error"
    error_message: str | None = None

    @staticmethod
    def success(name: str, arguments: dict, result: Any) -> "ToolResult":
        return ToolResult(name=name, arguments=arguments, result=result, status="success")

    @staticmethod
    def error(name: str, arguments: dict, message: str) -> "ToolResult":
        return ToolResult(
            name=name,
            arguments=arguments,
            result=None,
            status="error",
            error_message=message,
        )
```

### 3.2 Tool Router（`app/services/ask_tools/router.py`）

```python
class ToolRouter:
    def __init__(self, registry: MetadataToolRegistry, client, model: str):
        self.registry = registry
        self.client = client
        self.model = model

    async def route(self, query: str) -> list[ToolCall]:
        # 1. Fast-path rules
        rule_calls = self._rule_route(query)
        if rule_calls:
            return rule_calls

        # 2. LLM fallback
        return await self._llm_route(query)

    def _rule_route(self, query: str) -> list[ToolCall]:
        # 高置信度关键词匹配
        pass

    async def _llm_route(self, query: str) -> list[ToolCall]:
        # OpenAI tools API
        pass
```

### 3.3 Tool Executor（`app/services/ask_tools/executor.py`）

```python
class ToolExecutor:
    def __init__(self, registry: MetadataToolRegistry):
        self.registry = registry

    async def execute(self, calls: list[ToolCall], db: Session) -> list[ToolResult]:
        coros = [self._execute_one(c, db) for c in calls]
        return await asyncio.gather(*coros, return_exceptions=True)

    async def _execute_one(self, call: ToolCall, db: Session) -> ToolResult:
        tool = self.registry.get(call.name)
        if not tool:
            return ToolResult.error(call.name, call.arguments, "工具不存在")
        try:
            result = await tool.handler(db, **call.arguments)
            return ToolResult.success(call.name, call.arguments, result)
        except Exception as e:
            return ToolResult.error(call.name, call.arguments, str(e))
```

## 4. 工具清单

### 4.1 `datasource_stats`

- **描述**：查询 MetricForge 当前接入的数据源统计信息，包括数量、类型、启用状态。
- **参数**：无
- **Handler 逻辑**：
  - `db.query(DatasourceConfig)`
  - 返回总数、活跃数、列表（id/name/ds_type/is_active）
- **Result Mode**：`direct`

### 4.2 `latest_collection_job`

- **描述**：查询最近一次元数据采集任务的状态、执行时间、采集到的表/字段数量。
- **参数**：
  - `datasource_id: int | None`（可选）
- **Handler 逻辑**：
  - 查询 `MetadataCollectionJob`，按 `started_at` 倒序取第一条
  - 若指定 `datasource_id` 则过滤
- **Result Mode**：`direct`

### 4.3 `schema_metadata_query`

- **描述**：按表名、字段名或注释搜索 schema/table/column 元数据。
- **参数**：
  - `keyword: str`
  - `schema_name: str | None`
  - `limit: int = 10`
- **Handler 逻辑**：
  - 在 `TableMetadata.table_name`、`table_comment` 和 `ColumnMetadata.column_name`、`comment` 中模糊匹配
  - 排除 `INFORMATION_SCHEMA`、`SYS`、`SYSTEM`、`DBA`
  - 返回匹配表及其前 20 个字段
- **Result Mode**：`llm_summary`

### 4.4 `governance_ticket_stats`

- **描述**：查询治理待办的统计信息，可按状态、类型分组。
- **参数**：
  - `status: str | None`
  - `ticket_type: str | None`
- **Handler 逻辑**：
  - 查询 `GovernanceTicket`
  - 返回总数、按状态分组、按类型分组
- **Result Mode**：`direct`

## 5. 路由规则（Fast-Path）

```python
RULE_PATTERNS = [
    {
        "patterns": [r"数据源", r"接了几", r"几个库"],
        "tool": "datasource_stats",
    },
    {
        "patterns": [r"采集", r"元数据.*更新", r"最近.*任务"],
        "tool": "latest_collection_job",
    },
    {
        "patterns": [r"表", r"字段", r"schema", r"有哪些列", r"列名"],
        "tool": "schema_metadata_query",
        "default_args": {"keyword": "{extracted_keyword}", "limit": 10},
    },
    {
        "patterns": [r"治理", r"待办", r"ticket"],
        "tool": "governance_ticket_stats",
    },
]
```

规则只覆盖高置信度意图。未命中时进入 LLM 兜底。

## 6. LLM 兜底路由

使用 OpenAI `tools` API：

```python
response = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": query}],
    tools=registry.to_openai_tools(),
    tool_choice="auto",
    stream=False,
)
```

- 若 `response.choices[0].message.tool_calls` 为空，返回空列表，走原有 schema context 流程。
- 否则解析为 `list[ToolCall]`。

若 LLM 路由失败（超时/异常），降级为规则匹配；规则也失败则返回空列表，不阻塞用户。

## 7. 数据流

```
user 发送消息
  │
  ▼
create_message(user + assistant placeholder pending)
  │
  ▼
ToolRouter.route(query)
  │
  ├─► 规则命中 → list[ToolCall]
  │
  └─► 未命中 → LLM tools API → list[ToolCall]
  │
  ▼
if tool_calls:
  SSE event: tool_call_start
  ToolExecutor.execute_parallel(tool_calls)
  写入 AskMessageToolCall
  SSE event: tool_call_done
  PromptBuilder 注入工具结果
  SSE stream final answer
else:
  SchemaContextService.build_context
  SSE stream final answer
```

## 8. 数据模型

### 8.1 新增 `AskMessageToolCall`

```python
# app/models/ask_tool_call.py
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from .base import Base

class AskMessageToolCall(Base):
    __tablename__ = "ask_message_tool_calls"

    id = Column(Integer, primary_key=True, autoincrement=True)
    message_id = Column(Integer, ForeignKey("ask_messages.id"), nullable=False, index=True)
    tool_name = Column(String(50), nullable=False)
    arguments = Column(Text, nullable=False)      # JSON string
    result = Column(Text, nullable=True)          # JSON string or human-readable text
    status = Column(String(20), nullable=False, default="success")
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
```

### 8.2 API 响应扩展

`/api/ask/sessions/{id}/messages` 返回的 `AskMessage` 增加 `tool_calls: list[dict]`。

## 9. SSE 事件扩展

| Event | 数据 | 含义 |
|-------|------|------|
| `meta` | `{message_id, model, started_at}` | 流开始 |
| `tool_call_start` | `{message_id, tool_names: [...]}` | 开始调用工具 |
| `tool_call_done` | `{message_id, tool_calls: [...]}` | 工具调用完成 |
| `token` | `{delta}` | 正常 token |
| `error` | `{error}` | 错误 |
| `done` | `{message_id, tokens_*, usage}` | 流结束 |

## 10. Prompt 构建

System prompt 模板：

```markdown
你是 MetricForge 数据分析助手，一个融资租赁数据平台的 SQL 分析助手。
请基于数据仓库中的表和字段回答用户问题。
回答中可以通过 SQL 代码块展示查询逻辑，但不要直接执行任何 SQL。
使用中文回答。

{{schema_context}}

{{tool_results}}
```

`tool_results` 格式：

```markdown
## 元数据查询结果

### datasource_stats
```json
{"total": 3, "active": 2, ...}
```

### schema_metadata_query
- LEASE.CONTRACT（合同表）
  - CONTRACT_ID NUMBER (PK)
  - CUSTOMER_ID NUMBER
  ...
```

## 11. 前端改动

### 11.1 新增组件

- `ToolCallIndicator.tsx`：显示工具调用进度与摘要
- `ToolCallResult.tsx`（可选展开）：展示工具名称、参数、原始结果

### 11.2 AskWorkbenchPage

在 `EventSource` 监听器中新增：

```typescript
es.addEventListener('tool_call_start', (e) => {
  const data = JSON.parse(e.data)
  setToolCallState({ messageId: data.message_id, status: 'running', tools: data.tool_names })
})

es.addEventListener('tool_call_done', (e) => {
  const data = JSON.parse(e.data)
  setToolCallState({ messageId: data.message_id, status: 'done', tools: data.tool_calls })
})
```

### 11.3 MessageThread

在 assistant 消息气泡前渲染 `ToolCallIndicator`：

```tsx
{msg.tool_calls && msg.tool_calls.length > 0 && (
  <ToolCallIndicator tool_calls={msg.tool_calls} />
)}
<AssistantMessage content={msg.content} ... />
```

## 12. 错误处理

1. **单个工具失败**：该 `ToolResult` 状态为 `error`，写入 `AskMessageToolCall`。LLM prompt 中标注失败原因，不影响其他工具结果。
2. **LLM 路由失败**：降级到规则匹配；规则失败则返回空列表，走原 schema context 流程。
3. **参数非法**：handler 内部校验，返回友好错误信息。
4. **结果过大**：超过 token 预算时截断，并标注“结果已截断”。
5. **无可用工具**：若路由结果为空，按原有方式回答。

## 13. 测试策略

- **单元测试**：每个 tool handler 单独测试，使用 memory SQLite。
- **路由测试**：规则命中、LLM fallback、降级路径各写 2-3 个 case。
- **集成测试**：通过 `/api/ask/sessions/{id}/messages` + SSE 验证 `tool_call_start` / `tool_call_done` 事件。
- **前端测试**：`ToolCallIndicator` 渲染快照测试。
- **安全测试**：断言 tool handler 不调用 Oracle adapter、不执行 raw SQL。

## 14. 文件变更预期

### 后端

- 新增 `app/services/ask_tools/base.py`
- 新增 `app/services/ask_tools/registry.py`
- 新增 `app/services/ask_tools/router.py`
- 新增 `app/services/ask_tools/executor.py`
- 新增 `app/services/ask_tools/tools.py`（4 个 handler）
- 新增 `app/models/ask_tool_call.py`
- 修改 `app/services/ask_service.py`
- 修改 `app/models/__init__.py`
- 修改 `app/api/ask.py`（messages API 返回 tool_calls）

### 前端

- 新增 `frontend/src/components/ToolCallIndicator.tsx`
- 新增 `frontend/src/components/ToolCallResult.tsx`
- 修改 `frontend/src/pages/AskWorkbenchPage.tsx`
- 修改 `frontend/src/components/MessageThread.tsx`
- 修改 `frontend/src/api/askSessions.ts`（类型增加 tool_calls）

## 15. 验收标准

- [ ] 用户问“有几个数据源”时，AI 调用 `datasource_stats` 并正确回答数量。
- [ ] 用户问“最近元数据采集成功了吗”时，AI 调用 `latest_collection_job` 并报告状态。
- [ ] 用户问“合同表有哪些字段”时，AI 调用 `schema_metadata_query` 并列出字段。
- [ ] 用户问“有多少 open 的治理待办”时，AI 调用 `governance_ticket_stats` 并回答。
- [ ] 用户问“近30天新增客户数”时，AI 不调用任何工具，明确说明无法查询业务数据。
- [ ] 前端显示“正在调用工具…”状态，完成后可展开查看原始结果。
- [ ] 后端/前端测试全部通过。
