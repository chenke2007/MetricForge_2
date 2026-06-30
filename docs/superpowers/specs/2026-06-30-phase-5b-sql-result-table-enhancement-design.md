# Phase 5B：SQL Workbench 结果表格增强 MVP — 设计文档

> **Phase 5B** of MetricForge Development Plan
>
> **前置依赖：** Phase 3（SQL 开发工作台 MVP）、Phase 4（AI SQL 联动）、Phase 4.5（AI SQL 回归测试）、Phase 5A（治理工作台 MVP）已全部合并到 main。
>
> **目标：** 在不破坏 Phase 5A 治理闭环、不新增后端 API 的前提下，增强 SQL Workbench 的结果表格体验，提供虚拟滚动、列排序、自适应列宽和 CSV 导出能力。

---

## 1. 背景与 Why Now

### 1.1 当前状态

SQL Workbench（Phase 3 MVP）已完成基本查询能力闭环：选择数据源 → 浏览 Schema → 编写 SQL → 执行 → 结果预览。当前结果表格（`ResultTable.tsx`）使用 Ant Design Table 基础渲染：

- 列宽固定 `150px`
- 无虚拟滚动（大数据量下 DOM 节点膨胀）
- 无列排序
- 无 CSV 导出/复制功能
- `ResultToolbar.tsx` 仅展示行数、耗时、截断标记

### 1.2 用户痛点

| 场景 | 当前体验 | 期望 |
|------|---------|------|
| 查询返回 800 行 | 800 个 `<tr>` 全部渲染，DOM 重，页面卡顿 | 仅渲染可视区域行（虚拟滚动），滚动流畅 |
| 想按某列排序 | 只能看原始返回顺序 | 点击列头排序（升序/降序） |
| 列太宽/太窄 | 所有列 150px，长的截断，短的空旷 | 列宽根据内容自适应 |
| 想下载结果 | 不能，需要手动复制 | 一键导出 CSV / 复制到剪贴板 |
| 想快速查看数据分布 | 无 | 列排序辅助发现分布 |

### 1.3 为什么先于图表（Phase 5C）和报表草稿（Phase 5D）

| 维度 | Phase 5B：表格增强 | Phase 5C：图表探索 | Phase 5D：报表草稿 |
|------|-------------------|-------------------|-------------------|
| 后端影响 | **0** | 0（纯前端） | 需新模型 + API |
| 依赖风险 | 无新依赖 | 需引入 ECharts（+~300KB） | 需评估数据模型 |
| 交付确定性 | 极高 | 中 | 中低 |
| 日活覆盖率 | 100%（每次查询） | 部分查询需要 | 部分用户需要 |

表格增强是每个 SQL 执行后都会触及的体验，风险最低、确定性最高，适合优先交付。

---

## 2. Phase 5B MVP 目标

### 2.1 核心目标

在不修改后端、不新增依赖、不引入新表格库的前提下，使 SQL Workbench 结果表格达到正常可用水平：

1. **虚拟滚动** — 支持大结果集流畅滚动
2. **列头排序** — 点击列头切换升序/降序/取消
3. **合理列宽策略** — 列宽自适应内容，不再固定 150px
4. **CSV 导出/复制** — 下载 `.csv` 文件和复制到剪贴板

### 2.2 成功标准

- [ ] 1000 行结果集的初始渲染不卡顿（仅渲染可视区域）
- [ ] 列头点击可排序，再次点击切换排序方向
- [ ] 列宽根据表头文字和内容合理分配
- [ ] 「导出 CSV」按钮可下载当前结果集为 `.csv` 文件
- [ ] 「复制 CSV」按钮将当前结果集以 CSV 格式复制到剪贴板
- [ ] CSV 内容与 SQL 执行返回结果一致（不导出未加载的数据）
- [ ] 所有功能仅前端实现，零后端 API 变更
- [ ] 所有前端测试通过
- [ ] `npm run build` 通过

---

## 3. 目标用户

| 用户角色 | 使用场景 | 价值点 |
|---------|---------|--------|
| **数据分析师** | 执行 SQL 后浏览数据、发现趋势 | 虚拟滚动浏览大结果集，排序发现极值 |
| **业务人员（AI 问数）** | AI 生成 SQL 后查看结果 | 导出 CSV 做进一步分析 |
| **开发者** | 排查数据问题 | 快速排序验证假设，导出做对比 |
| **治理/数据管理员** | 验证字段语义治理效果 | 导出语义字段数据做统计 |

