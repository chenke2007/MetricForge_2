# Phase 5N — Trusted Analysis Execution and Workbench UX

> **阶段**: Phase 5N  
> **状态**: 设计稿  
> **日期**: 2026-07-20  
> **对应阶段**: Phase 5M（元数据 grounding + SQL Trust Gate）之后

---

## 1. 背景与目标

Phase 5M 完成了元数据 grounding + SQL Trust Gate，可信链条停在 `narrativeLevel = sql_pending`：页面展示待验证 SQL、元风险和建议，但不展示事实结论、证据数字或真实图表。用户验证 SQL 需要跳转到 SQL Workbench 手工执行。

Phase 5N 的目标是完成可信链条的最后一段：

```
sql_pending → 用户确认 → 安全执行 → 真实 columns/rows → 结果截断和脱敏
            → 基于真实结果生成 narrative/evidence/chartData
            → narrativeLevel = executed
```

同时修复 8 个用户反馈的页面问题：数据范围重复、孤立搜索入口、会话串线、标题缺失、输入区不一致、模拟模式 UI、缺少分析图。

### 1.1 修复的已知问题

| # | 问题 | 根源 |
|---|------|------|
| 1 | "数据范围"同时出现在左侧栏和顶部栏 | `DataScopeSelector`（左侧）与 `DataScopeBar`（顶部）功能重叠 |
| 2 | 选择数据源后右侧无法搜索对象 | `DataScopeBar` 无搜索框，搜索框只在左侧 |
| 3 | 常驻"表列表（587）"占用空间 | `DataScopeSelector` 渲染全量表树 |
| 4 | 左侧会话全部显示"新对话" | `AskSession.title` 从未被更新 |
| 5 | 新会话结果出现在其他会话 | `currentResponse`/`error`/`chartDataRef` 是全局单值，不按 session 隔离 |
| 6 | 输入框尺寸和位置不一致 | 空会话/历史会话走不同 Layout 分支 |
| 7 | 用户不需要"模拟模式"开关 | `useRealLlm` store + Switch + 回退按钮 |
| 8 | SQL 已生成但页面没有真实分析图 | `RealLlmAdapter.getChartData()` 硬编码为空 + `sql_pending` 阻止展示 |

---

## 2. Module A：统一 Data Scope

### 2.1 方案选择

**选定方案**：顶部统一搜索 + 浏览全部弹层  
**排除方案**：左侧继续保留完整表树、顶部与左侧双入口

### 2.2 变更清单

**删除**：
- `frontend/src/components/DataScopeSelector.tsx` — 整个组件
- `DataScopeSelector` 在 `AskWorkbenchPage.tsx` 中的导入和 `<Sider>` 内渲染

**保留但改造**：
- `frontend/src/components/DataScopeBar.tsx` — 升级为唯一数据范围入口

**保持不变**：
- `useAiAskStore` 的 `datasourceId`/`datasourceName`/`selectedTables` — 不创建新的 store
- 后端 `GET /api/sql/schema/search` — 已有按表名/表注释/字段名/字段注释搜索的能力

### 2.3 DataScopeBar 改造设计

顶部栏从左到右排列：

```
[折叠按钮 "数据范围"] [数据源 Select] [搜索 Input.Search] [浏览全部按钮] [已选表 Tags]
```

**搜索框行为**：
- 仅在 datasourceId 不为 null 时渲染
- 输入 300ms debounce 后调用 `/api/sql/schema/search?datasource_id={id}&q={query}`
- 搜索范围覆盖：`table_name`、`table_comment`、`column_name`、`column_comment`（后端已支持）
- 搜索结果以 Dropdown 或下方弹出面板展示
- 每条结果包含：类型（表/字段图标）、`schema.table`、列名（如果是字段命中）、`matched_on` 标签
- 点击结果行选中/取消对应表（调用 `setSelectedTables`）
- 清空搜索框时关闭结果面板
- 切换数据源时清空搜索框和 `selectedTables`

**浏览全部弹层**：
- 搜索框右侧放置"浏览全部"小按钮（文本或图标）
- 点击弹出 Drawer（从右侧滑入）
- Drawer 内容：可搜索 + 按 schema 分组的表/视图列表
- 分组使用 `Collapse`，不默认全部展开
- 每条表名可选，选中后关闭 Drawer
- 不渲染为常驻 DOM

**状态管理**：
- 数据源变更时（选择或清空），调用 `setDatasource(id, name)` + `setSelectedTables([])`
- 不存在两套 Data Scope 状态源

**选中表命名约束**：
- `selectedTables` 内部统一保存 `SCHEMA.OBJECT`（schema 限定名）
- 同名对象在不同 schema 下不会冲突
- 如果现有元数据不能区分 TABLE/VIEW，统一显示为"数据对象"，不得伪造对象类型
- "浏览全部"弹层同样返回 schema-qualified value
- 搜索结果的点击选中同样使用 `schema.object` 格式写入 `selectedTables`

---

## 3. Module B：会话正确性与标题

### 3.1 方案选择

**分析产物持久化方案**：在 `AskMessage` 模型新增 `response_json` 字段  
**排除方案**：复用 `content` 字段存 JSON（与 SSE 流式 content 冲突，不支持版本升级）

### 3.2 DB 变更

#### AskMessage 模型新增字段

```python
# app/models/ask_models.py — AskMessage 新增
response_json = Column(Text, nullable=True)  # 版本化的 AiAskResponse JSON
```

**兼容性**：
- 新增 `nullable=True`，已有消息不受影响
- `response_json IS NULL` 表示旧格式或 SSE 流式消息
- 读取 `response_json` 的代码必须处理 null 和无法解析的 JSON

#### 版本化 response_json 格式

唯一格式定义（写入、读取、API 返回、前端恢复全部使用同一结构）：

```json
{
  "schemaVersion": 1,
  "data": {
    ...AiAskResponse,
    "queryResult": null | {
      "columns": ["col1", "col2"],
      "rows": [["val1", 100], ["val2", 200]],
      "rowCount": 2,
      "truncated": false,
      "elapsedMs": 150,
      "historyId": null
    }
  }
}
```

