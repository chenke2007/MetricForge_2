# Phase 4.5 AI SQL 联动回归与 E2E 自动化测试 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 问数 → SQL 工作台联动链路建立自动化回归测试，覆盖 SqlCodeBlock、SqlWorkbenchPage、MessageThread 以及后端 SQL 执行安全边界。

**Architecture:** 复用现有测试栈：前端 Vitest + jsdom + React Testing Library，后端 pytest + FastAPI TestClient。不引入 Playwright/Cypress，不依赖真实 LLM，通过 mock 数据和组件完成回归验证。

**Tech Stack:** React 18 + TypeScript + Vite, Vitest, React Testing Library, jsdom, Zustand, React Router v6, Ant Design, FastAPI, pytest.

## Global Constraints

- 不引入 Playwright、Cypress 或其他浏览器级 E2E 框架。
- 不依赖真实 LLM 调用或 SSE 全链路测试。
- 不测试 Monaco Editor 的 DOM 细节。
- 不测试完整结果表格渲染。
- 不新增后端 API、SSE、数据库表。
- 前端 mock 数据源统一使用 `{ id: 2, name: 'dwhrpt' }`。
- 每个 task 必须有独立测试并通过后才能 commit。TDD 优先：先写测试，再写实现。
- 频繁 commit，每个 task 一个 commit。

---

## File Structure

```
修改文件（4 个源代码/测试文件）：
  frontend/src/components/SqlCodeBlock.tsx           — 正则支持行首空格容错
  frontend/src/components/SqlCodeBlock.test.tsx      — datasource_id 改为 2，新增空格容错测试
  frontend/src/pages/SqlWorkbenchPage.test.tsx       — mock 数据源改为 dwhrpt，新增执行按钮测试
  tests/services/sql/test_integration.py             — 新增危险 SQL 不写 history 测试

新增文件（1 个测试文件）：
  frontend/src/components/MessageThread.test.tsx     — AI 消息 → SQL 代码块 → 跳转联动测试
```

---

### Task 1: SqlCodeBlock 行首空格容错 + 测试语义对齐

**Files:**
- Modify: `frontend/src/components/SqlCodeBlock.tsx`
- Modify: `frontend/src/components/SqlCodeBlock.test.tsx`

**Interfaces:**
- No external API change — `SqlCodeBlockProps` unchanged (`{ code: string; language?: string }`)
- Internal: regex `/^--\s*datasource_id:\s*(\d+)\s*\n?/` → `/^\s*--\s*datasource_id:\s*(\d+)\s*\n?/`
- Internal: tests use datasource_id=2 to align with `dwhrpt` fixture convention

- [ ] **Step 1: Write the failing test**

Modify `frontend/src/components/SqlCodeBlock.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SqlCodeBlock from './SqlCodeBlock'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

describe('SqlCodeBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extracts datasource_id from code first line', () => {
    const code = `-- datasource_id: 2\nSELECT * FROM DW_CONTRACT`
    render(<SqlCodeBlock code={code} />)
    expect(screen.getByTestId('open-in-workbench-btn')).toBeInTheDocument()
  })

  it('extracts datasource_id with leading whitespace', () => {
    const code = `  -- datasource_id: 2\nSELECT * FROM DW_CONTRACT`
    render(<SqlCodeBlock code={code} />)
    fireEvent.click(screen.getByTestId('open-in-workbench-btn'))
    const url = mockNavigate.mock.calls[0][0]
    expect(url).toContain('datasource_id=2')
  })

  it('navigates to workbench with correct params', () => {
    const code = `-- datasource_id: 2\nSELECT * FROM DW_CONTRACT`
    render(<SqlCodeBlock code={code} />)
    fireEvent.click(screen.getByTestId('open-in-workbench-btn'))
    const url = mockNavigate.mock.calls[0][0]
    expect(url).toContain('datasource_id=2')
    expect(url).toContain('sql=SELECT+*+FROM+DW_CONTRACT')
  })

  it('removes datasource_id line before passing to URL', () => {
    const code = `-- datasource_id: 2\nSELECT * FROM DW_CONTRACT`
    render(<SqlCodeBlock code={code} />)
    fireEvent.click(screen.getByTestId('open-in-workbench-btn'))
    const callUrl = mockNavigate.mock.calls[0][0]
    expect(callUrl).not.toContain('datasource_id:')
  })

  it('navigates without datasource_id when comment is missing', () => {
    const code = `SELECT * FROM DW_CONTRACT`
    render(<SqlCodeBlock code={code} />)
    fireEvent.click(screen.getByTestId('open-in-workbench-btn'))
    const url = mockNavigate.mock.calls[0][0]
    expect(url).toContain('sql=SELECT+*+FROM+DW_CONTRACT')
    expect(url).not.toContain('datasource_id=')
  })

  it('does not show button for empty code', () => {
    render(<SqlCodeBlock code="" />)
    expect(screen.queryByTestId('open-in-workbench-btn')).not.toBeInTheDocument()
  })

  it('shows warning modal when URL exceeds 1800 chars', () => {
    const longSql = 'SELECT ' + 'a'.repeat(1755) + ' FROM t'
    const code = `-- datasource_id: 2\n${longSql}`
    render(<SqlCodeBlock code={code} />)
    fireEvent.click(screen.getByTestId('open-in-workbench-btn'))
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('encodes special characters in SQL', () => {
    const code = `-- datasource_id: 2\nSELECT '中文' FROM t`
    render(<SqlCodeBlock code={code} />)
    fireEvent.click(screen.getByTestId('open-in-workbench-btn'))
    const url = mockNavigate.mock.calls[0][0]
    expect(url).toContain('%E4%B8%AD%E6%96%87')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/projects/MetricForge/frontend
npx vitest run src/components/SqlCodeBlock.test.tsx
```