---

## 4. 用户流程

```
┌─ SQL Workbench 现有流程 ──────────────────────────────────────┐
│                                                                │
│  用户编写/回填 SQL → 点击执行                                   │
│       ↓                                                        │
│  ResultPanel 显示（ResultToolbar + ResultTable）                 │
│       ↓                                                        │
│  Phase 5B 新增交互：                                             │
│  ├─ 直接操作表头：                                              │
│  │   ├─ 点击列头 → 升序排序（▲ 图标）                           │
│  │   ├─ 再次点击 → 降序排序（▼ 图标）                           │
│  │   └─ 再次点击 → 取消排序                                     │
│  │                                                              │
│  ├─ 表格滚动：                                                  │
│  │   └─ 滚轮/拖拽滚动条浏览所有行（仅渲染可视区域）               │
│  │                                                              │
│  └─ 工具栏操作：                                                │
│      ├─ 点击「导出 CSV」→ 浏览器下载 .csv 文件                  │
│      └─ 点击「复制 CSV」→ 剪贴板写入 CSV 文本 + 提示成功         │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**不改变的工作流：** Phase 3 定义的 SQL 编辑、执行、历史/草稿管理、AI 联动等保持不变。

---

## 5. ResultTable 设计

### 5.1 现有代码分析

当前 `ResultTable.tsx`（约 60 行）：

```typescript
const columns: ColumnsType<any> = result.columns.map((col) => ({
  title: col,
  dataIndex: col,
  key: col,
  ellipsis: true,
  width: 150,                          // ← 固定宽度
  render: (val: any) => (val === null
    ? <span style={{ color: '#ccc' }}>NULL</span>
    : String(val)),
}))

return (
  <Table
    dataSource={dataSource}
    columns={columns}
    rowKey="_key"
    size="small"
    pagination={false}                  // ← 不分页
    scroll={{ x: 'max-content', y: 400 }}  // ← 横向滚动，纵向固定高度
    bordered
  />
)
```

### 5.2 虚拟滚动方案

**技术决策：** 使用 Ant Design Table 内置 `virtual` prop。

当前 antd 版本为 `^5.20.0`，`virtual` prop 在此版本作为实验性特性可用（需同时设置 `scroll.y > 0` 和 `pagination={false}`，当前已有这些条件）。

```typescript
<Table
  virtual
  scroll={{ x: 'max-content', y: 400 }}
  pagination={false}
  // ...其他 props
/>
```

**降级策略：** 如果后续 antd 版本移除或破坏 `virtual` 实验性特性，退化为当前无虚拟滚动状态（`pagination=false` + `scroll.y` 固定高度），并增加 `maxHeight` 样式和 CSS `overflow: auto` 保护。**不引入任何新虚拟滚动库**（如 `react-virtualized`、`@tanstack/react-virtual`）。

**已知限制（需在 spec 中声明）：**
- antd `virtual` 为实验性特性，文档未标注 `stable`
- 不支持 `rowSelection`（本阶段未使用）
- 不支持展开行（本阶段未使用）
- 不支持表头分组（本阶段未使用）
- 动态行高场景不可靠（本阶段 `String(val)` 渲染，行高基本一致）

### 5.3 列排序

使用 Ant Design Table 内置 `sorter` 机制：

```typescript
const columns: ColumnsType<any> = result.columns.map((col) => ({
  title: col,
  dataIndex: col,
  key: col,
  sorter: (a: any, b: any) => {
    const va = a[col]
    const vb = b[col]
    // 尝试数值比较，否则字符串比较
    if (typeof va === 'number' && typeof vb === 'number') return va - vb
    if (va === null && vb === null) return 0
    if (va === null) return -1
    if (vb === null) return 1
    return String(va).localeCompare(String(vb))
  },
  showSorterTooltip: false,  // 不显示排序提示
  // ...
}))
```

**排序行为：** Ant Design Table 默认三态排序（`null → ascend → descend → null`），每个列独立排序。当点击新列时，取消前一列的排序（**单列排序**，不启用 `multiple`）。

**NULL 值排序规则：**
- `ascend`：NULL 排在最前
- `descend`：NULL 排在最后

### 5.4 列宽策略

放弃固定 `width: 150`，改为按内容自适应：

```typescript
const COLUMN_MIN_WIDTH = 80
const COLUMN_MAX_WIDTH = 400

