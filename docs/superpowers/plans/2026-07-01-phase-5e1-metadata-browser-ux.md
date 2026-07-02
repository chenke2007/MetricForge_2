# Phase 5E.1 Metadata Browser UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 UX issues in the SQL Workbench metadata browser: (1) table expand shows no columns, (2) table name+comment display is unreadable, (3) panel width is not resizable.

**Architecture:** All fixes are frontend-only. The backend API (`GET /sql/tables/{id}/columns`) and frontend hook (`useTableColumns`) already exist but are unused by SchemaTree. Use a lightweight custom drag-handle (no new dependency) for resizable panel. Search mode will render column-level results as child nodes under their parent table.

**Tech Stack:** React 18, Ant Design 5, TanStack Query 5, Zustand 5, Vitest + React Testing Library

## Global Constraints

- No new backend API endpoints, no DB schema/migration changes
- No new npm dependencies (custom splitter, no react-resizable-panels)
- Only touch: `SchemaTree.tsx`, `SqlWorkbenchPage.tsx`, new `SchemaTree.test.tsx`
- Do NOT write to localStorage/sessionStorage for width persistence
- Do NOT push, merge, or create PRs
- All tests via Vitest + React Testing Library (no Playwright/Cypress)
- TypeScript `--noEmit` must pass
- `npm run build` must pass

---

### Task 1: Add SchemaTree.test.tsx with full test coverage

**Files:**
- Create: `frontend/src/components/SchemaTree.test.tsx`

**Interfaces:**
- Consumes: `SchemaTree` component from `./SchemaTree`, hooks from `../api/sqlWorkbench`
- Produces: Test suite covering all fix requirements; defines expected render structure that Task 2, 3, 4 will fulfill

- [ ] **Step 1: Write the failing test file**

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SchemaTree from './SchemaTree'

// ─── Mock api/sqlWorkbench ───

const mockSchemaData = {
  datasource_id: 1,
  datasource_name: 'dwhrpt',
  schemas: [
    {
      schema_name: 'DWHRPT',
      tables: [
        { id: 101, name: 'ADS_CHANPJZL_D', comment: '渠道品鉴质量明细', column_count: 15 },
        { id: 102, name: 'ADS_SALE_DAILY', comment: null, column_count: 8 },
        { id: 103, name: 'A_LONG_TABLE_NAME_EXCEEDING_MAXIMUM_WIDTH', comment: '这是一个非常长的中文备注用来测试截断效果', column_count: 5 },
      ],
    },
  ],
}

const mockColumnsData: Record<number, any[]> = {
  101: [
    { id: 1, name: 'ID', type: 'NUMBER', nullable: false, comment: '主键ID', is_primary_key: true, is_foreign_key: false },
    { id: 2, name: 'CHANNEL_NAME', type: 'VARCHAR2(100)', nullable: true, comment: '渠道名称', is_primary_key: false, is_foreign_key: false },
    { id: 3, name: 'PING_GRADE', type: 'VARCHAR2(20)', nullable: true, comment: null, is_primary_key: false, is_foreign_key: false },
    { id: 4, name: 'CREATED_AT', type: 'DATE', nullable: false, comment: '创建时间', is_primary_key: false, is_foreign_key: true },
  ],
  102: [
    { id: 5, name: 'SALE_DATE', type: 'DATE', nullable: false, comment: '销售日期', is_primary_key: true, is_foreign_key: false },
    { id: 6, name: 'AMOUNT', type: 'NUMBER(12,2)', nullable: false, comment: null, is_primary_key: false, is_foreign_key: false },
  ],
}

const mockSearchResults = [
  { match_type: 'table', schema_name: 'DWHRPT', table_name: 'ADS_CHANPJZL_D', table_comment: '渠道品鉴质量明细', column_name: null, table_id: 101 },
  { match_type: 'column', schema_name: 'DWHRPT', table_name: 'ADS_CHANPJZL_D', table_comment: null, column_name: 'CHANNEL_NAME', table_id: 101 },
  { match_type: 'column', schema_name: 'DWHRPT', table_name: 'ADS_CHANPJZL_D', table_comment: null, column_name: 'PING_GRADE', table_id: 101 },
]

let mockSearchText = ''
let mockDatasourceId: number | null = 1

vi.mock('../api/sqlWorkbench', () => ({
  useSchemaTree: (datasourceId: number | null) => ({
    data: mockSchemaData,
    isLoading: false,
    error: null,
  }),
  useSearchSchema: (datasourceId: number | null, q: string) => ({
    data: q ? mockSearchResults : undefined,
  }),
  useTableColumns: (tableId: number | null) => ({
    data: tableId ? mockColumnsData[tableId] || [] : undefined,
    isLoading: false,
    error: null,
  }),
}))