Expected: FAIL — `extracts datasource_id with leading whitespace` fails because current regex requires `--` at line start.

- [ ] **Step 3: Write minimal implementation**

Modify `frontend/src/components/SqlCodeBlock.tsx` line 21:

```typescript
const match = code.match(/^\s*--\s*datasource_id:\s*(\d+)\s*\n?/)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /d/projects/MetricForge/frontend
npx vitest run src/components/SqlCodeBlock.test.tsx
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
cd /d/projects/MetricForge
git add frontend/src/components/SqlCodeBlock.tsx frontend/src/components/SqlCodeBlock.test.tsx
git commit -m "fix: tolerate leading whitespace in datasource_id comment and align tests to dwhrpt fixture"
```

---

### Task 2: SqlWorkbenchPage 测试补强

**Files:**
- Modify: `frontend/src/pages/SqlWorkbenchPage.test.tsx`
- (No change to `frontend/src/pages/SqlWorkbenchPage.tsx` if existing implementation already supports async datasource name matching)

**Interfaces:**
- Consumes: `useSqlDatasources()` returning `{ data: DatasourceOption[], isLoading: boolean }`
- Consumes: `useSqlWorkbenchStore` with `setSql`, `setDatasource`, `datasourceId`, `sql`
- Consumes: `useExecuteSql()` returning `{ mutateAsync: vi.fn() }`
- Produces: tests verify URL param consumption, datasource selection, and execute button wiring

- [ ] **Step 1: Set up mutable store mock**

Replace the store mock in `frontend/src/pages/SqlWorkbenchPage.test.tsx` with a mutable version:

```typescript
const mockStore = vi.hoisted(() => ({
  datasourceId: null as number | null,
  datasourceName: null as string | null,
  sql: '',
  setDatasource: vi.fn((id: number, name: string | null) => {
    mockStore.datasourceId = id
    mockStore.datasourceName = name
  }),
  setSql: vi.fn((sql: string) => {
    mockStore.sql = sql
  }),
  setExecuting: vi.fn(),
  setResult: vi.fn(),
  showResult: vi.fn(),
}))

vi.mock('../stores/sqlWorkbenchStore', () => ({
  useSqlWorkbenchStore: (selector: any) => selector(mockStore),
}))
```

- [ ] **Step 2: Write the updated test file**

Complete `frontend/src/pages/SqlWorkbenchPage.test.tsx`:

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SqlWorkbenchPage from './SqlWorkbenchPage'

const mockSearchParams = new URLSearchParams()
const mockSetSearchParams = vi.fn()

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
}))

const mockDatasources = vi.hoisted(() => ({
  data: [{ id: 2, name: 'dwhrpt' }] as { id: number; name: string }[] | undefined,
  isLoading: false,
}))