function estimateColumnWidth(
  columnName: string,
  sampleValues: any[],
  headerLabel: string
): number {
  // 1. 计算表头文字宽度（每个中文字符约 16px，英文字符约 8px）
  const headerWidth = calculateTextWidth(headerLabel)
  // 2. 计算前 100 行样本值最大宽度
  const sampleMaxWidth = sampleValues.reduce((max, val) => {
    if (val === null) return max
    const text = String(val)
    const width = calculateTextWidth(text)
    return Math.max(max, width)
  }, 0)
  // 3. 取最大值，加上列 padding（约 16px，左右各 8px）
  const estimated = Math.max(headerWidth, sampleMaxWidth) + 24
  // 4. 限制在 min/max 范围内
  return Math.max(COLUMN_MIN_WIDTH, Math.min(COLUMN_MAX_WIDTH, estimated))
}
```

**对齐规则：** 纯数字列（字段名或第一行值可解析为 number）右对齐，其他列左对齐。

**列宽计算时机：** 在 `ResultTable` 组件中，从 `result.rows` 取前最多 100 行样本计算。

### 5.5 NULL 值渲染

保持现有渲染风格不变：

```typescript
render: (val: any) => val === null
  ? <span style={{ color: '#ccc' }}>NULL</span>
  : String(val)
```

### 5.6 ResultTable 完整设计

```typescript
interface ColumnConfig {
  key: string
  title: string
  dataIndex: string
  width: number
  sorter: (a: any, b: any) => number
  align?: 'left' | 'right'
  render: (val: any) => React.ReactNode
}
```

**组件 Props：** 无变化——`ResultTable` 从 store 读取 `result`，不接收外部 props。

**组件状态变更：**

| 状态 | 现有行为 | Phase 5B 行为 |
|------|---------|--------------|
| `!resultVisible` | 返回 null | 不变 |
| `result.error` | Alert 错误提示 | 不变 |
| `result.columns.length === 0` | Empty 空状态 | 不变 |
| 正常渲染 | 固定 150px 列宽，无排序，无虚拟滚动 | 自适应列宽，列排序，虚拟滚动 |

---

## 6. ResultToolbar 设计

### 6.1 现有状态

当前 `ResultToolbar.tsx` 在结果成功时展示三个 Tag：

```
[42 行] [325ms]
```

错误时展示红色错误 Tag。

### 6.2 Phase 5B 新增

在成功状态的行标签区域右侧新增操作按钮：

```
[42 行] [325ms] [已截断(最大1000行)]    [📋 复制 CSV] [⬇ 导出 CSV]
```

#### 按钮定义

| 按钮 | Icon | 文案 | 功能 |
|------|------|------|------|
| 复制 CSV | `CopyOutlined` | 「复制 CSV」 | 将结果集转换为 CSV 文本 → 写入 `navigator.clipboard` → `message.success('已复制')` |
| 导出 CSV | `DownloadOutlined` | 「导出 CSV」 | 将结果集转换为 CSV 文本 → 创建 Blob → 触发 `<a>` 下载 → 文件名 `sql_result_YYYYMMDD_HHmmss.csv` |

**错误状态：** 不显示操作按钮（保持现有错误 Tag）。

**空结果（row_count === 0）：** 操作按钮 disabled，tooltip「无数据可导出」。

**执行中：** 操作按钮 disabled（结果区域不可见，实际不会渲染）。

### 6.3 CSV 格式规范

```
列名1,列名2,列名3
值A1,值A2,值A3
值B1,值B2,值B3
```

- **编码：** UTF-8 with BOM（`﻿`），确保 Excel 正确打开中文
- **分隔符：** 逗号 `,`
- **引用：** 包含逗号、换行符、双引号的值用双引号包裹，值内的双引号转义为 `""`
- **NULL 值：** 输出空单元格（不输出 "NULL" 字符串）
- **行尾：** `\r\n`（CRLF，Excel 兼容）
- **行数限制：** 仅导出当前结果集（最多 1000 行），不翻页加载

---

## 7. 数据流与状态

### 7.1 数据流（无变更）

```
SQL 执行完成
  → ExecuteResult { columns, rows, row_count, truncated, elapsed_ms }
  → useSqlWorkbenchStore.setResult(result)
  → ResultPanel 渲染
    → ResultToolbar 读取 result（行数/耗时/截断状态）
    → ResultTable 读取 result.columns + result.rows 渲染表格