规则：
- `sql_pending` 时 `queryResult = null`
- `executed` 时 `queryResult` 必须来自真实 SQL 执行
- JSON 无法解析或 `schemaVersion` 不受支持时 fail closed（返回 None，不阻塞会话）
- 单条坏消息不导致整个会话加载失败

#### Schema Migration

在 `app/services/schema_migration_service.py` 的 `METADATA_COLUMNS` 字典中，`ask_messages` 部分新增：

```python
"ask_messages": [
    ("error_message", "TEXT"),
    ("tokens_prompt", "INTEGER"),
    ("tokens_completion", "INTEGER"),
    # 新增 Phase 5N：
    ("response_json", "TEXT"),
],
```

**migration 特性说明**：
- `schema_migration_service` 使用 `ALTER TABLE ADD COLUMN`，幂等运行（列已存在时跳过）
- 重复启动不影响已有列和数据
- 删除该 migration 配置不会删除已有列
- 应用版本回退兼容策略：旧版本代码忽略 `nullable=True` 的 `response_json` 列
- 本阶段不提供自动 DROP COLUMN

#### analyze 请求扩展

`POST /api/ai-ask/analyze` 请求体新增字段：

```json
{
  "question": "...",
  "datasourceId": 1,
  "datasourceName": "dwhrpt",
  "selectedTables": ["SCHEMA.TABLE"],
  "messageHistory": [],
  "sessionId": 42,
  "assistantMessageId": 101
}
```

`RealLlmAdapter.analyze()` 将 `sessionId` 和 `assistantMessageId` 传入 payload。

#### 精确消息绑定流程

```
1. 前端调用 createMessage(sessionId, content)
   → 后端创建 user message + assistant placeholder（status=pending）
   → 返回 { user_message, assistant_message }

2. 前端将 assistant_message.id 传给 RealLlmAdapter.analyze()
   请求含 sessionId + assistantMessageId

3. 后端 /api/ai-ask/analyze 接收 sessionId + assistantMessageId：
   a. 按 assistantMessageId 主键加载 AskMessage
   b. 验证 message.session_id == sessionId
   c. 验证 message.role == "assistant"
   d. 验证 message.status == "pending"
   e. 任意一项不匹配 → 422，不执行 LLM 调用，**不得修改消息记录**
   f. 执行现有 analyze 流程（metadata resolve → LLM → normalize → validate → SQL Trust Gate）

4. 成功后：
   - 构建 response_json (schemaVersion=1, data={...AiAskResponse, queryResult: null})
   - message.response_json = json.dumps(response_json, ensure_ascii=False)
   - message.status = "completed"
   - db.commit()

5. 失败后：
   - message.status = "failed"
   - message.error_message = "错误描述"
   - db.commit()
```

**禁止**：
- 查询"最后一条 assistant message"（必须通过主键精确加载）
- 前端自行选择 assistant message（必须使用 createMessage 返回的 id）

**并发安全**：
- 同一 session 的多个 assistant message 有各自独立的主键和 `response_json`
- 后端只按 `assistantMessageId` 精确写入，不查询 session 级别的"最新消息"
- 两个并发请求互不覆盖

#### AskService 变更

`_message_to_dict()` 新增返回 `response_json`：

```python
result = {
    "id": m.id,
    # ... 现有字段
    "response_json": _safe_load_response_json(m.response_json),
}
```

辅助函数：

```python
def _safe_load_response_json(raw: str | None) -> dict | None:
    """安全加载 response_json，版本不兼容或解析失败时返回 None。"""
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            return None
        if parsed.get("schemaVersion") != 1:
            return None  # 版本不兼容，fail closed
        return parsed
    except (json.JSONDecodeError, TypeError):
        return None  # 坏消息不阻塞整个会话
```

### 3.3 会话隔离设计

**问题**：`currentResponse`/`error`/`analysisStep`/`chartDataRef` 是全局单值

**解决方案**：为每个 session 关联的分析产物提供 API 驱动的状态恢复路径

**核心流程**：

```
用户切换会话（onSelect）：
  → useAskStore.setCurrentSession(sessionId)
  → useAskMessages(sessionId) 重新 fetch
  → 查找当前会话 assistant 消息（按创建时间降序取最新）的 response_json
  → 如果存在 → setCurrentResponse(response_json.data)
  → 如果不存在或 null → setCurrentResponse(null)
  → clearError()
  → chartDataRef.current = null
  → setAnalysisStep(0)
```

**发送新消息**：

```
用户提交问题：
  → 在当前 session 下创建 user message + assistant placeholder
  → 调用 AiAskLlmService.analyze()
  → 成功后：持久化 response_json 到 assistant_msg
  → setCurrentResponse(data)
  → AI 分析产物只属于当前 session
```

**页面刷新恢复**：
- 刷新后 `currentSessionId` 从 URL 参数或 `persist` 中恢复（如 localStorage）
- 进入页面时 `useAskMessages(sessionId)` 加载消息列表
- 从消息列表最后一条 role=assistant 的消息提取 `response_json`
- 恢复 `currentResponse`

**快速切换保护**：
- 在 `handleSend` 中添加 sessionId 校验：
  - 发送前记录 `sessionId`
  - 回调中检查当前 `currentSessionId` 是否仍等于记录值
  - 不等则不写入 `currentResponse`

```typescript
// 伪代码
const sendSessionId = currentSessionId
const resp = await adapter.analyze(question, context)
if (useAskStore.getState().currentSessionId !== sendSessionId) {
  return // 用户已切换会话，丢弃旧响应
}
```

### 3.4 自动标题设计

**触发时机**：首条用户消息的 assistant 回复成功后

**规则**（确定性，不调用 LLM）：

```typescript
function generateTitle(question: string): string {
  // 1. 取第一个完整短句（句号/问号/感叹号/换行处截断）
  const match = question.match(/^(.+?[。？！\n])/);
  let title = match ? match[1] : question;
  
  // 2. 限制最大长度（24 个中文字符或等价）
  const MAX_CHARS = 48; // UTF-8 字节预算：约 24 个中文字符
  if (title.length > MAX_CHARS) {
    title = title.slice(0, MAX_CHARS) + '…';
  }
  
  return title.trim();
}
```

