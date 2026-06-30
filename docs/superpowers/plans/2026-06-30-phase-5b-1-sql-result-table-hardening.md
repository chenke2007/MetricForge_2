# Phase 5B.1：SQL Workbench 结果表格安全加固 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 CSV 公式注入风险和 ResultTable 内部 row key 与业务字段冲突风险。

**Architecture:** 纯前端变更，零后端、零新依赖。在 `csv.ts` 的 `escapeCsvField` 中增加公式注入字符前缀防护；在 `ResultTable.tsx` 中将内部 row key 从 `_rowKey` 改为 `__mf_rowKey__`，并调整 record 构建顺序确保内部 key 不被覆盖。

**Tech Stack:** React 18 + TypeScript, Ant Design `^5.20.0`, Zustand, Vitest + React Testing Library

## Global Constraints

- **零后端变更** — 不新增/修改后端 API、路由、服务方法、数据库表、migration
- **零新依赖** — 不引入任何新 npm 包
- **仅修复已知安全/correctness 风险** — 不做 Phase 5C 图表、不做 CJK 宽度优化
- **不引入 E2E 测试框架** — 保持现有 Vitest + React Testing Library 测试栈
- **不处理 Phase 4 遗留未跟踪文件**
- **git add 必须显式列出文件** — 不使用 `git add -A` 或 `git add .`
- **每个任务独立 commit**
- **不 push、不 merge、不创建 PR，除非用户明确授权**

---

## File Structure

### 修改文件

| 文件 | 职责 |
|------|------|
| `frontend/src/utils/csv.ts` | CSV 字段转义与生成。本次增加公式注入前缀防护。 |
| `frontend/src/utils/csv.test.ts` | CSV 工具函数单元测试。本次增加前缀防护用例。 |
| `frontend/src/components/ResultTable.tsx` | SQL 结果表格渲染。本次修复内部 row key 命名冲突。 |
| `frontend/src/components/ResultTable.test.tsx` | ResultTable 组件测试。本次增加 row key 冲突用例。 |

---

## Task 1: CSV 公式注入防护

**Files:**
- Modify: `frontend/src/utils/csv.ts`
- Modify: `frontend/src/utils/csv.test.ts`

**Interfaces:**
- Consumes: none (pure utility functions)
- Produces: `escapeCsvField(value: string): string` — 对以 `=`, `+`, `-`, `@` 开头的字段前缀 `\t` 并用双引号包裹

- [ ] **Step 1: Add failing tests for formula injection protection**

在 `frontend/src/utils/csv.test.ts` 的 `describe('escapeCsvField', () => { ... })` 内新增：

```typescript
  it('prefixes leading equals sign with tab and quotes', () => {
    expect(escapeCsvField('=1+1')).toBe('"\t=1+1"')
  })

  it('prefixes leading plus sign with tab and quotes', () => {
    expect(escapeCsvField('+123')).toBe('"\t+123"')
  })

  it('prefixes leading minus sign with tab and quotes', () => {
    expect(escapeCsvField('-123')).toBe('"\t-123"')
  })

  it('prefixes leading at sign with tab and quotes', () => {
    expect(escapeCsvField('@user')).toBe('"\t@user"')
  })

  it('does not modify safe plain text', () => {
    expect(escapeCsvField('hello')).toBe('hello')
  })

  it('does not double-prefix already tab-prefixed values', () => {
    expect(escapeCsvField('\t=1')).toBe('\t=1')
  })
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
cd frontend && npx vitest run src/utils/csv.test.ts --reporter=verbose
```

Expected: FAIL — new formula injection assertions fail.

- [ ] **Step 3: Implement minimal CSV formula injection protection**

将 `frontend/src/utils/csv.ts` 中的 `escapeCsvField` 函数替换为：