```

Phase 5B 不改变数据流，仅改变 `ResultTable` 和 `ResultToolbar` 的渲染输出。

### 7.2 状态矩阵（更新后）

**ResultTable：**

| 状态 | 当前行为 | Phase 5B 行为 |
|------|---------|--------------|
| resultVisible=false | 不渲染 | 不变 |
| result.error 存在 | Alert 错误 | 不变 |
| columns.length === 0 | Empty「查询结果为空」 | 不变 |
| column 计算列宽 | width=150 固定 | 自适应（前 100 行采样） |
| 列排序 | 无 | 点击列头排序▲▼ |
| 虚拟滚动 | 无 | virtual=true + scroll.y=400 |
| 数字列对齐 | 左对齐 | 右对齐 |
| NULL 渲染 | `<span color=#ccc>NULL</span>` | 不变 |

**ResultToolbar：**

| 状态 | 当前行为 | Phase 5B 行为 |
|------|---------|--------------|
| result=null | 不渲染 | 不变 |
| result.error | 红色 Tag | 不变（不显示操作按钮） |
| 成功+有数据 | 行数/耗时 Tag | 行数/耗时/截断 Tag + 复制/导出按钮（row_count>0） |
| 成功+0 行 | 行数 Tag（0 行） | 行数 Tag + disabled 操作按钮 |
| 截断 | 黄色警告 Tag | 不变 |
| 复制成功 | — | `message.success('已复制到剪贴板')` |
| 复制失败（剪贴板不可用） | — | `message.warning('当前浏览器不支持复制，请使用导出CSV')` |

---

## 8. 性能边界

| 指标 | 目标 | 策略 |
|------|------|------|
| 初始渲染（1000 行 x 30 列） | < 500ms | `virtual` prop 仅渲染可视区域行 |
| 排序（1000 行） | < 100ms | 全量内存排序（数据量小） |
| 列宽计算（前 100 行采样） | 单次计算 < 10ms | 限制采样行数 |
| CSV 导出（1000 行 x 30 列） | 生成 < 200ms | 同步字符串拼接 |
| 虚拟滚动滚动帧率 | > 30fps | antd Table virtual 使用 Ant Design / rc-virtual-list 内置虚拟滚动能力。 |
| 超出限制行为 | 受控降级 | 如果 `virtual` prop 在当前 antd 版本不工作，退化为 scroll + 固定高度 + CSS overflow |

**内存约束：**
- 原始 `rows` 数据保留在 store（约 1000 x 30 单元格，约 1-3MB 字符串）
- 虚拟滚动不增加额外内存开销（antd `virtual` 内部管理可视区域切片）

---

## 9. CSV 导出/复制设计

### 9.1 核心函数

```typescript
function rowsToCsv(columns: string[], rows: any[][]): string {
  const BOM = '﻿'
  const separator = ','
  const lines: string[] = []

  // Header
  lines.push(columns.map(escapeCsvField).join(separator))

  // Rows
  for (const row of rows) {
    const fields = row.map((val) => escapeCsvField(val === null ? '' : String(val)))
    lines.push(fields.join(separator))
  }

  return BOM + lines.join('\r\n')
}

function escapeCsvField(value: string): string {
  if (value === '') return ''
  // 如果包含逗号、双引号、换行符，需要包裹双引号并转义内部双引号
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
```

### 9.2 导出 CSV（文件下载）