**更新时机**：仅在 `AskSession.title === "新对话"` 时自动更新

**后端调用**：复用现有 `PUT /api/ask/sessions/{id}` 端点

**前端触发**：在 `handleSend` 的成功回调中：

```typescript
// 首次成功分析后自动更新标题
const session = useAskStore.getState().currentSessionId
if (session && currentSessionTitle === '新对话') {
  updateTitle.mutate({ id: session, title: generateTitle(question) })
}
```

---

## 4. Module C：移除模拟模式 UI

### 4.1 变更清单

**删除 UI 元素**：
- `AskWorkbenchPage.tsx` 中的 `<Switch checked={useRealLlm} ...>`（约 line 291-298）
- 关联的 Tooltip 文本（line 285-289）
- 错误状态下"切回模拟模式再试"按钮（两处：line 450-454, 471-475）
- `aiAskStore` 中的 `useRealLlm` 字段和 `setUseRealLlm` action
- 条件 `useRealLlm && (!datasourceId || !datasourceName)` 的数据源检查替换为：无数据源时始终检查

**保留但不暴露**：
- `MockAdapter` 类本身保留，用于 unit test、benchmark 和显式开发配置
- `RealLlmAdapter` 成为唯一的生产 adapter

**Adapter 选择逻辑变更**：

```typescript
// frontend/src/api/aiAsk/index.ts — useAiAskService
export function useAiAskService() {
  return RealLlmAdapter.create()  // 固定使用
}
```

**无 Active LLM 时的行为**：
- 当 `useLlmSettings` 返回的列表中无 `is_active === 1` 的配置时，AskInput 的发送按钮禁用
- 禁用状态下显示 tooltip 说明："未启用 LLM 模型，请前往 LLM 连接管理配置"
- 不再自动 fallback 到 MockAdapter
- 不在页面中显示"切回模拟模式再试"或任何模拟模式的可见 UI

**测试适配**：测试文件必须显式注入 adapter，不能依赖生产环境中的 adapter 选择代码。

### 4.2 唯一 True LLM 路径

```
用户输入 → validateAiAskInput → RealLlmAdapter.analyze()
  → fetch POST /api/ai-ask/analyze
  → back-end: metadata resolve → LLM → normalizer → validator → SQL Trust Gate
  → back-end: persist response_json → return data
  → front-end: setCurrentResponse(data)
```

不存在第二路径。MockAdapter 只在测试中通过 `vi.mock` 或显式注入使用。

---

## 5. Module D：统一输入区

### 5.1 设计规则

- `AskInput` 固定在主内容区底部，独立于消息滚动容器
- 所有状态下使用同一容器：空会话、历史会话、分析中、`sql_pending`、`executed`、错误
- 容器属性统一：宽度（100%）、最小高度（48px）、最大高度（120px）、padding（12px 24px）
- 主消息区域独立滚动（`overflow-y: auto`）
- 输入框在欢迎页和结果页使用相同的布局容器

### 5.2 当前布局问题与修复

**问题**：`AskWorkbenchPage.tsx` 目前有多处条件分支渲染不同的 Layout 结构
- 空会话（无 sessionId）：只渲染欢迎页 + 底部输入
- 有会话无结果：渲染 AgentNav + DataScopeBar + 消息区 + 提示卡片 + 输入
- 有会话有结果：渲染 AgentNav + DataScopeBar + 消息区 + 结果组件 + 输入

每一条分支中底部输入区的容器都可能不同。

**修复**：将 Layout 统一为单一结构

```tsx
<Layout>
  <Sider> {/* 会话列表 */} </Sider>
  <Layout>
    <Header> {/* AgentNav */} </Header>
    <DataScopeBar /> {/* 顶部数据范围 */}
    <Content style={{ overflow: 'auto', flex: 1 }}>
      {/* 根据状态渲染：欢迎/消息/结果/分析中/错误 */}
      {/* 只有这部分内容滚动 */}
    </Content>
    <Footer style={{ padding: '12px 24px' }}>
      <AskInput /> {/* 固定底部 */}
    </Footer>
  </Layout>
</Layout>
```

删除多余的条件 Layout 层级，确保 `AskInput` 不在条件分支中重复渲染。

### 5.3 窄屏适配

- 输入框最大宽度 100%
- 发送按钮不与输入框重叠（flexbox 布局，按钮在右侧独立）
- 不依赖 `position: absolute` 定位按钮

---

## 6. Module E：安全执行与真实图表闭环

### 6.1 方案选择

**选定方案**：用户确认后由专用 AI Ask API 端点执行  
**排除方案**：自动执行、仅跳转 SQL Workbench

### 6.2 新增 API

#### `POST /api/ai-ask/execute-sql`

请求体（唯一格式）：

```json
{
  "sessionId": 42,
  "assistantMessageId": 101
}
```

请求体不包含 `sql`、`datasourceId` 或任何可变字段。所有执行所需信息从服务端持久化的 `response_json` 读取。

**后端处理**：

执行顺序：先只读加载并验证 `response_json`（包括 `narrativeLevel`），再执行原子 claim，任何失败路径均释放 claim 恢复 `status=completed`。

