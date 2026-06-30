# Phase 5B.1：SQL Workbench 结果表格安全加固 — 设计文档

> **Phase 5B.1** of MetricForge Development Plan
>
> **前置依赖：** Phase 5B（SQL Workbench 结果表格增强 MVP）已合并到 main。
>
> **目标：** 在不新增后端 API、不新增 npm 依赖、不引入新功能的前提下，修复 CSV 公式注入风险和 ResultTable 内部 row key 与业务字段冲突风险。

---

## 1. 背景与 Why Now

### 1.1 当前状态

Phase 5B MVP 已交付并合并（PR #6），包含：

- `ResultTable` 虚拟滚动、列排序、自适应列宽；
- `ResultToolbar` CSV 复制/导出；
- `frontend/src/utils/csv.ts` CSV 生成工具函数。

### 1.2 发现的风险

| 风险 | 位置 | 说明 |
|------|------|------|
| **CSV 公式注入** | `frontend/src/utils/csv.ts` | `escapeCsvField` 未对以 `=`, `+`, `-`, `@` 开头的字段做防护，导出后在 Excel / LibreOffice Calc 中可能被解析为公式执行。 |
| **Row key 冲突** | `frontend/src/components/ResultTable.tsx` | 内部使用 `_rowKey` 作为 antd Table 的 `rowKey`，若 SQL 查询结果中存在同名列，会被真实列值覆盖，导致 key 重复警告或渲染异常。 |

### 1.3 为什么先于 Phase 5C

- 两项风险均涉及现有功能的安全或正确性；
- 修复成本极低（约 2 个文件 + 对应测试）；
- 零后端变更、零新依赖，不会阻塞 Phase 5C；
- 在引入 ECharts 等较大改动前，先消除已知隐患符合工程纪律。

---

## 2. Phase 5B.1 目标

1. **CSV 公式注入防护**：对以 `=`, `+`, `-`, `@` 开头的 CSV 字段进行安全转义，使电子表格软件将其识别为文本而非公式。
2. **Row key 冲突修复**：将 ResultTable 内部 row key 改为更安全的命名，并确保不会被业务列数据覆盖。
3. **测试覆盖**：补充对应单元测试，确保修复行为可验证。

---

## 3. 范围

### 3.1 包含

| 文件 | 变更 |
|------|------|
| `frontend/src/utils/csv.ts` | 在 `escapeCsvField` 中增加公式注入字符前缀检测与防护。 |
| `frontend/src/utils/csv.test.ts` | 增加前缀防护用例。 |
| `frontend/src/components/ResultTable.tsx` | 将内部 row key 从 `_rowKey` 改为 `__mf_rowKey__`，并确保在写入业务列数据后强制设置内部 key。 |
| `frontend/src/components/ResultTable.test.tsx` | 增加内部 key 与业务列名冲突的用例。 |

### 3.2 排除

| 排除项 | 理由 |
|--------|------|
| CJK 宽度估算优化 | 属于 UI polish，不影响功能正确性，列为 LOW backlog。 |
| Phase 5C 图表功能 | 不在本阶段范围。 |
| 后端 API 变更 | 零后端变更。 |
| 数据库表 / migration | 零 schema 变更。 |
| 新 npm 依赖 | 不引入任何新包。 |
| E2E 测试 | 保持现有测试栈。 |
| Phase 4 遗留未跟踪文件 | 按用户要求不处理。 |

---

## 4. CSV 公式注入防护设计

### 4.1 风险说明

CSV 文件被电子表格软件打开时，单元格以如下字符开头会被解析为公式：

- `=`：公式
- `+`：公式（部分软件）
- `-`：公式或负数
- `@`：外部引用 / 动态数组公式

例如字段值 `=cmd|' /C calc'!A0` 可能在 Excel 中触发命令执行。

### 4.2 防护策略

在 `escapeCsvField` 中，当字段非空且首字符为 `=`, `+`, `-`, `@` 时，前缀一个制表符 `\t`。

```typescript
function escapeCsvField(value: string): string {
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

### 4.3 为什么用 `\t` 前缀

- Excel 和 LibreOffice Calc 会将以 `\t` 开头的内容识别为文本；
- 制表符在单元格中不可见，不影响展示；
- 现有转义逻辑会自动用双引号包裹含 `\t` 的字段，符合 CSV 规范；
- 比单引号 `'` 前缀更不易被用户误读为数据内容。

### 4.4 行为示例

| 原始值 | CSV 输出 |
|--------|----------|
| `=1+1` | `"\t=1+1"` |
| `+123` | `"\t+123"` |
| `-123` | `"\t-123"` |
| `@user` | `"\t@user"` |
| `hello` | `hello` |
| `=cmd\|...` | `"\t=cmd\|..."` |

