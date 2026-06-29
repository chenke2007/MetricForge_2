# Phase 4.5：AI SQL 联动回归与 E2E 自动化测试 — 设计文档

> **Phase 4.5 of MetricForge Development Plan**
>
> **前置依赖：** Phase 4（AI SQL Workbench Integration）已合并到 main。
> 已实现：AI 回复中 SQL 代码块含 `-- datasource_id: {id}`、`SqlCodeBlock` 一键跳转、`SqlWorkbenchPage` 自动读取 URL 参数填入编辑器。
>
> **目标：** 为上述联动链路建立自动化回归测试，不引入真实 LLM 调用、不引入浏览器级 E2E 框架。

## 1. 总体目标

本阶段专注**回归保障**，通过复用现有测试栈，覆盖 AI 问数 → SQL 工作台联动链路的核心路径，确保后续改动不会破坏以下行为：

1. AI 回复中的 SQL 代码块能正确解析 `datasource_id` 并显示"在 SQL 工作台打开"按钮。
2. 点击按钮后跳转到 SQL 工作台，URL 参数正确，SQL 中不含 `-- datasource_id:` 元信息行。
3. SQL 工作台自动选择数据源、填入 SQL。
4. 用户手动执行安全 SQL 走 `/api/sql/execute`，结果正常返回。
5. 危险 SQL 仍被 422 拦截，且不会留下执行历史。
6. 超长 SQL 不跳转，显示提示。

## 2. 范围与排除项

### 2.1 明确包含

- 前端组件/页面级测试（Vitest + jsdom + React Testing Library）
  - `SqlCodeBlock.test.tsx`
  - `SqlWorkbenchPage.test.tsx`
  - 新增 `MessageThread.test.tsx`
- 后端 API 测试补强（pytest + FastAPI TestClient）
  - `tests/services/sql/test_integration.py` 新增危险 SQL 不写 history 的断言

### 2.2 明确排除

- 不引入 Playwright、Cypress 或其他浏览器级 E2E 框架。
- 不依赖真实 LLM 调用或 SSE 全链路测试。
- 不测试 Monaco Editor 的 DOM 细节。
- 不测试完整结果表格渲染（留给后续 UI/E2E 阶段）。
- 不新增后端 API、SSE、数据库表。

## 3. 测试分层架构

```
┌─────────────────────────────────────────────────────────────────┐
│ Layer 1: 前端组件/页面测试（Vitest + jsdom + RTL）               │
│ ├─ SqlCodeBlock.test.tsx      解析、跳转、超长 SQL、编码         │
│ ├─ SqlWorkbenchPage.test.tsx  URL 参数、dwhrpt 选择、执行按钮    │
│ └─ MessageThread.test.tsx     AI 消息 → SQL 代码块 → 跳转        │
├─────────────────────────────────────────────────────────────────┤
│ Layer 2: 后端 API 测试（pytest）                                 │
│ └─ tests/services/sql/test_integration.py                       │
│    ├─ 安全 SQL 执行成功                                         │
│    ├─ 危险 SQL 返回 422                                         │
│    └─ 危险 SQL 不写入 history（新增）                           │
└─────────────────────────────────────────────────────────────────┘
```

## 4. 测试数据约定

### 4.1 前端 mock 数据源

所有涉及 datasource_id 的前端测试统一使用以下 fixture：

```typescript
const mockDatasources = [
  { id: 2, name: 'dwhrpt' },
]
```

**约束：**
- `dwhrpt` id=2 仅是当前本地测试 fixture/mock 约定。
- 业务代码不能硬编码 datasource_id=2，必须从 URL 参数或 API 返回的数据源列表中匹配。
- 前端测试中涉及 datasource_id=2 的场景都指向 dwhrpt，便于回归语义清晰。

### 4.2 SQL 代码块示例

```text
以下是查询本月到期合同的 SQL：

```sql
-- datasource_id: 2
SELECT contract_code, lessee_name, end_date
FROM DW.DW_CONTRACT
WHERE end_date BETWEEN DATE '2026-06-01' AND DATE '2026-06-30'
ORDER BY end_date
```
```

## 5. 前端测试设计

### 5.1 SqlCodeBlock.test.tsx

**状态：** 已有 7 个测试，保持并微调。

**变更：**
- 涉及 datasource_id 的测试统一改为 `id=2`。
- 新增对行首空格的容错测试：`  -- datasource_id: 2` 也能正确解析。

**用例清单：**

| 用例 | 断言 |
|------|------|
| extracts datasource_id from code first line | 首行为 `-- datasource_id: 2` 时按钮存在 |
| extracts datasource_id with leading whitespace | 行首有空格时仍能解析 id=2 |
| navigates to workbench with correct params | URL 包含 `datasource_id=2` 和编码后的 SQL |
| removes datasource_id line before passing to URL | URL 中不包含 `-- datasource_id:` 文本 |
| navigates without datasource_id when comment is missing | 无注释时 URL 只有 `sql=...` |
| does not show button for empty code | 空代码不渲染按钮 |
| shows warning modal when URL exceeds 1800 chars | 不调用 navigate，弹出 Modal |
| encodes special characters in SQL | 中文/特殊字符正确 URL 编码 |

### 5.2 SqlWorkbenchPage.test.tsx

**状态：** 已有 4 个测试，扩展到 8 个。

**Mock 调整：**
- `useSqlDatasources` 返回 `[{ id: 2, name: 'dwhrpt' }]`。
- `SqlEditorToolbar` 改为透传型 mock，渲染 `data-testid="execute-btn"` 按钮，点击调用 `onExecute`。
- store mock 保持可动态读取 `datasourceId` / `sql`。