```python
@router.post("/execute-sql")
def execute_sql(body: ExecuteSqlRequest, db=Depends(get_db)):
    # ── Phase 1：消息验证 ──────────────────────────────────────────
    msg = db.query(AskMessage).filter(
        AskMessage.id == body.assistantMessageId
    ).first()
    if not msg:
        raise HTTPException(404, detail="消息不存在")
    if msg.session_id != body.sessionId:
        raise HTTPException(422, detail="消息不属于该会话")
    if msg.role != "assistant":
        raise HTTPException(422, detail="消息类型不正确")

    # ── Phase 2：只读加载并验证 response_json ─────────────────────
    rj = _safe_load_response_json(msg.response_json)
    if rj is None:
        raise HTTPException(422, detail="消息无有效的结构化响应")
    data = rj.get("data") or {}
    narrative_level = data.get("narrativeLevel")

    if narrative_level == "executed":
        return {"ok": True, "data": data}

    if narrative_level != "sql_pending":
        raise HTTPException(422,
            detail=f"当前 narrativeLevel={narrative_level} 不允许执行")

    sql_plan = data.get("sqlPlan") or {}
    sql = sql_plan.get("sql", "")
    datasource_id = sql_plan.get("datasourceId")
    selected_tables = sql_plan.get("tables", [])
    question = data.get("question", "")
    if not sql or not datasource_id or not selected_tables:
        raise HTTPException(422, detail="SQL 计划不完整")

    # ── Phase 3：原子执行权 claim（compare-and-swap）───────────────
    original_response_json = msg.response_json
    acquired = False
    try:
        rows_updated = db.execute(
            update(AskMessage)
            .where(AskMessage.id == body.assistantMessageId)
            .where(AskMessage.status == "completed")
            .where(AskMessage.response_json == original_response_json)
            .values(status="streaming")
        ).rowcount
        db.commit()

        if rows_updated == 0:
            db.refresh(msg)
            return _resolve_claim_conflict(msg)

        acquired = True

        # Phase 4-9: metadata resolve / SQL validate / execute / narrative / persist
        # ...（与原流程一致）

        acquired = False
        return {"ok": True, "data": data}

    finally:
        if acquired:
            msg.status = "completed"
            db.commit()
```

**辅助函数**：

```python
def _resolve_claim_conflict(msg: AskMessage) -> dict:
    rj = _safe_load_response_json(msg.response_json)
    nlv = (rj.get("data") or {}).get("narrativeLevel") if rj else None
    if nlv == "executed":
        return {"ok": True, "data": rj["data"]}
    if msg.status == "streaming":
        raise HTTPException(409, detail="EXECUTION_IN_PROGRESS")
    raise HTTPException(422, detail="当前状态不允许执行")
```

#### SQL 执行超时架构契约

`SqlExecutionService` 在隔离子进程中执行 SQL 并施加硬超时。架构要点：

**1. Parent-resolved datasource**

- 父进程使用当前 `db Session` 查询并验证 `DatasourceConfig`；不存在 → HTTP 404，不写 history，不启动子进程。
- `DatasourceConfig.password_enc` 当前存储明文，Phase 5N 不调用 `key_encryption.decrypt()`；凭据加密迁移排除在本阶段之外。
- 构造可序列化 `WorkerRequest`；`password` 使用 `field(repr=False)`，仅通过 spawn 参数通道传给 child。
- 禁止日志、异常、临时结果文件输出密码。

**2. Explicit spawn**

- `multiprocessing.get_context("spawn")`。
- `SqlExecutionService` 构造参数接收可 pickle 的顶层 adapter factory reference。
- production 固定 `oracle_adapter_factory`；tests 使用 `tests/support/sql_worker_factories.py` 中的顶层 factory。
- 删除 `_METRICFORGE_SQL_ADAPTER_CLASS` 环境变量机制和 `app/adapters/fake_slow_adapter.py`。
- 新增 `tests/__init__.py`、`tests/support/__init__.py`、`tests/support/sql_worker_factories.py`。

**3. Atomic result file**

- 子进程通过 `result.tmp → flush → fsync → os.replace(result.json)` 原子发布。
- 无独立 `done` marker；`result.json` 出现即完成。
- `adapter.close()` 完成后发布结果。
- 父进程轮询 `result.json` 同时检查 `process.exitcode`。

**4. Bounded payload**

- `MAX_RESULT_ROWS = 1000`，`MAX_RESULT_BYTES = 10 MiB`。
- 对 `string`/`bytes`/`Decimal`/`date`/`datetime`/`LOB` 增量计算字节，避免 O(n²)。
- LOB 按 `remaining+1` 分块探测超限；普通大字符串纳入内存前检查。
- 父进程读取前检查 `result.json` 文件大小。
- 未知类型或超限让整次执行失败，不把错误字符串混入数据行。

**5. 错误分类矩阵**

| error_code | 触发条件 |
|------------|----------|
| `TIMEOUT` | 子进程在 `EXEC_TIMEOUT` 内未完成且无 `result.json` |
| `WORKER_CRASH` | 子进程非零退出且无 `result.json` |
| `WORKER_PROTOCOL_ERROR` | 子进程零退出但无 `result.json`；或 `result.json` 为空/损坏/JSON parse 失败 |
| `SERIALIZATION_ERROR` | 结果无法序列化；超过 `MAX_RESULT_BYTES`；文件大小超限 |
| `EXECUTION_ERROR` | SQL/adapter 业务错误；父进程 supervision 异常映射到此码 |
| `TERMINATION_FAILURE` | `kill()` 后子进程仍存活 |

**6. State machine**

- 单一 `outcome` 变量；所有路径统一设置后进入同一收尾出口。
- result 发布后等待 `NATURAL_EXIT_GRACE`；terminate → bounded join；仍存活 → kill → bounded join。
- kill 后仍存活：`outcome = TERMINATION_FAILURE`；不 `process.close()`、不 cleanup、不 janitor 删除目录。
- `finally` 仅在 `work_dir_path` 存在、`process` 未创建或 `not process.is_alive()`、且 `outcome != TERMINATION_FAILURE` 时安排清理。

**7. 运行时依赖**

- `psutil>=5.9.0`

`psutil` 用于 janitor 校验 worker 进程状态。在 Windows 上，仅判断 PID 是否存在无法避免 PID reuse 风险；janitor 会结合 `psutil.Process(pid).create_time()` 与 `worker.json` 中记录的创建时间进行比对，必要时还校验进程名，只有确认目标 worker 已死亡后才允许清理临时目录。

**8. Operational deadline**

- 全部使用 `time.monotonic()`。
- `EXEC_TIMEOUT = 30.0s`，`NATURAL_EXIT_GRACE = 2.0s`，`TERMINATE_GRACE = 2.0s`，`KILL_GRACE = 2.0s`，`READ_BUDGET = 1.0s`。
- worker supervision 受控流程预算上限：
  ```
  WALL_CLOCK_MAX = EXEC_TIMEOUT + NATURAL_EXIT_GRACE + TERMINATE_GRACE + KILL_GRACE + READ_BUDGET = 37.0 秒
  ```
