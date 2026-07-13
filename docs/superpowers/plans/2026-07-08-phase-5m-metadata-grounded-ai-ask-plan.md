# Phase 5M: Metadata-Grounded AI Ask — Implementation Plan

## 概述

在 Phase 5L 真实 LLM MVP 基础上，将问题分析能力从"模型凭记忆猜数"升级为"基于已采集元数据生成可信 SQL"。核心三块：

1. **Metadata Grounding** — 接入 TableMetadata / ColumnMetadata / FieldSemantic，注入 prompt
2. **SQL Trust Gate** — sqlglot 元数据校验，拦截虚构字段和缺 schema 的 SQL
3. **Narrative Trust Rule** — SQL 未执行时不展示事实结论

---

## Task 1 — 后端 MetadataResolver + DomainRules

**范围文件：**
- `app/services/ai_ask/metadata_resolver.py` — **新增**
- `app/services/ai_ask/domain_rules.py` — **新增**
- `tests/test_metadata_resolver.py` — **新增**
- `tests/test_domain_rules.py` — **新增**

### 1.1 domain_rules.py

定义 `DOMAIN_RULES` 字典，包含：
- `naming_conventions`：DWS_ / DIM_ / ADS_ 前缀→含义
- `partition`：pt 字段规则（默认字段、类型、格式）
- `strict_schema`：True

导出函数：
- `get_table_hints(table_name: str) -> list[str]`

### 1.2 metadata_resolver.py

`MetadataResolver` 类，方法 `resolve(datasource_id: int, table_names: list[str]) -> list[ResolvedTableMetadata]`：

- 对每个 table_name，尝试 `.` 分割 → (schema_name, table_name)
- 查询 db.query(TableMetadata).filter_by(datasource_id=datasource_id, table_name=name)
- 批量查询 ColumnMetadata + FieldSemantic
- 输出 `ResolvedTableMetadata`（dataclass 或 TypedDict）：schema_name, table_name, table_comment, columns[], field_semantics[], table_rule_hints[]
- 如果问题中包含 `[A-Z][A-Z0-9_]+\\.[A-Z][A-Z0-9_]+` 格式，即使不在 selected_tables 中也自动解析
- 找不到表元数据时返回空列表（由 caller 判断 METADATA_NOT_FOUND）

### 1.3 测试

| 用例 | 验证点 |
|------|--------|
| 给定 selected_tables 返回正确 schema/table/columns | 字段结构完整 |
| 选中表无元数据 → 返回空列表 | resolve 返回值 |
| 问题中出现 DWHRPT.TABLE 格式 → 提取并查询 | 正则提取逻辑 |
| get_table_hints('DWS_RPT_...') → 含 DWS_ 规则 | 前缀匹配 |
| get_table_hints('UNKNOWN_...') → 空列表 | 未匹配 |

---

## Task 2 — PromptBuilder Metadata Grounding

**范围文件：**
- `app/services/ai_ask/prompt_builder.py` — 修改
- `tests/test_prompt_builder.py` — 修改

### 2.1 PromptBuilder.build()

- 新增参数 `metadata_context: list[ResolvedTableMetadata]`（可选）
- 当 `metadata_context` 非空时，注入到 system prompt：
  - `## 可用数据表结构` 节：每个表的 schema.table_name、comment、字段列表（column_name type — comment）
  - 字段级注释标注，如 `region_name VARCHAR(50) — 区域名称 ← 注意：字段名是 region_name 不是 region`
  - Domain rules 注入：表名约定、分区规则、schema 限定要求
- 新增约束到 system prompt：
  - 只使用列出的字段，禁止创造
  - 表名必须 schema 限定
  - pt 过滤规则
  - 只允许 SELECT
- `metadata_context` 为空时不调用 PromptBuilder（外部提前返回）

### 2.2 测试

| 用例 | 验证点 |
|------|--------|
| 给定表元数据列表，检查 prompt 包含真实字段名和注释 | prompt 含 `region_name`、`amt` |
| prompt 不包含 region / investment_amount | 无虚构字段 |
| prompt 包含"只允许 SELECT"、"schema 限定"约束 | 约束文本 |
| prompt 含 domain rules（分区规则、前缀说明） | 前缀含义 + pt 规则 |
| metadata_context 为空→build 正常但无元数据节 | 无 `可用数据表结构` |

---

## Task 3 — SQL Trust Gate with sqlglot

**范围文件：**
- `requirements.txt` — 修改：启用 `sqlglot>=25.0.0`
- `app/services/ai_ask/sql_validator.py` — **新增**
- `tests/test_sql_validator.py` — **新增**