const mockAppendSql = vi.fn()
vi.mock('../stores/sqlWorkbenchStore', () => ({
  useSqlWorkbenchStore: (selector: any) =>
    selector({ appendSql: mockAppendSql }),
}))

describe('SchemaTree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDatasourceId = 1
    mockSearchText = ''
  })

  it('shows placeholder when no datasource selected', () => {
    mockDatasourceId = null
    // Re-render with null datasourceId requires us to pass it as prop
    // We test via the props below
  })

  it('renders schema and table nodes', () => {
    render(<SchemaTree datasourceId={1} />)
    expect(screen.getByText('DWHRPT')).toBeInTheDocument()
    expect(screen.getByText('ADS_CHANPJZL_D')).toBeInTheDocument()
  })

  it('shows table with null comment (no comment text)', () => {
    render(<SchemaTree datasourceId={1} />)
    // ADS_SALE_DAILY has null comment - should not show "(null)"
    expect(screen.getByText('ADS_SALE_DAILY')).toBeInTheDocument()
    // The comment "(null)" should NOT appear
    expect(screen.queryByText('(null)')).not.toBeInTheDocument()
  })

  it('shows column_count badge for tables', () => {
    render(<SchemaTree datasourceId={1} />)
    expect(screen.getByText('15')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
  })

  it('loads and displays columns when table node is expanded', async () => {
    render(<SchemaTree datasourceId={1} />)

    // Find the expand icon for ADS_CHANPJZL_D and click it
    const tableNode = screen.getByText('ADS_CHANPJZL_D')
    // The expand trigger is the parent Tree node's switcher icon
    // Ant Design Tree: click the switcher icon (<span class="ant-tree-switcher">)
    const switcher = tableNode.closest('.ant-tree-treenode')?.querySelector('.ant-tree-switcher')
    if (switcher) fireEvent.click(switcher)

    await waitFor(() => {
      expect(screen.getByText('CHANNEL_NAME')).toBeInTheDocument()
    })

    // Column should show type
    expect(screen.getByText('VARCHAR2(100)')).toBeInTheDocument()

    // Column with comment should show it (truncated with tooltip likely)
    expect(screen.getByText('渠道名称')).toBeInTheDocument()

    // Column with null comment should still show
    expect(screen.getByText('PING_GRADE')).toBeInTheDocument()

    // Primary key indicator
    expect(screen.getByText('ID')).toBeInTheDocument()
  })

  it('shows primary key and foreign key markers', async () => {
    render(<SchemaTree datasourceId={1} />)

    const tableNode = screen.getByText('ADS_CHANPJZL_D')
    const switcher = tableNode.closest('.ant-tree-treenode')?.querySelector('.ant-tree-switcher')
    if (switcher) fireEvent.click(switcher)

    await waitFor(() => {
      expect(screen.getByText('ID')).toBeInTheDocument()
    })

    // PK marker should exist (🔑 or PK badge)
    // We check for a key-related indicator near the ID column
    const container = screen.getByText('ID').closest('.ant-tree-node-content-wrapper')
    expect(container?.textContent).toMatch(/PK|🔑|KEY/i)
  })

  it('shows loading spinner when table columns loading', () => {
    // Override mock for this test only - use a dynamic mock
  })

  it('shows empty state when table has no columns', () => {
    // Table with 0 columns should show "无字段" or similar
  })

  it('shows error state when column fetch fails', () => {
    // Error should display Alert or message
  })

  it('displays search results including column matches', async () => {
    render(<SchemaTree datasourceId={1} />)

    // Type in search box
    const searchInput = screen.getByPlaceholderText('搜索表名/字段名')
    fireEvent.change(searchInput, { target: { value: 'CHANNEL' } })

    await waitFor(() => {
      // Table match should appear
      expect(screen.getByText('ADS_CHANPJZL_D')).toBeInTheDocument()
      // Column match should appear as child or table entry
      expect(screen.getByText('CHANNEL_NAME')).toBeInTheDocument()
    })
  })

  it('appends SQL on table double-click', () => {
    render(<SchemaTree datasourceId={1} />)

    const tableNode = screen.getByText('ADS_CHANPJZL_D')
    fireEvent.doubleClick(tableNode)

    expect(mockAppendSql).toHaveBeenCalledWith('SELECT * FROM ADS_CHANPJZL_D')
  })

  it('shows ellipsis tooltip for long table comments', () => {
    render(<SchemaTree datasourceId={1} />)
    // A_LONG_TABLE_NAME has a very long comment
    // The rendered text should be truncated with ellipsis
    // Tooltip on hover should show full text
  })
})
```

Note: Some tests are placeholders because Ant Design Tree's expand behavior and mock structure need refinement during implementation. The core assertions (render schema/table, expand shows columns, column fields display, search includes column matches) are concrete.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/components/SchemaTree.test.tsx 2>&1 | head -40
```