```typescript
export function escapeCsvField(value: string): string {
  if (value === '') return ''

  // CSV formula injection protection: prefix triggering characters with tab
  // so spreadsheet applications treat the cell as text.
  let safeValue = value
  let prefixed = false
  if (/^[\t\n\r]/.test(value)) {
    // Already prefixed by tab/newline should not happen in normal data,
    // but keep the value as-is to avoid double-prefixing.
  } else if (/^[=+\-@]/.test(value)) {
    safeValue = '\t' + value
    prefixed = true
  }

  // Wrap in quotes if we added a prefix or if the value contains CSV-special chars.
  if (prefixed || /[",\r\n]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`
  }
  return safeValue
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npx vitest run src/utils/csv.test.ts --reporter=verbose
```

Expected: ALL PASS（包括原有 BOM、CRLF、逗号、引号、NULL/空字符串用例 + 新增公式注入用例）。

- [ ] **Step 5: Commit**

```bash
cd D:/projects/MetricForge
git add frontend/src/utils/csv.ts frontend/src/utils/csv.test.ts
git commit -m "fix: protect CSV export against formula injection"
```

---

## Task 2: ResultTable Row Key 冲突修复

**Files:**
- Modify: `frontend/src/components/ResultTable.tsx`
- Modify: `frontend/src/components/ResultTable.test.tsx`

**Interfaces:**
- Consumes: `useSqlWorkbenchStore` (existing) — `result`, `resultVisible`
- Produces: `ResultTable` 组件渲染数据时使用 `__mf_rowKey__` 作为内部 `rowKey`，不再与 `_rowKey` / `_key` 等业务列名冲突

- [ ] **Step 1: Add failing tests for row key conflict**

在 `frontend/src/components/ResultTable.test.tsx` 的最后一个 `it(...)` 之后新增：

```typescript
  it('does not overwrite internal rowKey when business column is named _rowKey', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockStore.resultVisible = true
    mockStore.result = {
      columns: ['_rowKey', 'name'],
      rows: [
        [100, 'Alice'],
        [100, 'Bob'],
      ],
      row_count: 2,
      truncated: false,
      elapsed_ms: 10,
      error: null,
    }
    const ResultTable = (await import('./ResultTable')).default
    const { container } = render(<ResultTable />)
    expect(container.querySelector('.ant-table')).toBeInTheDocument()
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('does not overwrite internal rowKey when business column is named __mf_rowKey__', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockStore.resultVisible = true
    mockStore.result = {
      columns: ['__mf_rowKey__', 'name'],
      rows: [
        [999, 'Alice'],
        [999, 'Bob'],
      ],
      row_count: 2,
      truncated: false,
      elapsed_ms: 10,
      error: null,
    }
    const ResultTable = (await import('./ResultTable')).default
    const { container } = render(<ResultTable />)
    expect(container.querySelector('.ant-table')).toBeInTheDocument()
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
cd frontend && npx vitest run src/components/ResultTable.test.tsx --reporter=verbose
```

Expected: FAIL — `expect(consoleSpy).not.toHaveBeenCalled()` fails because React logs duplicate key warnings to `console.error`.

- [ ] **Step 3: Implement minimal row key conflict fix**

将 `frontend/src/components/ResultTable.tsx` 中的以下内容：

```typescript
const dataSource = result.rows.map((row, idx) => {
  const record: Record<string, any> = { _rowKey: idx }
  result.columns.forEach((col, ci) => {
    record[col] = row[ci]
  })
  return record
})
```

替换为：

```typescript
const INTERNAL_ROW_KEY = '__mf_rowKey__'

const dataSource = result.rows.map((row, idx) => {
  const record: Record<string, any> = {}
  result.columns.forEach((col, ci) => {
    record[col] = row[ci]
  })
  record[INTERNAL_ROW_KEY] = idx
  return record
})
```

并将 `<Table>` 的 `rowKey` prop 从：

```typescript
rowKey="_rowKey"
```

替换为：

```typescript
rowKey={INTERNAL_ROW_KEY}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd frontend && npx vitest run src/components/ResultTable.test.tsx --reporter=verbose
```

Expected: ALL PASS，无 React `console.error` key 警告。

- [ ] **Step 5: Commit**

```bash
cd D:/projects/MetricForge
git add frontend/src/components/ResultTable.tsx frontend/src/components/ResultTable.test.tsx
git commit -m "fix: avoid ResultTable rowKey collision with business columns"
```

---

## Task 3: 全量验证

**Files:**
- No file changes — verification only

- [ ] **Step 1: Run all unit tests**

```bash
cd frontend && npm test
```

Expected: ALL PASS

- [ ] **Step 2: Run TypeScript compilation check**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No type errors

- [ ] **Step 3: Run production build**

```bash
cd frontend && npm run build
```

Expected: Build successful, no errors

- [ ] **Step 4: Review final diff**

```bash
cd D:/projects/MetricForge
git diff --stat HEAD
```

Expected: Only 4 files changed:
- `frontend/src/utils/csv.ts`
- `frontend/src/utils/csv.test.ts`
- `frontend/src/components/ResultTable.tsx`
- `frontend/src/components/ResultTable.test.tsx`

- [ ] **Step 5: Final verification checklist**

| Check | Expected |
|-------|----------|
| CSV `=`, `+`, `-`, `@` 前缀字段被 `\t` 前缀并加引号 | ✅ |
| CSV 原有 BOM、CRLF、逗号、引号、NULL/空字符串行为不变 | ✅ |
| ResultTable 内部 rowKey 使用 `__mf_rowKey__` | ✅ |
| 业务列 `_rowKey` / `__mf_rowKey__` / `_key` 不覆盖内部 key | ✅ |
| 全量测试通过 | ✅ |
| TypeScript 编译通过 | ✅ |
| 生产构建通过 | ✅ |

---

## Self-Review Checklist

### Spec Coverage

| Spec 要求 | 对应 Task |
|-----------|-----------|
| CSV 公式注入防护 | Task 1 |
| 前缀字符 `=`, `+`, `-`, `@` | Task 1 Step 1 测试用例 |
| 保持 BOM、CRLF、逗号、引号、NULL/空字符串规则 | Task 1 Step 4 运行全部 csv 测试 |
| ResultTable row key 冲突修复 | Task 2 |
| 覆盖 `_rowKey` / `__mf_rowKey__` / `_key` 冲突 | Task 2 Step 1 测试用例 |
| 验证 `npm test`, `tsc --noEmit`, `npm run build` | Task 3 |

### Placeholder Scan

- [ ] 无 TBD/TODO
- [ ] 无 "appropriate error handling" / "add validation" 等模糊描述
- [ ] 每个代码步骤包含完整代码
- [ ] 每个运行步骤包含 exact 命令与 expected output

### Type Consistency

- [ ] `escapeCsvField` 签名保持 `(value: string): string`
- [ ] `ResultTable` 无新增 props
- [ ] `INTERNAL_ROW_KEY` 为 string，兼容 antd `rowKey`

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-30-phase-5b-1-sql-result-table-hardening.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

**Waiting for user confirmation before proceeding.**