### 3.1 启用 sqlglot 依赖

将 `# sqlglot>=20.0.0` 改为 `sqlglot>=25.0.0`

### 3.2 sql_validator.py

`SqlValidator` 类，方法 `validate(sql_plan, resolved_metadata) -> SqlValidationResult`：

- `extract_tables(sql)` — sqlglot 解析表引用（排除 CTE 名/子查询别名），返回 `list[str]`
- `extract_columns(sql)` — 提取 SELECT/WHERE/GROUP BY/ORDER BY 中字段
- `has_ddl(sql)` — regex `(DELETE|UPDATE|INSERT|DROP|ALTER|CREATE|TRUNCATE)`
- 校验规则 6 条（全部为 error）：

| # | 规则 | 检查 |
|---|------|------|
| 1 | 字段存在性 | sql_plan.fields 和 SQL 中提取的字段名必须存在于至少一个目标表 |
| 2 | Schema 限定 | 真实表引用必须带 schema 前缀（排除 CTE 名，用 sqlglot 区分） |
| 3 | SQL 操作类型 | regex `^\s*(SELECT|WITH\s)`，包含 DDL/DML 时拦截 |
| 4 | 表引用不超范围 | SQL 引用的表必须在 selected_tables / 自动解析范围内 |
| 5 | pt 分区规则 | 快照表（DomainRules 推导）必须包含 pt 过滤 |
| 6 | 字段大小写 | 元数据大写时 SQL 引用必须大小写匹配 |

- `validate()` 返回 `SqlValidationResult`（rules 字段：errors[], warnings[], sql）

### 3.3 测试

| 用例 | 验证点 |
|------|--------|
| 不存在字段 `region` → errors 含 FIELD_NOT_FOUND | 拦截虚构字段 |
| `FROM DWS_RPT` 缺 schema → errors 含 TABLE_SCHEMA_MISSING | schema 限定 |
| `DELETE FROM` → errors 含 DDL_DML_NOT_ALLOWED | DDL 拦截 |
| `pt='20260630'` 合法 → errors 空 | 合法 SQL 通过 |
| 无 pt 过滤 → errors 含 PARTITION_FILTER_MISSING | 分区规则 |
| CTE/JOIN/子查询 SQL 能正确提取表 | sqlglot 复杂解析 |
| 字段大写但 SQL 小写 → CASE_MISMATCH | 大小写规则 |
| SQL 引用未选表 → UNKNOWN_TABLE_REFERENCE | 表范围检查 |
| json_extract 等复杂表达式不崩溃 | sqlglot 容错 |

---

## Task 4 — AiAskLlmService 集成

**范围文件：**
- `app/services/ai_ask/llm_service.py` — 修改
- `app/services/ai_ask/normalizer.py` — 修改
- `app/services/ai_ask/validator.py` — 修改
- `app/schemas/ai_ask.py` — 修改
- `tests/test_ai_ask_llm.py` — 修改

### 4.1 AiAskErrorCode 新增

```python
METADATA_NOT_FOUND = "METADATA_NOT_FOUND"
```

### 4.2 analyze() 流程改动

```
1. 构建 request dict（现有）
2. MetadataResolver.resolve(datasource_id, selected_tables)
3. 如果 resolved 为空（全无元数据）：
   - 检查问题中 schema.table 正则
   - 正则提取也无元数据 → 直接返回 METADATA_NOT_FOUND（不调 LLM）
4. PromptBuilder.build(request, metadata_context=resolved)
5. 调用 LLM（现有）
6. Normalizer.normalize()（现有）
7. Datasource override（现有, Phase 5L）
8. 后端 sanitize narrative（sql_pending 时清理 keyFindings/evidence）
9. SqlValidator.validate(sql_plan, resolved_metadata)
10. 如果 validator failed → 返回 INVALID_RESPONSE + details.sqlValidation
11. 设置 narrativeLevel = "sql_pending" 到 data 中
12. 返回 success
```

### 4.3 Normalizer 修改

- 在 normalize() 中保留 `narrativeLevel` 字段透传
- `sqlValidation` 字段不在 normalization 中处理（由 llm_service 直接构造）

### 4.4 Validator 修改（后端 validate_ai_ask_response）

- 使 `narrativeLevel` 作为可选字段，不报错
- `sqlValidation` 作为可选字段，不报错

### 4.5 测试