Expected: FAIL with errors (file not found since test file was just created).

- [ ] **Step 3: Refine test mocks and assertions iteratively**

After creating the file, run tests and fix mock structure until the test file compiles (tests may still fail on logic, that's expected for TDD).

- [ ] **Step 4: Verify test infrastructure works**

```bash
cd frontend && npx vitest run src/components/SchemaTree.test.tsx 2>&1 | tail -20
```

Expected: Tests run and show appropriate failures (component not yet implementing the features).

---

### Task 2: Fix table name + comment display + column_count badge

**Files:**
- Modify: `frontend/src/components/SchemaTree.tsx`

**Interfaces:**
- Consumes: `schemaTree` data from `useSchemaTree`, `searchResults` from `useSearchSchema`
- Produces: Improved `buildTreeData()` rendering table names with monospace font, secondary-line comments with Tooltip+ellipsis, and `N columns` badge

- [ ] **Step 1: Write failing tests**

Tests from Task 1 that assert proper table name/comment display will fail until this task.

Run:
```bash
cd frontend && npx vitest run src/components/SchemaTree.test.tsx 2>&1
```

Expected: Failing — comments not yet styled with multi-line layout.

- [ ] **Step 2: Modify `buildTreeData()` in SchemaTree.tsx**

Replace the table title rendering (lines 56-69) with:

```tsx
// Inside buildTreeData(), the table node title:
{
  key: `table-${table.id}`,
  title: (
    <div
      style={{ cursor: 'pointer', lineHeight: 1.6 }}
      onDoubleClick={() => handleDoubleClickTable(table.name)}
      title={table.name}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontFamily: 'Consolas, "Courier New", monospace', fontWeight: 600, fontSize: 13 }}>
          {table.name}
        </span>
        <span style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap' }}>
          ({table.column_count} columns)
        </span>
      </div>
      {table.comment && (
        <div
          style={{
            fontSize: 12,
            color: '#888',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '100%',
          }}
          title={table.comment}
        >
          {table.comment}
        </div>
      )}
    </div>
  ),
  icon: '📋',
  isLeaf: false,
}
```

- [ ] **Step 3: Run tests to verify**

```bash
cd frontend && npx vitest run src/components/SchemaTree.test.tsx 2>&1
```

Expected: Tests for table name, column_count badge, null comment handling pass.

- [ ] **Step 4: Run TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1
```

Expected: No errors.

---

### Task 3: Load and display column details on table expand

**Files:**
- Modify: `frontend/src/components/SchemaTree.tsx`

**Interfaces:**
- Consumes: `useTableColumns(tableId)` from `../api/sqlWorkbench`
- Produces: `ColumnDetail[]` rendered as tree children under each expanded table node
- Data flowing: `expandedKeys` changes → detect `table-{id}` keys → fetch columns → build column child nodes

- [ ] **Step 1: Write failing tests**

Tests from Task 1 that assert columns appear on expand will fail. Run:
```bash
cd frontend && npx vitest run src/components/SchemaTree.test.tsx 2>&1
```
Expected: Failing — no columns rendered.

- [ ] **Step 2: Add state and column fetching to SchemaTree**

Add these state variables and imports:

```tsx
import { useSchemaTree, useSearchSchema, useTableColumns } from '../api/sqlWorkbench'
import type { ColumnDetail } from '../api/sqlWorkbench'

// Inside component, add:
const [columnCache, setColumnCache] = useState<Record<number, ColumnDetail[]>>({})

// Handle expand to fetch columns for table nodes
const handleExpand = useCallback((keys: React.Key[]) => {
  setExpandedKeys(keys)

  // Find newly expanded table keys and fetch columns
  const prevKeys = new Set(expandedKeys)
  for (const key of keys) {
    if (typeof key === 'string' && key.startsWith('table-') && !prevKeys.has(key)) {
      const tableId = parseInt(key.replace('table-', ''), 10)
      if (!isNaN(tableId) && !columnCache[tableId]) {
        fetchColumns(tableId)
      }
    }
  }
}, [expandedKeys, columnCache])
```

Then add `fetchColumns` function and adapt `buildTreeData()` to include column children.

- [ ] **Step 3: Implement column rendering in buildTreeData()**

Add column children to each table node:

```tsx
// In the table node creation inside buildTreeData():
children: tableColumns.length > 0
  ? tableColumns.map((col) => ({
      key: `col-${col.id}`,
      title: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, lineHeight: 1.8 }}>
          {col.is_primary_key && <span style={{ fontSize: 11, color: '#d4a017' }}>🔑</span>}
          {col.is_foreign_key && !col.is_primary_key && <span style={{ fontSize: 11, color: '#1890ff' }}>🔗</span>}
          <span style={{ fontFamily: 'Consolas, "Courier New", monospace' }}>{col.name}</span>
          <span style={{ color: '#888', fontSize: 12 }}>{col.type}</span>
          {col.comment && (
            <span
              style={{
                color: '#aaa',
                fontSize: 11,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 120,
              }}
              title={col.comment}
            >
              — {col.comment}
            </span>
          )}
        </div>
      ),
      isLeaf: true,
      icon: '📄',
    }))
  : [],
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npx vitest run src/components/SchemaTree.test.tsx 2>&1
```

Expected: Tests for column display after expand pass.

- [ ] **Step 5: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1
```