- 37 秒是 worker supervision 的受控流程预算上限，不是完整 API 硬上限；不包含父进程 datasource/session/history IO 和无法用 timer 中断的 `json.load`。
- cleanup 由后台 janitor 异步处理，不在响应关键路径。

**9. Janitor 安全**

- 每个临时目录写入不含凭据的 `worker.json` metadata（`pid`、`createdAt`、`state`）。
- janitor 必须读取 `worker.json` 确认 `state` 和 worker 已死亡；不能只看 `mtime`。
- `TERMINATION_FAILURE` 目录永远跳过；活跃 worker 目录跳过。
- Windows PID reuse 风险通过 psutil 进程名/启动时间校验缓解；无法确认时保守跳过。
- 普通成功/timeout/crash 路径由父进程立即异步安排清理，janitor 仅兜底。
- 临时目录权限 `0o700`；敏感结果最长保留 24 小时。

**10. 凭据与异常脱敏**

- 禁止把原始 `str(exc)` 写入 `result.json` 或 HTTP 响应；只使用稳定错误码 + 脱敏消息。
- 完整 traceback 写服务端日志，但日志中排除 `WorkerRequest.password`。
- `SERIALIZATION_ERROR` fallback envelope 同样不得包含原始异常文本。

**11. Async/session boundary**

- `supervise_sync` 放入 `asyncio.to_thread`。
- `db Session`、history 写入、datasource 查询留在调用线程。
- worker 与 supervision thread 均不接触 `Session`。

**12. API response queryResult**

- `queryResult` 新增可选 `columnTypes?: string[]`。
- `Decimal` 最终 JSON 使用原始字符串；`columnTypes` 标记为 `decimal`。
- 超出 JS 安全范围的 `decimal` 不进入图表并显示说明。
- 类型归并：`null` 不决定类型；`int+decimal → decimal`；`int+float → float`；全 `null → unknown`；不兼容混合 → `mixed`。

**13. 前端文件清单**

| 文件 | 修改 |
|------|------|
| `frontend/src/types/aiAsk.ts` | 在 queryResult 类型中新增可选 `columnTypes?: string[]` |
| `frontend/src/api/aiAsk/validator.ts` | 校验 `columnTypes` 存在时使用该类型；不存在时兼容旧 response_json |
| `frontend/src/api/aiAsk/recommendation.ts` | 推荐图表时考虑 `columnTypes`；`decimal` 按数值处理；不兼容时降级 |
| `frontend/src/components/AiChartBoard.tsx` | 根据 `columnTypes` 判断字段类型；`decimal` 安全转换 |
| `frontend/src/components/ChartCard.tsx` | 渲染图表前校验字段类型；超出 JS 安全范围时显示说明 |
| `frontend/src/components/ChartCanvas.tsx` | 绘制图表时处理 `decimal` 字符串转换；不兼容时降级为表格 |
| `frontend/src/pages/AskWorkbenchPage.tsx` | 执行后将 `columnTypes` 存入 chart data |

#### 安全校验（后端强制）

所有校验在服务端重新执行，不信任前端状态：

1. 按主键加载消息（而不是靠前端传 `datasourceId`/`sql`）
2. 验证 session/role/status
3. 解析版本化 `response_json`（只读，不 claim 前，不修改 status）
4. 验证 `narrativeLevel == sql_pending`
5. 从服务端存储的 `sqlPlan` 读取 SQL 和 datasourceId
6. 验证 sqlPlan 完整性（`sql`、`datasourceId`、`tables` 均不为空）
7. 原子执行权 claim（仅前 6 步通过后执行）
8. 重新解析元数据（`expected_tables` 与 `resolved_tables` 必须完全相等）
9. 重新执行 `SqlValidator` + `SqlSecurityValidator`
10. 委托 `SqlExecutionService` 执行（遵循上述超时架构契约）
11. 失败时恢复 `status=completed`，保持原 `sql_pending` response_json，不覆盖已验证的 SQL

#### 执行成功后的 narrative 生成

后端生成，文件路径：`app/services/ai_ask/narrative_builder.py`

MVP 使用确定性模板，不再调用 LLM：