| 用例 | 验证点 |
|------|--------|
| Mock LLM 返回包含错误字段的 SQL → ok:false INVALID_RESPONSE | SQL validator 拦截 |
| 无元数据 → ok:false METADATA_NOT_FOUND（**不调 LLM**） | 不调 LLM 断言 |
| 成功响应 → keyFindings 为空、evidence 为空 | sanitize 生效 |
| 成功响应 → narrativeLevel = "sql_pending" | 字段赋值 |
| 成功响应 → summary 不含事实数字（百分比/金额） | sanitize 文本检查 |

### 4.6 _sanitize_narrative_for_sql_pending()

```python
def _sanitize_narrative_for_sql_pending(narrative: dict) -> dict:
    return {
        "summary": _build_safe_summary(narrative),
        "keyFindings": [],
        "evidence": [],
        "risks": narrative.get("risks", []),
        "nextQuestions": narrative.get("nextQuestions", []),
    }
```

`_build_safe_summary()`：从 LLM 原始 narrative 提取分析口径，剥离具体数字结论。

---

## Task 5 — 前端类型与错误展示

**范围文件：**
- `frontend/src/types/aiAsk.ts` — 修改
- `frontend/src/api/aiAsk/errors.ts` — 修改
- `frontend/src/api/aiAsk/realLlmAdapter.ts` — 修改
- `frontend/src/api/aiAsk/validator.ts` — 修改
- `frontend/src/components/SqlValidationAlert.tsx` — **新增**
- `frontend/src/api/aiAsk/realLlmAdapter.test.ts` — 修改（现有测试文件补充新用例）
- `frontend/src/components/SqlValidationAlert.test.tsx` — **新增**

### 5.1 类型新增

```typescript
// aiAsk.ts
export type NarrativeLevel = 'sql_pending' | 'executed'

export interface SqlValidationError {
  rule: string
  field?: string
  table?: string
  message: string
}

export interface SqlValidationDetail {
  errors: SqlValidationError[]
  warnings: string[]
  sql: string
}
```

### 5.2 AiAskResponse 扩展

- `narrativeLevel?: NarrativeLevel`
- `sqlValidation?: SqlValidationDetail`

### 5.3 AiAskErrorCode 扩展

前端 `errors.ts` 新增 `METADATA_NOT_FOUND` 和 `INVALID_RESPONSE`（已有，但需要配套 mapping）：

```typescript
case 'METADATA_NOT_FOUND':
  return '未找到该表元数据，请先采集元数据'
```

### 5.4 realLlmAdapter.ts 改动

- `validateAiAskResponse` 需要兼容 `narrativeLevel` / `sqlValidation` 可选字段
- `INVALID_RESPONSE + details.sqlValidation` 透传，使用已有 `AiAskError` 路径
- `METADATA_NOT_FOUND` 使用已有 `AiAskError` 路径（前端已有 `ok:false` → error 逻辑）

### 5.5 SqlValidationAlert.tsx

- 接收 `errors: SqlValidationError[]` + `sql` 文本
- 按 rule 分组展示 error 卡片
- 不展示原生 SQL 文本
- "切回模拟模式再试"按钮（接收 `onSwitchToMock` 回调）
- 展示位置：替代 AiNarrative 区域

### 5.6 前端 validator 兼容

`validator.ts`：
- `narrativeLevel` 不校验（可选字段）
- `sqlValidation` 不校验（可选字段）

### 5.7 测试

| 用例 | 验证点 |
|------|--------|
| SqlValidationAlert 展示 errors 列表 | 渲染正确 |
| SqlValidationAlert 不展示 SQL | 无 `<code>` 块 |
| 收到 METADATA_NOT_FOUND → 展示"未找到该表元数据" | error 消息 |
| narrativeLevel 可选不报错 | validator 兼容 |

---

## Task 6 — Narrative Trust UI

**范围文件：**
- `frontend/src/components/AiNarrative.tsx` — 修改
- `frontend/src/components/AiNarrative.test.tsx` — **新增**
- `frontend/src/pages/AskWorkbenchPage.tsx` — 修改

### 6.1 AiNarrative 改动

- 新增 `narrativeLevel?: NarrativeLevel` prop
- `narrativeLevel === 'sql_pending'` 时：
  - summary：✅ 展示（已 sanitized 的分析口径说明）
  - keyFindings：❌ 强制不展示，无论后端传什么
  - evidence：❌ 强制不展示，无论后端传什么
  - conclusion：❌ 强制不展示
  - risks：✅ 展示
  - nextQuestions：✅ 展示
- `narrativeLevel === 'executed'` 时：正常展示所有字段