const mockStore = vi.hoisted(() => ({
  datasourceId: null as number | null,
  datasourceName: null as string | null,
  sql: '',
  setDatasource: vi.fn((id: number, name: string | null) => {
    mockStore.datasourceId = id
    mockStore.datasourceName = name
  }),
  setSql: vi.fn((sql: string) => {
    mockStore.sql = sql
  }),
  setExecuting: vi.fn(),
  setResult: vi.fn(),
  showResult: vi.fn(),
}))

vi.mock('../stores/sqlWorkbenchStore', () => ({
  useSqlWorkbenchStore: (selector: any) => selector(mockStore),
}))

const mockExecute = vi.fn()

vi.mock('../api/sqlWorkbench', () => ({
  useSqlDatasources: () => mockDatasources,
  useExecuteSql: () => ({
    mutateAsync: mockExecute,
  }),
}))

vi.mock('../components/SchemaPanel', () => ({ default: () => <div /> }))
vi.mock('../components/SqlEditor', () => ({ default: () => <div /> }))
vi.mock('../components/ResultPanel', () => ({ default: () => <div /> }))
vi.mock('../components/BottomPanel', () => ({ default: () => <div /> }))
vi.mock('../components/DraftFormModal', () => ({ default: () => <div /> }))

// 透传型 mock Toolbar：暴露可点击的执行按钮
vi.mock('../components/SqlEditorToolbar', () => ({
  default: ({ onExecute }: any) => (
    <button data-testid="execute-btn" onClick={onExecute}>执行</button>
  ),
}))