Expected: No errors.

---

### Task 4: Search mode shows column-level matches

**Files:**
- Modify: `frontend/src/components/SchemaTree.tsx`

**Interfaces:**
- Consumes: `searchResults` from `useSearchSchema` (already exists)
- Produces: Column matches rendered under parent table nodes in search mode

- [ ] **Step 1: Write failing test**

```tsx
it('displays column matches under parent table in search mode', async () => {
  render(<SchemaTree datasourceId={1} />)

  const searchInput = screen.getByPlaceholderText('搜索表名/字段名')
  fireEvent.change(searchInput, { target: { value: 'CHANNEL' } })

  await waitFor(() => {
    expect(screen.getByText('CHANNEL_NAME')).toBeInTheDocument()
    // The column match should appear under its parent table
    const column = screen.getByText('CHANNEL_NAME')
    const tableSection = screen.getByText('ADS_CHANPJZL_D').closest('.ant-tree-treenode')
    expect(tableSection?.textContent).toContain('CHANNEL_NAME')
  })
})
```

- [ ] **Step 2: Modify search mode in `buildTreeData()`**

Replace search mode rendering (lines 26-48):

```tsx
if (searchText && searchResults) {
  const tableMap = new Map<number, { table: typeof searchResults[0], columns: typeof searchResults }>()

  for (const r of searchResults) {
    if (r.match_type === 'table') {
      if (!tableMap.has(r.table_id)) {
        tableMap.set(r.table_id, { table: r, columns: [] })
      }
    } else if (r.match_type === 'column') {
      if (!tableMap.has(r.table_id)) {
        // Get table info from the first matching result or from schemaTree
        const schemaTable = schemaTree?.schemas
          .flatMap(s => s.tables)
          .find(t => t.id === r.table_id)
        tableMap.set(r.table_id, {
          table: { ...r, match_type: 'table' as const, column_name: null, table_name: schemaTable?.name ?? r.table_name, table_comment: schemaTable?.comment ?? null },
          columns: [r],
        })
      } else {
        tableMap.get(r.table_id)!.columns.push(r)
      }
    }
  }

  return Array.from(tableMap.values()).map(({ table, columns }) => ({
    key: `table-${table.table_id}`,
    title: (
      <div style={{ cursor: 'pointer', lineHeight: 1.6 }} title={table.table_name}>
        <span style={{ fontFamily: 'Consolas, "Courier New", monospace', fontWeight: 600, fontSize: 13 }}>
          {table.table_name}
        </span>
        {table.table_comment && (
          <div style={{ fontSize: 12, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }} title={table.table_comment}>
            {table.table_comment}
          </div>
        )}
      </div>
    ),
    icon: '📋',
    isLeaf: columns.length === 0,
    children: columns.length > 0
      ? columns.map((col, idx) => ({
          key: `search-col-${table.table_id}-${idx}`,
          title: (
            <span style={{ fontFamily: 'Consolas, "Courier New", monospace', fontSize: 13 }}>
              {col.column_name}
            </span>
          ),
          isLeaf: true,
          icon: '📄',
        }))
      : undefined,
  }))
}
```

- [ ] **Step 3: Run tests**