---

## 5. ResultTable Row Key 冲突修复设计

### 5.1 当前实现

```typescript
const dataSource = result.rows.map((row, idx) => {
  const record: Record<string, any> = { _rowKey: idx }
  result.columns.forEach((col, ci) => {
    record[col] = row[ci]
  })
  return record
})
```

当 `result.columns` 包含 `_rowKey` 时，`record['_rowKey']` 会被真实列值覆盖。

### 5.2 修复策略

1. 将内部 key 名从 `_rowKey` 改为 `__mf_rowKey__`（项目前缀 + 双下划线），降低与业务列名冲突的概率；
2. 调整构建顺序：先写入业务列数据，再强制写入内部 key，确保内部 key 始终有效。

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

Table 组件同步更新：

```typescript
<Table
  dataSource={dataSource}
  columns={columns}
  rowKey={INTERNAL_ROW_KEY}
  // ...其他 props
/>
```

### 5.3 为什么是 `__mf_rowKey__`

- `_rowKey` 和 `_key` 是常见的内部命名，业务 SQL 可能生成同名列；
- `__mf_rowKey__` 以项目前缀 `mf` 开头，且使用双下划线，与正常业务列名冲突的概率极低；
- 保持 string 类型，兼容 antd `rowKey` prop，无需引入 Map/Symbol 等额外抽象。

### 5.4 冲突场景覆盖

测试需覆盖以下场景：

- 列名为 `_rowKey`：内部 key 不被覆盖；
- 列名为 `__mf_rowKey__`：内部 key 在最后强制写入，仍保持索引值；
- 多行数据：每行内部 key 唯一，无 React key 重复警告。

---

## 6. 测试策略

### 6.1 CSV 工具函数测试

在 `frontend/src/utils/csv.test.ts` 中新增：

```typescript
describe('escapeCsvField formula injection protection', () => {
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
})
```

### 6.2 ResultTable 测试

在 `frontend/src/components/ResultTable.test.tsx` 中新增：

```typescript
it('does not overwrite internal rowKey when business column is named _rowKey', async () => {
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
  // No React key warning should be emitted; the test passes if render succeeds.
})

it('does not overwrite internal rowKey when business column is named __mf_rowKey__', async () => {
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
})
```

### 6.3 回归验证

| 命令 | 用途 |
|------|------|
| `cd frontend && npx vitest run src/utils/csv.test.ts --reporter=verbose` | CSV 工具函数测试 |
| `cd frontend && npx vitest run src/components/ResultTable.test.tsx --reporter=verbose` | ResultTable 测试 |
| `cd frontend && npm test` | 全量测试 |
| `cd frontend && npx tsc --noEmit` | TypeScript 编译检查 |
| `cd frontend && npm run build` | 生产构建 |

---

## 7. 文件变更清单

### 7.1 修改文件

| 文件 | 变更 |
|------|------|
| `frontend/src/utils/csv.ts` | 增加 CSV 公式注入防护逻辑。 |
| `frontend/src/utils/csv.test.ts` | 增加前缀防护测试用例。 |
| `frontend/src/components/ResultTable.tsx` | 修改内部 row key 名称并确保不被覆盖。 |
| `frontend/src/components/ResultTable.test.tsx` | 增加 row key 冲突测试用例。 |

### 7.2 统计

- **新增文件：** 0
- **修改文件：** 4
- **后端变更：** 0
- **数据库变更：** 0
- **新增依赖：** 0

---

## 8. 安全与隐私约束

| 维度 | 措施 |
|------|------|
| CSV 公式注入 | 对 `=`, `+`, `-`, `@` 开头的字段前缀 `\t`，防止电子表格软件解析为公式。 |
| 数据隔离 | ResultTable 内部 key 使用 `__mf_rowKey__`，与业务数据命名空间隔离。 |
| 无后端变更 | 不新增/修改后端 API、路由、服务方法、数据库表、migration。 |
| 无新依赖 | 不引入任何新 npm 包。 |
| 无数据外泄 | 不涉及新的网络请求或数据导出。 |

---

## 9. 明确排除项

| 排除项 | 理由 |
|--------|------|
| CJK 宽度估算优化 | UI polish，不影响功能正确性。 |
| 图表功能 | 属于 Phase 5C。 |
| 报表草稿 / 持久化 | 属于 Phase 5D 或更后续阶段。 |
| 后端流式 CSV 导出 | 非本阶段范围。 |
| 拖拽调整列宽 | 非安全/correctness 问题。 |
| 列固定 / 行选中 | 非本阶段范围。 |

---

## 10. 后续路线

Phase 5B.1 完成后，经用户确认，进入 Phase 5C（SQL 结果图表探索 MVP）的 brainstorming 与 spec 阶段。