describe('SqlWorkbenchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.datasourceId = null
    mockStore.datasourceName = null
    mockStore.sql = ''
    mockSearchParams.delete('sql')
    mockSearchParams.delete('datasource_id')
    mockDatasources.data = [{ id: 2, name: 'dwhrpt' }]
    mockDatasources.isLoading = false
  })

  it('reads sql and datasource_id from URL and sets store', async () => {
    mockSearchParams.set('sql', 'SELECT * FROM test')
    mockSearchParams.set('datasource_id', '2')

    render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockStore.sql).toBe('SELECT * FROM test')
    })
    expect(mockStore.datasourceId).toBe(2)
    expect(mockStore.datasourceName).toBe('dwhrpt')
  })

  it('clears URL params after consuming them', async () => {
    mockSearchParams.set('sql', 'SELECT 1')

    render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockSetSearchParams).toHaveBeenCalledWith({}, { replace: true })
    })
  })

  it('does nothing when URL has no sql param', () => {
    render(<SqlWorkbenchPage />)
    expect(mockStore.setSql).not.toHaveBeenCalled()
    expect(mockStore.setDatasource).not.toHaveBeenCalled()
  })

  it('does not call setDatasource when URL has sql but no datasource_id', async () => {
    mockSearchParams.set('sql', 'SELECT 1')

    render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockStore.sql).toBe('SELECT 1')
    })
    expect(mockStore.setDatasource).not.toHaveBeenCalled()
  })

  it('sets correct datasource name from list', async () => {
    mockSearchParams.set('sql', 'SELECT 1')
    mockSearchParams.set('datasource_id', '2')

    render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockStore.datasourceName).toBe('dwhrpt')
    })
  })

  it('sets datasource name after datasources load asynchronously', async () => {
    mockDatasources.data = undefined
    mockDatasources.isLoading = true
    mockSearchParams.set('sql', 'SELECT 1')
    mockSearchParams.set('datasource_id', '2')

    const { rerender } = render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockStore.sql).toBe('SELECT 1')
    })
    expect(mockStore.datasourceId).toBe(2)
    expect(mockStore.datasourceName).toBeNull()

    mockDatasources.data = [{ id: 2, name: 'dwhrpt' }]
    mockDatasources.isLoading = false
    rerender(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockStore.datasourceName).toBe('dwhrpt')
    })
  })

  it('does not update datasource name when pending id is not in datasources', async () => {
    mockDatasources.data = undefined
    mockDatasources.isLoading = true
    mockSearchParams.set('sql', 'SELECT 1')
    mockSearchParams.set('datasource_id', '999')

    const { rerender } = render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockStore.sql).toBe('SELECT 1')
    })
    expect(mockStore.datasourceId).toBe(999)
    expect(mockStore.datasourceName).toBeNull()

    mockDatasources.data = [{ id: 2, name: 'dwhrpt' }]
    mockDatasources.isLoading = false
    rerender(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockStore.setDatasource).toHaveBeenCalledTimes(1)
    })
  })

  it('triggers execute mutation when execute button clicked', async () => {
    mockSearchParams.set('sql', 'SELECT 1')
    mockSearchParams.set('datasource_id', '2')

    render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockStore.sql).toBe('SELECT 1')
    })
    expect(mockStore.datasourceId).toBe(2)

    const executeBtn = screen.getByTestId('execute-btn')
    fireEvent.click(executeBtn)

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith({
        datasource_id: 2,
        sql: 'SELECT 1',
      })
    })
  })
})
```

- [ ] **Step 3: Run test to verify it passes**

```bash
cd /d/projects/MetricForge/frontend
npx vitest run src/pages/SqlWorkbenchPage.test.tsx
```

Expected: PASS (8 tests).

- [ ] **Step 4: Commit**

```bash
cd /d/projects/MetricForge
git add frontend/src/pages/SqlWorkbenchPage.test.tsx
git commit -m "test: strengthen SqlWorkbenchPage tests with dwhrpt fixture and execute wiring"
```

---

### Task 3: 新增 MessageThread 页面级联动测试

**Files:**
- Create: `frontend/src/components/MessageThread.test.tsx`

**Interfaces:**
- Consumes: `MessageThread` with `messages: AskMessage[]`
- Consumes: `useAskStore` returning `{ streaming: null }`
- Consumes: `react-router-dom` `useNavigate` (mocked)
- Produces: tests verify SQL code block rendering and navigation from AI message

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/MessageThread.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MessageThread from './MessageThread'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('../stores/askStore', () => ({
  useAskStore: () => ({ streaming: null }),
}))

const createAssistantMessage = (content: string) => ({
  id: 1,
  role: 'assistant',
  content,
  status: 'completed',
  session_id: 1,
  created_at: '2026-06-28T00:00:00Z',
  updated_at: '2026-06-28T00:00:00Z',
  tokens_prompt: null,
  tokens_completion: null,
  error_message: null,
})

describe('MessageThread SQL code block integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders SQL code block with open-in-workbench button', () => {
    const content = '```sql\n-- datasource_id: 2\nSELECT * FROM DW_CONTRACT\n```'
    render(<MessageThread messages={[createAssistantMessage(content)]} />)
    expect(screen.getByTestId('open-in-workbench-btn')).toBeInTheDocument()
  })

  it('navigates to workbench with stripped SQL on button click', async () => {
    const content = '```sql\n-- datasource_id: 2\nSELECT * FROM DW_CONTRACT\n```'
    render(<MessageThread messages={[createAssistantMessage(content)]} />)
    fireEvent.click(screen.getByTestId('open-in-workbench-btn'))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled()
    })

    const url = mockNavigate.mock.calls[0][0]
    expect(url).toContain('datasource_id=2')
    expect(url).toContain('sql=SELECT+*+FROM+DW_CONTRACT')
    expect(url).not.toContain('datasource_id:')
  })

  it('does not render button for non-SQL code block', () => {
    const content = '```python\nprint("hello")\n```'
    render(<MessageThread messages={[createAssistantMessage(content)]} />)
    expect(screen.queryByTestId('open-in-workbench-btn')).not.toBeInTheDocument()
  })

  it('handles SQL code block without datasource_id comment', async () => {
    const content = '```sql\nSELECT * FROM DW_CONTRACT\n```'
    render(<MessageThread messages={[createAssistantMessage(content)]} />)
    fireEvent.click(screen.getByTestId('open-in-workbench-btn'))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled()
    })

    const url = mockNavigate.mock.calls[0][0]
    expect(url).toContain('sql=SELECT+*+FROM+DW_CONTRACT')
    expect(url).not.toContain('datasource_id=')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/projects/MetricForge/frontend
npx vitest run src/components/MessageThread.test.tsx
```

Expected: FAIL — file does not exist yet.

- [ ] **Step 3: Verify the test file passes once created**

The test file itself is the deliverable; no implementation code changes are required because `MessageThread`, `AssistantMessage`, `MarkdownRenderer`, and `SqlCodeBlock` already implement the behavior.

```bash
cd /d/projects/MetricForge/frontend
npx vitest run src/components/MessageThread.test.tsx
```

Expected: PASS (4 tests).

- [ ] **Step 4: Commit**

```bash
cd /d/projects/MetricForge
git add frontend/src/components/MessageThread.test.tsx
git commit -m "test: add MessageThread integration test for AI SQL workbench linkage"
```

---