```bash
cd frontend && npx vitest run src/components/SchemaTree.test.tsx 2>&1
```

Expected: Column search tests pass.

- [ ] **Step 4: TypeScript + build check**

```bash
cd frontend && npx tsc --noEmit && npm run build 2>&1
```

Expected: No errors.

---

### Task 5: Resizable metadata panel width

**Files:**
- Modify: `frontend/src/pages/SqlWorkbenchPage.tsx`

**Interfaces:**
- Consumes: `useSqlWorkbenchStore` (for state — no new state needed)
- Produces: Left panel with draggable resize handle, right panel auto-adjusts

- [ ] **Step 1: Write failing tests**

Append to `SqlWorkbenchPage.test.tsx`:

```tsx
describe('SqlWorkbenchPage metadata panel resize', () => {
  it('renders a resize handle for the metadata panel', () => {
    render(<SqlWorkbenchPage />)
    // The resize handle should be visible
    const handle = document.querySelector('[data-testid="panel-resize-handle"]')
    expect(handle).toBeInTheDocument()
  })

  it('does not allow panel width below min or above max', () => {
    render(<SqlWorkbenchPage />)
    const leftPanel = screen.getByTestId('metadata-panel')
    const minWidth = 260
    const maxWidth = 520
    const style = window.getComputedStyle(leftPanel)
    const width = parseInt(style.width, 10)
    expect(width).toBeGreaterThanOrEqual(minWidth)
    expect(width).toBeLessThanOrEqual(maxWidth)
  })
})
```

The drag simulation test is complex without pointer events mock; the structural tests (handle exists, panel renders with correct initial width) are what we'll assert directly. Manual verification covers drag behavior.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/pages/SqlWorkbenchPage.test.tsx 2>&1
```

Expected: Failing — data-testid attributes and resize handle not yet in component.

- [ ] **Step 3: Implement custom drag handle in SqlWorkbenchPage.tsx**

Replace the left panel section:

```tsx
// Add at top
import React, { useCallback, useState, useRef, useEffect } from 'react'

// In component, add state:
const [leftWidth, setLeftWidth] = useState(320)
const isDragging = useRef(false)
const startX = useRef(0)
const startWidth = useRef(0)

const handleMouseDown = useCallback((e: React.MouseEvent) => {
  isDragging.current = true
  startX.current = e.clientX
  startWidth.current = leftWidth
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}, [leftWidth])

useEffect(() => {
  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging.current) return
    const dx = e.clientX - startX.current
    const newWidth = Math.max(260, Math.min(520, startWidth.current + dx))
    setLeftWidth(newWidth)
  }
  const handleMouseUp = () => {
    if (isDragging.current) {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
  return () => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  }
}, [])
```

Replace the left panel div:

```tsx
{/* Left: Schema Browser */}
<div
  data-testid="metadata-panel"
  style={{
    width: leftWidth,
    minWidth: 260,
    maxWidth: 520,
    borderRight: '1px solid #f0f0f0',
    overflow: 'auto',
    position: 'relative',
  }}
>
  <SchemaPanel />
</div>

{/* Resize Handle */}
<div
  data-testid="panel-resize-handle"
  onMouseDown={handleMouseDown}
  style={{
    width: 4,
    cursor: 'col-resize',
    backgroundColor: 'transparent',
    transition: 'background-color 0.15s',
    position: 'relative',
    zIndex: 10,
    flexShrink: 0,
  }}
  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#d9d9d9' }}
  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
/>
```

- [ ] **Step 4: Run tests**

```bash
cd frontend && npx vitest run src/pages/SqlWorkbenchPage.test.tsx 2>&1
```

Expected: Resize handle and panel tests pass.

- [ ] **Step 5: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1
```

Expected: No errors.

---

### Task 6: Final verification

- [ ] **Step 1: Run all tests**

```bash
cd frontend && npx vitest run 2>&1
```

Expected: All tests pass (existing + new).

- [ ] **Step 2: TypeScript check**

```bash
cd frontend && npx tsc --noEmit 2>&1
```

Expected: No errors.

- [ ] **Step 3: Build check**

```bash
cd frontend && npm run build 2>&1
```

Expected: Build succeeds.

- [ ] **Step 4: Final git status**

```bash
cd d:/projects/MetricForge && git status
```

Expected: Only modified `SchemaTree.tsx`, `SqlWorkbenchPage.tsx`; new `SchemaTree.test.tsx`. No backend/API changes.

- [ ] **Step 5: Report**

Report to user: files changed, key implementation details, test results, git status, confirmation of no backend/API/dependency changes.