```python
from decimal import Decimal, InvalidOperation
from math import isfinite
from typing import Any, Optional


# ── 非指标字段关键词 ──
_NON_METRIC_KEYWORDS = frozenset({
    "id", "code", "cd", "no", "num",
    "date", "time", "timestamp", "datetime",
    "key", "hash", "guid",
})


def _to_finite_number(value: Any) -> Optional[Decimal]:
    """安全转换为有限 Decimal。非数值、NaN、Infinity 返回 None。"""
    if value is None:
        return None
    # bool 是 int 的子类，必须优先排除
    if isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return value if isfinite(value) else None
    if isinstance(value, (int, float)):
        return Decimal(str(value)) if isfinite(value) else None
    if isinstance(value, str):
        v = value.strip()
        if not v:
            return None
        try:
            d = Decimal(v)
            return d if isfinite(d) else None
        except (InvalidOperation, TypeError, ValueError):
            return None
    return None


def _detect_metric_columns(columns: list[str], rows: list[list]) -> list[str]:
    """检测可聚合的数值列。排除 ID、编码、日期等字段。"""
    if not rows:
        return []
    metrics = []
    for i, col in enumerate(columns):
        col_lower = col.lower()
        if any(kw in col_lower for kw in _NON_METRIC_KEYWORDS):
            continue
        # 检查第一行非空值的类型
        for row in rows:
            if i < len(row):
                if _to_finite_number(row[i]) is not None:
                    metrics.append(col)
                    break
                break
    return metrics


def _format_compact(value: Decimal) -> str:
    """数值格式化：万/亿缩写。"""
    fval = float(value)
    if abs(fval) >= 100_000_000:
        return f"{fval / 100_000_000:.2f}亿"
    elif abs(fval) >= 10_000:
        return f"{fval / 10_000:.2f}万"
    return f"{fval:,.2f}"


def build_executed_narrative(columns, rows, is_truncated, elapsed_ms):
    """基于真实查询结果构建 narrative（Python service 层）。"""
    row_count = len(rows)
    
    if row_count == 0:
        return {
            "summary": "查询成功但无数据",
            "keyFindings": [], "evidence": [],
            "risks": [], "nextQuestions": [],
        }
    
    metric_cols = _detect_metric_columns(columns, rows)
    dim_cols = [c for c in columns if c not in metric_cols]
    
    summary = (
        f"查询返回 {row_count} 行数据（已截断，仅展示前 {row_count} 行），耗时 {elapsed_ms}ms。"
        if is_truncated else
        f"查询返回 {row_count} 行数据，耗时 {elapsed_ms}ms。"
    )
    
    key_findings = []
    for col in metric_cols:
        col_idx = columns.index(col)
        vals = [_to_finite_number(row[col_idx]) for row in rows
                if col_idx < len(row)]
        vals = [v for v in vals if v is not None]
        if vals:
            key_findings.append(
                f"{col}：最大值 {_format_compact(max(vals))}，"
                f"最小值 {_format_compact(min(vals))}"
            )
    
    for col in dim_cols[:3]:
        col_idx = columns.index(col)
        uniq = set()
        for row in rows:
            if col_idx < len(row) and row[col_idx] is not None:
                uniq.add(str(row[col_idx]))
        key_findings.append(f"{col}：共 {len(uniq)} 个不同值")
    
    evidence = []
    for col in metric_cols:
        col_idx = columns.index(col)
        vals = [_to_finite_number(row[col_idx]) for row in rows
                if col_idx < len(row)]
        vals = [v for v in vals if v is not None]
        if vals:
            total = sum(vals, Decimal("0"))
            avg = total / len(vals)
            evidence.append({
                "claim": f"{col} 汇总",
                "fields": [col],
                "value": f"总和 {_format_compact(total)}，平均 {_format_compact(avg)}",
                "confidence": "high",
            })
    
    risks = []
    if is_truncated:
        risks.append({
            "risk": f"结果已截断，仅显示前 {row_count} 行",
            "suggestion": "建议细化查询条件",
        })
    
    return {
        "summary": summary,
        "keyFindings": key_findings,
        "evidence": evidence,
        "risks": risks,
        "nextQuestions": [],
    }
```

**空结果处理**：`rowCount === 0` 时，narrative.summary = "查询成功但无数据"，不生成任何 keyFindings 或 evidence。

### 6.3 前端执行流程

```
sql_pending 状态下 SqlPlan 下方出现"验证并执行"按钮
  → 点击前：
    - 展示执行说明：最大 1000 行、30s 超时、仅 SELECT
    - 按钮文本："验证并执行"
  → 点击：
    - loading 状态（按钮 spinner + "正在执行..."）
    - 调用 POST /api/ai-ask/execute-sql(sessionId, assistantMessageId)
      （请求体不含 sql 或 datasourceId）
    - 成功（response.data）：
      - 从 data.queryResult 读取 columns/rows/rowCount/truncated/elapsedMs
      - setCurrentResponse({...prev, narrativeLevel: 'executed', queryResult, narrative})
      - chartDataRef.current = { columns: data.queryResult.columns, rows: data.queryResult.rows }
    - 失败（HTTP 4xx 或业务错误）：
      - 保持 narrativeLevel = sql_pending
      - 展示结构化的错误信息
  → 执行成功后页面变化：
    - AiChartBoard 使用真实 rows 渲染图表
    - 结果表格展示真实 columns/rows（复用现有 Ant Design Table）
    - AiNarrative 展示 keyFindings/evidence/conclusion（narrativeLevel = 'executed' 解除守卫）
```

### 6.4 图表与真实数据约束

- `chartSuggestions` 只是视觉映射建议（chartType、xField、yFields）
- `rows` 是唯一的事实数据源
- 图表渲染时必须验证 xField/yFields 是否存在于 `rows` 的 columns 中
- 若无法匹配任何 chartSuggestion，则降级为真实结果表格展示，不生成空白或虚构图表
- 不根据 chartSuggestions 编造图表数据

### 6.5 执行失败处理

| 错误类型 | 行为 |
|----------|------|
| DDL/DML 被拦截 | 保持 sql_pending，显示结构化错误 |
| 查询超时 | 保持 sql_pending，显示"查询超时（30秒限制）" |
| 数据源不可用 | 保持 sql_pending，显示"数据源不可用" |
| 执行异常 | 保持 sql_pending，显示具体错误信息 |
| 空结果 | 显示"查询成功但无数据"，不生成事实结论 |
| 截断 | 在结果标题和 narrative 中显示"结果已截断" |

### 6.6 状态机

```
                                 +--→ executed
                                 |     (展示真实结果、图、narrative/evidence)
sql_pending --[用户确认执行]--+
                                 |--→ sql_pending (保持)
                                       (执行失败，显示结构化错误)
```

- `sql_pending`：SQL 已生成，未执行 → 不展示事实结论、图表
- `executed`：SQL 已安全执行，有真实结果 → 展示所有内容
- 不轮询、不做 expect 或 waitFor 来等执行完成

#### 幂等策略（MVP）

- 同一 `assistantMessageId` 的 `narrativeLevel` 已为 `executed` 时，不重复访问数据库
- 返回已持久化的 executed response（幂等，不再次查询）
- 本阶段不提供"重新执行"按钮
- 后续若需要重新执行，另行设计显式 endpoint（如 `POST /api/ai-ask/re-execute`），不在本阶段实现

---

## 7. API 变动汇总

| 方法 | 端点 | 变更类型 | 说明 |
|------|------|----------|------|
| POST | `/api/ai-ask/analyze` | **扩展** | 请求体新增 `sessionId`, `assistantMessageId` |
| POST | `/api/ai-ask/execute-sql` | **新增** | 安全执行 + narrative 生成，请求体 `ExecuteSqlRequest(sessionId, assistantMessageId)` |
| - | - | 新增响应体 | `ExecuteSqlResponse` — 统一返回版本化 `AiAskResponse`（含 queryResult），无论首次还是幂等命中 |
| - | `AskMessage` 模型 | **新增字段** | `response_json TEXT NULL` |
| - | `_message_to_dict()` | **改造** | 返回版本化 `response_json` |
| PUT | `/api/ask/sessions/{id}` | **复用** | 自动更新标题 |