### 6.2 AskWorkbenchPage 传递

- `currentResponse.narrativeLevel` 传给 `AiNarrative`

### 6.3 AskWorkbenchPage 错误处理

当 `storeError.code === 'METADATA_NOT_FOUND'`：
- 展示"表元数据未采集"提示 + "前往数据源采集元数据"按钮
- 不渲染 AiNarrative / chartSuggestions / SqlPlan

当 `storeError.code === 'INVALID_RESPONSE'` 且 `storeError.details?.sqlValidation`：
- 展示 SqlValidationAlert
- 不渲染 AiNarrative / chartSuggestions / SqlPlan

### 6.4 AiChartBoard sql_pending 标注

- sql_pending 时 chartSuggestions 展示"⏳ 待 SQL 执行后渲染"标签

### 6.5 测试

| 用例 | 验证点 |
|------|--------|
| narrativeLevel=sql_pending → 不展示 keyFindings（即使数据存在）| AiNarrative 二次保护 |
| narrativeLevel=sql_pending → 不展示 evidence/conclusion | 过滤逻辑 |
| narrativeLevel=sql_pending → 展示 summary/risks/nextQuestions | 正常展示字段 |
| narrativeLevel=executed → 正常展示所有 | 兼容旧行为 |
| METADATA_NOT_FOUND 错误 → 展示引导提示 | 页面行为 |
| INVALID_RESPONSE + sqlValidation → 展示 SqlValidationAlert | 页面行为 |

---

## Task 7 — Data Scope UX 搜索与布局

**范围文件：**
- `app/services/sql_schema_service.py` — 修改
- `frontend/src/components/DataScopeSelector.tsx` — **重构**
- `frontend/src/components/DataScopeBar.tsx` — **新增**
- `frontend/src/pages/AskWorkbenchPage.tsx` — 修改
- `frontend/src/components/DataScopeSelector.test.tsx` — 修改
- `tests/test_ask_api.py` — 修改（如适用）

### 7.1 后端 SchemaService.search() 增强

- 增加 `table_comment` 的 like 搜索：`TableMetadata.table_comment.ilike(pattern)`
- 增加 `ColumnMetadata.comment` 的 like 搜索
- 搜索结果增加 `matched_on` 字段，说明匹配原因
- 结果匹配类型区分：`table_name`, `table_comment`, `column_name`, `column_comment`

### 7.2 DataScopeBar.tsx（新增）

顶部数据集栏：
- 数据源 Select（复用现有，宽度 200px）
- 已选表 tags（可点击移除）
- "选择数据范围"按钮 → 折叠/展开左侧面板

### 7.3 DataScopeSelector.tsx 重构

按 spec 方案 C：

- **顶部搜索框**：`Input.Search`，placeholder="搜索表名或字段名"
- 搜索时调用 `GET /api/sql/schema/search?datasource_id=X&q=keyword`
- 搜索结果展示：按匹配类型分组（表名匹配 / 表注释匹配 / 字段名匹配 / 字段注释匹配）
- 每个匹配项显示 `matched_on` 说明
- **默认状态**：展示表树（现有 Collapse 结构）
- 左侧面板可折叠，折叠控制由顶部 DataScopeBar 驱动

### 7.4 会话列表布局（缓解左侧面板拥挤）

当前问题：数据范围表树与会话列表在 220px Sider 内争夺纵向空间，Phase 5M 必须缓解但**不做完整会话管理重构**。

MVP 方案：

- **顶部 DataScopeBar** 位于 AgentNav 下方，展示数据源 Select、已选表 tags、数据范围面板折叠按钮。不占用 Sider 空间。
- **左侧可折叠面板优先承载数据范围搜索和表/字段树**，不再与会话列表对等分割空间。
- **会话列表轻量化**：
  - 默认折叠/紧凑模式：置于左侧面板下方，只显示当前会话名 + "新建对话"和"切换会话"入口，不展开完整列表。
  - 或作为顶部下拉入口（AgentNav 区域内的快速会话切换）。
- 不做以下改动（避免重构膨胀）：
  - 不拆分 `AskWorkbenchPage.tsx`
  - 不重写 SessionList 组件
  - 不改路由
  - 不改 DataScopeSelector props 接口
  - 不做 drag & drop

### 7.5 AskWorkbenchPage 布局改动

- 集成 DataScopeBar 到顶部区域（AgentNav 下方）
- Sider width 从 220px → 260px
- Sider 添加 collapsible

### 7.6 不引入（MVP 边界）