```typescript
function downloadCsv(csvContent: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `sql_result_${formatTimestamp()}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function formatTimestamp(): string {
  const now = new Date()
  const y = now.getFullYear()
  const M = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `${y}${M}${d}_${h}${m}${s}`
}
```

### 9.3 复制 CSV（剪贴板）

```typescript
async function copyCsv(csvContent: string): Promise<boolean> {
  try {
    // clipboard API 需要 HTTPS 或 localhost
    await navigator.clipboard.writeText(csvContent)
    return true
  } catch {
    // 降级：使用 document.execCommand('copy')
    //（部分浏览器在非 HTTPS 下 clipboard API 不可用）
    const textarea = document.createElement('textarea')
    textarea.value = csvContent
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy')
      return true
    } catch {
      return false
    } finally {
      document.body.removeChild(textarea)
    }
  }
}
```

### 9.4 安全和隐私考虑

- CSV 导出基于已有 `result.rows` 和 `result.columns`，不发起新的后端请求
- 不导出未加载的行（最多 1000 行）
- 不涉及用户身份信息暴露风险（数据已在前端）
- 使用 `URL.createObjectURL` + 临时 `<a>` 元素，不暴露文件路径

---

## 10. 错误与边界状态

### 10.1 Spec 覆盖状态表

| 场景 | 预期行为 |
|------|---------|
| 结果集为空（0 行） | Empty 空状态，操作按钮 disabled |
| 结果集为单行 | 正常渲染，CSV 导出 1 行数据 |
| 结果集为多行 | 虚拟滚动渲染，排序生效 |
| 结果集为单列 | 正常渲染，列宽自适应 |
| 结果集为超多列（>50） | 横向滚动，列宽最小 80px |
| 某列全为 NULL | 列宽根据表头计算，全部渲染灰色 NULL |
| 某列含特殊字符（逗号/引号/换行） | CSV 导出正确处理转义 |
| 剪贴板不可用（非 HTTPS） | 降级使用 `execCommand('copy')`，失败时提示 |
| 浏览器不支持 clipboard API + execCommand | 提示「复制失败，请使用导出 CSV」 |
| antd virtual prop 不工作 | 退化为 scroll + fixed height + overflow |
| 排序后重算列宽 | 排序不触发行数变化，列宽保留原始计算值 |
| 多次执行查询 | 结果替换，列宽重新计算，排序状态重置 |

### 10.2 导出能力自限

- 仅导出前端已持有的结果集（`result.rows`）
- 不实现「导出全部」——后续如需导出全部结果，需要后端支持流式导出，属于 Phase 5C 或更高阶段

---

## 11. 测试策略

### 11.1 CSV 工具函数测试

```typescript
// 文件：frontend/src/utils/csv.test.ts（新增）
describe('rowsToCsv', () => {
  it('produces UTF-8 BOM header', () => { /* ... */ })
  it('escapes fields containing commas', () => { /* ... */ })
  it('escapes fields containing double quotes', () => { /* ... */ })
  it('escapes fields containing newlines', () => { /* ... */ })
  it('outputs NULL as empty cell', () => { /* ... */ })
  it('outputs empty string as empty cell', () => { /* ... */ })
  it('handles empty rows array', () => { /* ... */ })
  it('uses CRLF line endings', () => { /* ... */ })
})
```

### 11.2 ResultTable 测试

```typescript
// 文件：frontend/src/components/ResultTable.test.tsx（新增）
describe('ResultTable', () => {
  it('renders column headers from result.columns', () => { /* ... */ })
  it('sorts rows ascending when column header clicked once', () => { /* ... */ })
  it('sorts rows descending when column header clicked twice', () => { /* ... */ })
  it('removes sort when column header clicked thrice', () => { /* ... */ })
  it('computes column width from sample rows', () => { /* ... */ })
  it('renders NULL values in gray', () => { /* ... */ })
  it('right-aligns numeric columns', () => { /* ... */ })
})
```

### 11.3 ResultToolbar 测试

```typescript
// 文件：frontend/src/components/ResultToolbar.test.tsx（新增或补充）
describe('ResultToolbar', () => {
  it('shows disabled export buttons when row_count is 0', () => { /* ... */ })
  it('shows active export buttons when rows exist', () => { /* ... */ })
  it('calls csv download on export button click', () => { /* ... */ })
  it('calls clipboard copy on copy button click', () => { /* ... */ })
})
```

### 11.4 测试策略总览

| 层 | 工具 | 覆盖范围 |
|----|------|---------|
| CSV 工具函数 | Vitest | 纯函数测试：转义、BOM、空值、边界 |
| ResultTable | Vitest + RTL | 排序交互、列宽计算、NULL 渲染 |
| ResultToolbar | Vitest + RTL | 按钮状态、点击事件、消息提示 |
| TypeScript 编译 | `tsc --noEmit` | 无类型错误 |
| Build | `npm run build` | 无构建错误 |

---

## 12. 明确排除项

| 排除项 | 理由 |
|--------|------|
| 拖拽调整列宽 | 需额外实现或引入依赖，不入 MVP |
| 全屏模式 | 非核心能力，可以后续 UI 优化阶段加 |
| 列显示/隐藏菜单 | 非核心能力 |
| ECharts 图表 | 属于 Phase 5C |
| 图表推荐 | 属于 Phase 5C |
| 报表草稿保存 | 属于 Phase 5D 或更后续阶段 |
| 后端 API 变更 | 0 后端变更 |
| 数据库 migration | 0 schema 变更 |
| E2E 测试框架 | 保持现有测试栈 |
| 引入新大型表格库 | 仅使用 antd 内置 virtual，不引入 react-virtualized 等 |
| 导出全部结果（超出 1000 行） | 需后端支持流式导出，非本阶段范围 |
| 后端流式 CSV 导出 | 同上一项 |
| 列固定（left/right pin） | antd virtual + fixed column 兼容性未知 |
| 行号/序号列 | 非核心需求 |
| 列过滤/搜索 | 属高级功能，后续优化 |
| 行选中/批量操作 | 非本阶段范围 |
| 单元格编辑 | Phase 5B 不涉及结果修改 |

---

## 13. 文件变更清单

### 13.1 新增文件

| 文件 | 说明 |
|------|------|
| `frontend/src/utils/csv.ts` | CSV 工具函数（rowsToCsv, escapeCsvField, downloadCsv, copyCsv） |
| `frontend/src/utils/csv.test.ts` | CSV 工具函数测试 |

### 13.2 修改文件

| 文件 | 变更 |
|------|------|
| `frontend/src/components/ResultTable.tsx` | 添加 virtual prop、列排序、自适应列宽、数字列右对齐 |
| `frontend/src/components/ResultToolbar.tsx` | 添加「复制 CSV」「导出 CSV」按钮 |

### 13.3 统计

- **新增文件：** 2（1 个工具模块 + 1 个测试文件）
- **修改文件：** 2（ResultTable.tsx + ResultToolbar.tsx）
- **后端变更：** 0
- **数据库：** 0
- **新增依赖：** 0（重度依赖 antd `virtual` prop，已在 `^5.20.0` 中）

---

## 14. 后续路线记录 — Phase 5C & 5D

以下为 Phase 5B 之后的候选阶段，不在 Phase 5B 实现：

### Phase 5C：图表探索（候选）

**目标：** 在 SQL Workbench 中增加 ECharts 图表预览，基于 SQL 结果字段类型自动推荐可视化图表。

**候选能力：**
- 结果区增加「图表」Tab，与现有「表格」Tab 切换
- 基于字段类型和行数推荐柱状图、折线图、饼图
- 手动选择 X/Y 轴字段
- 图表配置持久化（会话级或草稿级）
- 图表截图/导出（PNG）

**前置条件：**
- Phase 5B 表格增强已完成（列排序帮助用户理解数据分布，决定是否可视化）

### Phase 5D 或后续：报表草稿（候选）

**目标：** 将 SQL 查询配置 + 图表配置持久化为「报表草稿」，为后续报表/仪表板功能做准备。

**候选能力：**
- 新建报表草稿（选择已有 SQL 草稿 + 图表配置）
- 报表草稿列表/预览
- 报表草稿编辑
- 报表草稿 → 发布为正式报表

**前置条件：**
- Phase 5B 表格增强已完成
- Phase 5C 图表探索已完成（报表草稿包含图表配置才有意义）
- 需评估后端数据模型和 API 新增

---

## 15. 安全约束

| 维度 | 措施 |
|------|------|
| SQL 结果数据 | CSV 导出仅基于前端 store 中已有数据，不新增后端查询 |
| 剪贴板操作 | 仅读取 `navigator.clipboard.writeText`（单向写入），不读取剪贴板内容 |
| 文件下载 | 使用 `URL.createObjectURL` + 临时 `<a>`，不涉及本地文件路径 |
| 无新增 API | 0 新增后端端点 |
| 无新增依赖 | 0 新增 npm/pip 包 |

---

## 附：技术决策记录

### Ant Design virtual prop 兼容性

| 项目 | 值 |
|------|-----|
| 当前 antd 版本 | `^5.20.0` |
| virtual prop 状态 | 实验性（非 stable） |
| 必要条件 | `scroll.y > 0` + `pagination={false}`（当前满足） |
| 降级方案 | 移除 virtual prop，保持现有 scroll + fixed height + CSS overflow |

### 为什么不用其他虚拟滚动库（react-virtualized / @tanstack/react-virtual）

1. 引入新库增加约 30-50KB bundle 大小
2. antd `virtual` 已基于 `rc-virtual-list` 实现，无需额外封装
3. antd 内部虚拟列表（rc-virtual-list）在固定行高场景下性能足够
4. 保持零新依赖承诺