---

## 8. DB 与 Migration

- **新增字段**：`ask_messages.response_json`（TEXT, nullable）
- **Migration 方式**：在 `schema_migration_service.py` 的 `METADATA_COLUMNS` 中新增 column 定义。`schema_migration_service` 使用 `ALTER TABLE ADD COLUMN`，幂等执行——已存在的列自动跳过，重复启动不影响已有列和数据
- **应用版本回退兼容策略**：数据库列会保留（`ALTER TABLE ADD COLUMN` 是幂等 DDL）；旧版本代码通过 `nullable=True` 忽略该列；本阶段不提供自动 DROP COLUMN
- **兼容性**：已有消息 `response_json IS NULL`；解析失败或版本不兼容时返回 None 而非中断

---

## 9. 测试策略

### 9.1 后端测试

新增测试文件：`tests/services/test_ai_ask_execution.py`

**测试覆盖**：
- API `POST /api/ai-ask/execute-sql`：
  - 正常执行成功 → 返回 columns/rows/narrative/narrativeLevel=executed
  - DDL/DML 被拦截 → 422
  - 多条语句被拦截 → 422
  - datasource 不存在的请求 → 404
  - timeout → sql_pending 保持 + 错误信息
  - row limit 截断 → truncated=true
  - 空结果 → summary="查询成功但无数据"
- SqlExecutionService：
  - 复用现有测试，新增执行后 narrative 构建测试
- 禁止自动化测试调用真实 LLM 或真实 Oracle

**Mock 策略**：
- `get_adapter_for_datasource` 返回 mock adapter
- `OracleAdapter.execute_query` 返回可控的 `QueryResult`

### 9.2 前端测试

**新增/修改测试文件**：
- `AskWorkbenchPage.test.tsx` — 修改现有测试，移除 Mock Switch 相关测试用例
- `DataScopeBar.test.tsx` — 新增搜索框行为测试
- 现有组件测试保持

**测试覆盖**：

| 模块 | 测试项 |
|------|--------|
| Data Scope | DataScopeBar 搜索时调用 `/api/sql/schema/search` |
| Data Scope | 搜索结果显示 schema.table 和 matched_on |
| Data Scope | 清空搜索关闭结果面板 |
| Data Scope | 切换数据源清空旧 selectedTables |
| Data Scope | selectedTables 统一保存 SCHEMA.OBJECT 格式 |
| 会话隔离 | 会话 A 提问后切换到 B，B 不出现 A 的结果 |
| 会话隔离 | 切回 A 可恢复 A 的 response_json |
| 会话隔离 | 新会话创建时清空 currentResponse |
| 会话隔离 | 旧请求晚返回不写入当前 session |
| 自动标题 | 首问成功后调用 `PUT /api/ask/sessions/{id}` |
| 自动标题 | 不超过最大长度，超出加省略号 |
| 自动标题 | 标题已不是"新对话"时不覆盖 |
| analyze 绑定 | 精确写入指定的 assistantMessageId（不是"最后一条"） |
| analyze 绑定 | role != assistant 时拒绝 |
| analyze 绑定 | status != pending 时拒绝 |
| analyze 绑定 | sessionId 不匹配时拒绝 |
| analyze 绑定 | 两个并发 assistant message 不串写 |
| Mock Switch 移除 | 页面不渲染 `<Switch>` |
| Mock Switch 移除 | 无 active LLM 时发送按钮禁用 + tooltip |
| Mock Switch 移除 | MockAdapter 只在测试中通过注入使用 |
| 输入区 | 欢迎态、sql_pending、executed 的输入区容器一致 |
| 输入区 | 主区域滚动时输入区保持固定 |
| 执行和图表 | sql_pending 不显示事实图 |
| 执行和图表 | 未点击执行时不调用 execute-sql |
| 执行和图表 | executed 展示真实结果表和真实图 |
| 执行和图表 | executed 显示关键发现和证据 |
| 执行和图表 | 空结果显示"查询成功但无数据" |
| 执行和图表 | 执行失败保持 sql_pending |
| 执行和图表 | 图表字段匹配降级为表格 |
| 执行安全 | execute 请求无法提交 sql 或 datasourceId（请求体无该字段） |
| 执行安全 | 篡改浏览器 state 不影响服务端执行 SQL（后端从 response_json 读取） |
| 执行幂等 | executed 重复请求不修改 status、不访问数据库 |
| 执行幂等 | 无效 response_json 后 status 不被改为 streaming |
| response_json | schemaVersion 不支持时 fail closed（返回 None） |
| migration | 重复运行 `ensure_sqlite_schema` 幂等 |
| 执行安全 | SQL plan 不完整（缺失 sql/datasourceId/tables）时 status 保持 completed，不尝试 claim |
| narrative | 空结果不生成 keyFindings/evidence |
| narrative | numeric string/Decimal 安全转换 |
| narrative | null、NaN、Infinity 不进入统计 |
| narrative | ID、编码、日期字段不作为求和指标 |
| 执行安全 | execute 时重新 resolve metadata（完整集合匹配） |
| 执行安全 | metadata 已删除/失效时不执行 SQL（METADATA_NOT_FOUND） |
| 执行安全 | 两张表只解析出一张时返回 METADATA_NOT_FOUND |
| 并发 | 两个并发 execute 请求只调用一次 SqlExecutionService |
| 并发 | sql_pending 并发调用只有一个取得 claim，其余返回 409/422 |
| 并发 | EXECUTION_IN_PROGRESS 返回 409 |
| 执行异常 | SqlExecutionService 抛 HTTPException 后 status 恢复 completed |
| 执行异常 | 未捕获异常后 status 恢复 completed |
| 执行幂等 | 首次与幂等响应结构完全相同（前端统一替换 currentResponse） |
| narrative | numeric string/Decimal/bool/NaN 混合数据正确转换 |

**不引入**：Playwright、Cypress  
**不测试**：Monaco DOM 实现细节