### Task 4: 后端 dangerous SQL 不写 history 测试

**Files:**
- Modify: `tests/services/sql/test_integration.py`

**Interfaces:**
- Consumes: existing `client` and `db_session` fixtures
- Produces: new test `test_dangerous_sql_does_not_create_history`

- [ ] **Step 1: Write the failing test**

Add to `tests/services/sql/test_integration.py` inside `TestFullFlow`:

```python
    def test_dangerous_sql_does_not_create_history(self, client, db_session):
        # 1. Create datasource
        ds = DatasourceConfig(
            name="danger-test", ds_type="oracle", host="127.0.0.1",
            port=1521, username="ro", dialect="oracle", is_active=True,
        )
        db_session.add(ds)
        db_session.flush()
        ds_id = ds.id

        # 2. Record history count before dangerous SQL
        resp = client.get("/api/sql/history")
        assert resp.status_code == 200
        history_before = len(resp.json())

        # 3. Execute dangerous SQL → 422
        resp = client.post("/api/sql/execute", json={
            "datasource_id": ds_id,
            "sql": "DROP TABLE T_TEST",
        })
        assert resp.status_code == 422

        # 4. Verify no new history entry
        resp = client.get("/api/sql/history")
        assert resp.status_code == 200
        history_after = len(resp.json())
        assert history_after == history_before
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /d/projects/MetricForge
python -m pytest tests/services/sql/test_integration.py::TestFullFlow::test_dangerous_sql_does_not_create_history -v
```

Expected: If behavior is already correct, PASS; if not, FAIL.

- [ ] **Step 3: Fix implementation if needed**

If the test fails because dangerous SQL writes history, modify the execution service to only persist history after successful validation. Inspect `app/services/sql_execution_service.py` and ensure history creation happens after `SqlSecurityValidator.validate(sql)` passes.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /d/projects/MetricForge
python -m pytest tests/services/sql/test_integration.py::TestFullFlow::test_dangerous_sql_does_not_create_history -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /d/projects/MetricForge
git add tests/services/sql/test_integration.py
git commit -m "test: ensure dangerous SQL does not create execution history"
```

---

### Task 5: 全量验证

**Files:**
- All modified/created test files

- [ ] **Step 1: Run all frontend tests**

```bash
cd /d/projects/MetricForge/frontend
npm run test
```

Expected: all tests PASS (≥ 24 tests).

- [ ] **Step 2: Run all backend tests**

```bash
cd /d/projects/MetricForge
python -m pytest tests/ -v --tb=short 2>&1 | tail -30
```

Expected: all tests PASS (≥ 261 tests).

- [ ] **Step 3: Build frontend**

```bash
cd /d/projects/MetricForge/frontend
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit any final adjustments**

```bash
cd /d/projects/MetricForge
git add -A
git commit -m "chore: final verification fixes for phase 4.5 regression tests"
```

---

## Self-Review

### Spec Coverage

| Spec Section | Plan Task |
|--------------|-----------|
| SqlCodeBlock 行首空格容错 | Task 1 |
| SqlCodeBlock 测试语义对齐 dwhrpt | Task 1 |
| SqlWorkbenchPage URL 参数、dwhrpt 选择 | Task 2 |
| SqlWorkbenchPage 异步加载补齐 name | Task 2 |
| SqlWorkbenchPage 执行按钮调用 mutation | Task 2 |
| MessageThread 页面级联动测试 | Task 3 |
| 后端 dangerous SQL 不写 history | Task 4 |
| 全量验证 | Task 5 |

### Placeholder Scan

- No "TBD", "TODO", "implement later"
- Every step has exact file paths, code, commands
- Test code is complete and runnable
- All function signatures consistent across tasks

### Type Consistency

- `mockDatasources` type: `{ id: number; name: string }[] | undefined`
- `mockStore` shape matches `useSqlWorkbenchStore` selectors
- `AskMessage` shape matches existing model
- `datasource_id` passed as number to `mutateAsync`

### Gap Check

- Spec requirement "不引入 Playwright/Cypress" → no E2E framework in plan
- Spec requirement "不新增后端 API/SSE/DB" → no backend changes except test file
- Spec requirement "dwhrpt id=2 fixture" → used in Task 1 and Task 2
- Spec requirement "超长 SQL 不跳转" → already covered in Task 1

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-28-phase-4-5-ai-sql-linkage-regression.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach do you want?