**用例清单：**

| 用例 | 断言 |
|------|------|
| reads sql and datasource_id from URL and sets store | `setSql('SELECT * FROM test')`、`setDatasource(2, 'dwhrpt')` |
| clears URL params after consuming them | `setSearchParams({}, { replace: true })` 被调用 |
| does nothing when URL has no sql param | `setSql`、`setDatasource` 均不被调用 |
| does not call setDatasource when URL has sql but no datasource_id | 只调用 `setSql`，不调用 `setDatasource` |
| sets correct datasource name from list | `setDatasource(2, 'dwhrpt')` |
| sets datasource name after datasources load asynchronously | 先 `setDatasource(2, null)`，加载后 `setDatasource(2, 'dwhrpt')` |
| does not update datasource name when pending id is not in datasources | 无匹配项时不再额外调用 `setDatasource` |
| triggers execute mutation when execute button clicked | 点击执行按钮后 `executeMutation.mutateAsync` 被调用，参数为 `{ datasource_id: 2, sql: 'SELECT 1' }` |

### 5.3 MessageThread.test.tsx（新增）

**目标：** 验证 AI 回复消息中的 SQL 代码块能渲染跳转按钮，并正确跳转。

**Mock 策略：**
- mock `react-router-dom` 的 `useNavigate`。
- 使用真实 `MessageThread`、`AssistantMessage`、`MarkdownRenderer`、`SqlCodeBlock`。
- mock `useAskStore` 返回 `streaming: null`。
- 不涉及 `AskWorkbenchPage` 的 session/SSE/AskInput。

**用例清单：**

| 用例 | 断言 |
|------|------|
| renders SQL code block with open-in-workbench button | assistant message 包含 ```sql 代码块时，渲染"在 SQL 工作台打开"按钮 |
| navigates to workbench with stripped SQL on button click | 点击后 `navigate` 被调用，URL 为 `/sql-workbench?datasource_id=2&sql=...`，不含元信息行 |
| does not render button for non-SQL code block | 普通代码块不渲染跳转按钮 |
| handles SQL code block without datasource_id comment | 无注释时按钮仍显示，点击后 navigate 到只有 `sql` 参数的 URL |

## 6. 后端测试设计

### 6.1 tests/services/sql/test_integration.py

**状态：** 已有完整流程测试，补强一个用例。

**新增用例：**

| 用例 | 断言 |
|------|------|
| test_dangerous_sql_does_not_create_history | `DROP TABLE T_TEST` 返回 422，且 `/api/sql/history` 中不增加该次执行记录 |

**实现要点：**
- 先调用 `/api/sql/history` 获取当前 history 数量。
- 执行 `DROP TABLE T_TEST`，断言返回 422。
- 再次调用 `/api/sql/history`，断言数量未增加。

## 7. 文件变更清单

### 7.1 修改文件

| 文件 | 变更 | 说明 |
|------|------|------|
| `frontend/src/components/SqlCodeBlock.test.tsx` | 修改 | datasource_id 改为 2；新增行首空格容错测试 |
| `frontend/src/components/SqlCodeBlock.tsx` | 可能修改 | 如需支持行首空格，调整正则 |
| `frontend/src/pages/SqlWorkbenchPage.test.tsx` | 修改 | mock 数据源改为 dwhrpt；新增执行按钮测试；透传型 Toolbar mock |
| `frontend/src/pages/SqlWorkbenchPage.tsx` | 可能不修改 | 如果现有实现已满足需求 |
| `frontend/src/components/MessageThread.test.tsx` | 新增 | 页面级联动测试 |
| `tests/services/sql/test_integration.py` | 修改 | 新增危险 SQL 不写 history 测试 |

### 7.2 统计

- **新增文件：** 1（`MessageThread.test.tsx`）
- **修改文件：** 4-5
- **新增后端 API：** 0
- **新增数据库表：** 0
- **新增 SSE：** 0
- **新增 E2E 框架：** 0

## 8. 验证命令

```bash
# 前端测试
cd frontend && npm run test

# 前端构建
cd frontend && npm run build

# 后端测试
cd .. && python -m pytest tests/ -q
```

## 9. 验收标准

- [ ] `SqlCodeBlock` 能解析 `-- datasource_id: 2`，且对行首空格容错。
- [ ] `SqlCodeBlock` 跳转 URL 中 SQL 不含 `-- datasource_id:` 元信息行。
- [ ] `SqlWorkbenchPage` 从 URL 读取 `datasource_id=2` 后自动选择 `dwhrpt`。
- [ ] `SqlWorkbenchPage` 在数据源异步加载后仍能补齐 datasource name。
- [ ] `MessageThread` 渲染的 AI 消息中，SQL 代码块显示"在 SQL 工作台打开"按钮，点击后跳转正确。
- [ ] 后端危险 SQL 返回 422 且不写入 history。
- [ ] 前端测试 ≥ 24 个，后端测试 ≥ 261 个。
- [ ] `npm run test`、`npm run build`、`python -m pytest tests/ -q` 全部通过。
- [ ] 不引入 Playwright/Cypress。
- [ ] 不新增后端 API、SSE、数据库表。

## 10. 安全约束

- 不新增后端 API、SSE、数据库表。
- 不依赖真实 LLM 调用。
- 不测试 Monaco Editor DOM 细节。
- 不引入浏览器级 E2E 框架。