- 不拆分路由
- 不做 drag & drop
- 不改 DataScopeSelector props 接口
- 不做完整会话管理重构
- 不重写 SessionList 组件

### 7.7 测试

| 用例 | 验证点 |
|------|--------|
| 输入表名 → 调用 `/api/sql/schema/search` | API 调用 |
| 返回"表名匹配"/"字段注释匹配"等分组 | 分组展示 |
| 4 种匹配类型表名/表注释/字段名/字段注释 | matched_on 字段 |
| 后端 search() 返回 matched_on | 增强后响应 |
| 表注释 like 搜索 | SQL 查询验证 |

---

## Task 8 — 最终验证

**范围文件：** 无新增代码，纯验证。

### 8.1 运行命令

```bash
# 后端测试
cd d:\projects\MetricForge
pip install -r requirements.txt  # sqlglot 依赖安装
python -m pytest tests/ -q

# 前端检查
cd frontend
npm run test          # vitest
npx tsc --noEmit      # TypeScript 编译
npm run build         # Vite build
npm run benchmark     # Quality benchmarks
```

### 8.2 约束检查

- ❌ 无 DB migration（仅查 TableMetadata / ColumnMetadata / FieldSemantic）
- ❌ 不调用真实 LLM 测试（mock LLM 调用）
- ❌ 不引入 Playwright / Cypress
- ❌ 不测试 Monaco DOM
- ❌ 不处理历史 untracked 文件（.venv / .superpowers / docs/references）

### 8.3 提交

```bash
git add <all changed files>
git commit -m "feat(phase-5m): metadata-grounded AI ask & SQL trust gate"
```

---

## Self-Review 清单

- [x] API 路径全部是 `/api/sql/schema/search`（非旧路径）
- [x] schema 缺失是 error，不是 warning（规则 2 为 error）
- [x] sql invalid → `ok:false` error 路径，不走 narrative
- [x] metadata missing → `ok:false` error 路径，不走 narrative
- [x] sql_pending 后端 sanitize narrative（清空 keyFindings/evidence）
- [x] sqlglot 依赖处理明确：`requirements.txt` 启用 `sqlglot>=25.0.0`
- [x] 每个 Task 文件范围清楚
- [x] 不写实现代码（本 plan 不含代码）
- [x] 不 push / PR / merge

## 文件变更总览

| 文件 | 变更类型 | Task |
|------|---------|------|
| `app/services/ai_ask/metadata_resolver.py` | **新增** | T1 |
| `app/services/ai_ask/domain_rules.py` | **新增** | T1 |
| `tests/test_metadata_resolver.py` | **新增** | T1 |
| `tests/test_domain_rules.py` | **新增** | T1 |
| `app/services/ai_ask/prompt_builder.py` | 修改 | T2 |
| `tests/test_prompt_builder.py` | 修改 | T2 |
| `requirements.txt` | 修改 | T3 |
| `app/services/ai_ask/sql_validator.py` | **新增** | T3 |
| `tests/test_sql_validator.py` | **新增** | T3 |
| `app/services/ai_ask/llm_service.py` | 修改 | T4 |
| `app/services/ai_ask/normalizer.py` | 修改 | T4 |
| `app/services/ai_ask/validator.py` | 修改 | T4 |
| `app/schemas/ai_ask.py` | 修改 | T4 |
| `tests/test_ai_ask_llm.py` | 修改 | T4 |
| `frontend/src/types/aiAsk.ts` | 修改 | T5 |
| `frontend/src/api/aiAsk/errors.ts` | 修改 | T5 |
| `frontend/src/api/aiAsk/realLlmAdapter.ts` | 修改 | T5 |
| `frontend/src/api/aiAsk/validator.ts` | 修改 | T5 |
| `frontend/src/components/SqlValidationAlert.tsx` | **新增** | T5 |
| `frontend/src/components/SqlValidationAlert.test.tsx` | **新增** | T5 |
| `frontend/src/components/AiNarrative.tsx` | 修改 | T6 |
| `frontend/src/components/AiNarrative.test.tsx` | **新增** | T6 |
| `frontend/src/pages/AskWorkbenchPage.tsx` | 修改 | T6, T7 |
| `app/services/sql_schema_service.py` | 修改 | T7 |
| `frontend/src/components/DataScopeSelector.tsx` | 重构 | T7 |
| `frontend/src/components/DataScopeBar.tsx` | **新增** | T7 |
| `frontend/src/components/DataScopeSelector.test.tsx` | 修改 | T7 |