### 9.3 真实验收

自动化测试通过后，使用已配置真实 LLM 和目标数据源做人工 smoke：

1. 打开 AI 问数页面
2. 选择数据源
3. 提问一个问题
4. 确认 SQL Trust Gate 通过后展示 `sql_pending` 状态
5. 确认此时无数据库查询
6. 点击"验证并执行"
7. 检查返回的 columns/rows 与 SQL Workbench 手动执行一致
8. 检查图表字段值可从 rows 重算验证
9. 检查 narrative 中的数值与 rows 一致
10. 检查截断提示、空结果、执行失败等状态是否正确

---

## 10. 非目标（Out of Scope）

- 自动执行 SQL
- 多数据源 JOIN
- RAG（检索增强生成）
- 报告生成/导出
- 流式图表
- 智能敏感字段识别系统
- 会话分享/协作
- 大规模 AskWorkbenchPage 无关重构
- Playwright/Cypress/CI 配置
- Monaco DOM 测试
- 基于执行结果的 LLM 重新分析（MVP 使用确定性模板）

---

## 11. 验收标准

### Data Scope
- [ ] 页面仅出现一个"数据范围"主入口（顶部 DataScopeBar）
- [ ] 数据源右侧出现对象检索框
- [ ] 可按表名、表注释、字段名、字段注释检索
- [ ] 不再常驻渲染 587 项表列表
- [ ] 切换数据源会清空旧表选择

### 会话
- [ ] 新会话 A 提问后切换到 B，B 不出现 A 的结果
- [ ] 切回 A 可恢复 A 的消息和分析产物
- [ ] 刷新页面后仍可恢复
- [ ] 首问自动生成标题
- [ ] 快速切换时旧请求不污染当前会话
- [ ] 旧消息的 `response_json` 为 null，不影响功能

### LLM
- [ ] 页面不再显示"模拟模式"或真实 LLM Switch
- [ ] 无 active LLM 时提供明确配置引导
- [ ] MockAdapter 只在测试/benchmark/开发注入中使用

### 输入区
- [ ] 欢迎态、sql_pending、executed 的输入区尺寸一致
- [ ] 主区域滚动时输入区保持固定

### 执行和图表
- [ ] sql_pending 不显示事实图
- [ ] 未点击执行时不访问数据库
- [ ] 点击确认后只执行当前已验证的 SQL
- [ ] 执行成功后展示真实结果表和真实图
- [ ] executed 才显示事实解读与证据
- [ ] 空结果、超时、截断、数据库错误均有明确状态
- [ ] 不得出现任何 mock rows
- [ ] 图表字段无法匹配时降级为结果表格

---

## 12. 前端文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/components/DataScopeSelector.tsx` | **删除** | 不再需要 |
| `frontend/src/components/DataScopeBar.tsx` | **改造** | 增加搜索框、浏览全部按钮 |
| `frontend/src/pages/AskWorkbenchPage.tsx` | **改造** | 移除 DataScopeSelector 引用、Mock Switch 相关代码、统一输入区布局、新增执行按钮、增加 session 隔离逻辑 |
| `frontend/src/pages/AskWorkbenchPage.test.tsx` | **改造** | 移除 Mock Switch 测试用例，新增会话隔离、执行按钮测试用例 |
| `frontend/src/stores/aiAskStore.ts` | **简化** | 移除 `useRealLlm`/`setUseRealLlm`，保留核心字段 |
| `frontend/src/api/aiAsk/index.ts` | **改造** | `useAiAskService` 固定返回 `RealLlmAdapter` |
| `frontend/src/api/aiAsk/realLlmAdapter.ts` | **改造** | `getChartData()` 改为基于真实 rows 的映射 |
| `frontend/src/types/aiAsk.ts` | **不变** | 类型定义已覆盖 `NarrativeLevel`/`AiAskResponse` |
| `frontend/src/components/AiChartBoard.tsx` | **改造** | sql_pending 占位保留，executed 使用真实 rows |
| `frontend/src/components/AskInput.tsx` | **可能调整** | 确保禁用状态下有明确 tooltip 引导 |

## 13. 后端文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/api/ai_ask.py` | **新增路由** | `POST /execute-sql`；`POST /analyze` 扩展请求体 |
| `app/schemas/ai_ask.py` | **新增 schema** | `ExecuteSqlRequest(sessionId, assistantMessageId)`, `ExecuteSqlResponse`；`AiAskAnalyzeRequest` 新增 `sessionId`, `assistantMessageId` |
| `app/services/ai_ask/llm_service.py` | **改造** | analyze 通过 sessionId+assistantMessageId 精确写入 response_json |
| `app/services/ai_ask/narrative_builder.py` | **新增** | `build_executed_narrative()` 确定性模板 |
| `app/models/ask_models.py` | **新增字段** | `response_json = Column(Text, nullable=True)` |
| `app/services/ask_service.py` | **改造** | `_message_to_dict` 返回版本化 `response_json`；新增 `_safe_load_response_json` |
| `app/services/schema_migration_service.py` | **新增** | `ask_messages` 补 `response_json` 列（幂等补列） |
| `app/api/ask.py` | **不变** | 复用现有 PUT 端点和 SSE 端点 |

## 14. 备选方案回顾

### Data Scope
- **A（推荐）**：顶部统一搜索 + 浏览全部弹层 — 唯一入口、不占常驻空间、搜索立即可用
- B：左侧继续保留完整表树 — 与顶部双入口矛盾
- C：顶部与左侧双入口 — 当前状态，已有问题 #1 和 #3

### SQL 执行
- **A（推荐）**：用户确认后由专用 AI Ask API 执行 — 安全、可控、在同一个页面完成
- B：自动执行 — Trust Gate 通过后自动执行，安全风险
- C：仅跳转 SQL Workbench — 体验割裂，已有但不够

### 分析产物持久化
- **A（推荐）**：AskMessage 新增 `response_json` 字段 — 与现有模型兼容、可版本升级、刷新可恢复
- B：复用 content 字段存 JSON — 与 SSE 流式 content 冲突、不支持版本升级、不可回滚
