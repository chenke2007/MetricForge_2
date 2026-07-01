# Phase 5C：SQL Workbench 结果轻量图表预览 MVP — 设计文档

> **Phase 5C** of MetricForge Development Plan
>
> **前置依赖：** Phase 5B（SQL Workbench 结果表格增强 MVP）和 Phase 5B.1（安全加固）已合并到 main。
>
> **目标：** 在不新增后端 API、不新增数据库表、不引入 E2E 的前提下，为 SQL Workbench 结果区增加轻量图表预览能力，让用户可以基于当前 SQL 执行结果快速生成柱状图、折线图、饼图。

---

## 1. 背景与 Why Now

### 1.1 当前状态

SQL Workbench 已完成：

- SQL 编辑、执行、结果预览（Phase 3）
- AI 问数联动（Phase 4）
- 结果表格增强：虚拟滚动、列排序、自适应列宽、CSV 导出（Phase 5B）
- CSV 公式注入防护、row key 冲突修复（Phase 5B.1）

当前结果区只有「表格」一种展示形态。用户在分析数据分布、趋势、占比时，需要手动导出 CSV 再到 Excel 中制图，体验断裂。

### 1.2 用户痛点

| 场景 | 当前体验 | 期望 |
|------|---------|------|
| 查看销售趋势 | 只能看表格，难以快速感知时间序列走势 | 一键切换折线图 |
| 对比分类指标 | 数字列多，难以比较 | 选择 X/Y 字段生成柱状图 |
| 查看占比分布 | 需要手动计算或导出 | 选择维度+数值生成饼图 |
| AI 问数后查看结果 | 业务用户更习惯看图 | 直接切换图表 tab |

### 1.3 为什么先于报表草稿（Phase 5D）

| 维度 | Phase 5C：图表预览 | Phase 5D：报表草稿 |
|------|-------------------|-------------------|
| 后端影响 | **0** | 需新增模型 + API |
| 依赖风险 | 引入 ECharts（可控） | 数据模型设计风险 |
| 交付确定性 | 高 | 中 |
| 用户价值 | 立即提升 SQL 结果可读性 | 长期报表资产沉淀 |

图表预览是每次 SQL 执行后都可能触发的通用能力，适合作为 Phase 5D 的前置基础。

---

## 2. Phase 5C MVP 目标

1. **ResultPanel 增加「表格 / 图表」切换**：默认显示表格，不破坏现有 ResultTable/ResultToolbar。
2. **ChartPreview 组件**：支持 bar/line/pie 三种图表类型，用户手动选择 X/Y 字段。
3. **前端数据转换**：基于 `ExecuteResult.columns + rows` 生成 ECharts option，不请求后端。
4. **边界状态处理**：空结果、NULL、非数值 Y 字段、数值字段不足时给出明确提示。
5. **性能保护**：限制图表最大处理数据量，避免大结果集卡顿。

---

## 3. 目标用户

| 用户角色 | 使用场景 | 价值点 |
|---------|---------|--------|
| **数据分析师** | 执行 SQL 后快速查看趋势/分布 | 无需导出即可制图 |
| **业务人员（AI 问数）** | AI 生成 SQL 后查看结果 | 图表比表格更直观 |
| **开发者** | 排查数据问题 | 快速验证数据模式 |

---

## 4. 用户流程

```
用户编写/回填 SQL → 点击执行
        ↓
ResultPanel 默认显示「表格」Tab
        ↓
用户点击「图表」Tab
        ↓
ChartPreview 渲染：
  ├─ 图表类型选择（bar / line / pie）
  ├─ X 字段选择（维度）
  ├─ Y 字段选择（指标）
  └─ ECharts 图表渲染
        ↓
用户可切换回「表格」Tab，表格状态保持不变
```

---

## 5. 架构设计

### 5.1 数据流

```
SQL 执行完成
  → ExecuteResult { columns, rows }
  → useSqlWorkbenchStore.setResult(result)
  → ResultPanel 渲染
    ├─ 「表格」Tab → ResultToolbar + ResultTable
    └─ 「图表」Tab → ChartPreview
      → 数据转换层 → ECharts option
```

**无后端变更。** 所有数据来自前端 store 中已有的 `ExecuteResult`。

### 5.2 新增状态

在 `sqlWorkbenchStore` 中增加会话级 UI 状态（不持久化）：

```typescript
interface WorkbenchState {
  // ...existing fields
  resultView: 'table' | 'chart'
  chartConfig: {
    chartType: 'bar' | 'line' | 'pie'
    xColumn: string | null
    yColumn: string | null
  }
}
```

切换 SQL 执行结果时，`resultView` 和 `chartConfig` 可以选择重置为默认值（推荐），避免旧配置与新结果字段不匹配。

---

## 6. 组件设计

### 6.1 ResultPanel

**变更：** 增加 Tab 切换容器。

```typescript
const ResultPanel: React.FC = () => {
  const resultVisible = useSqlWorkbenchStore((s) => s.resultVisible)
  const resultView = useSqlWorkbenchStore((s) => s.resultView)
  const setResultView = useSqlWorkbenchStore((s) => s.setResultView)

  if (!resultVisible) return null

  return (
    <div style={{ marginTop: 8 }}>
      <Divider style={{ margin: '8px 0' }} />
      <Tabs
        activeKey={resultView}
        onChange={(key) => setResultView(key as 'table' | 'chart')}
        items={[
          { key: 'table', label: '表格', children: <ResultTable /> },
          { key: 'chart', label: '图表', children: <ChartPreview /> },
        ]}
      />
    </div>
  )
}
```

**注意：** `ResultToolbar` 仍放在「表格」Tab 内部或 Tab 上方？

决策：ResultToolbar 放在 Tab 容器**上方**，与 Phase 5B 保持一致。在「图表」Tab 下，Toolbar 继续显示行数/耗时/截断信息，CSV 按钮仍可导出当前结果。这样 ResultToolbar 不受 Tab 切换影响。

### 6.2 ChartPreview

**职责：**
- 图表类型选择
- X/Y 字段选择
- 调用数据转换层生成 ECharts option
- 渲染 ECharts 实例
- 处理空状态/错误状态

**Props：** 无 — 从 store 读取 `result` 和 `chartConfig`。

**内部结构：**

```typescript
const ChartPreview: React.FC = () => {
  const result = useSqlWorkbenchStore((s) => s.result)
  const chartConfig = useSqlWorkbenchStore((s) => s.chartConfig)
  const setChartConfig = useSqlWorkbenchStore((s) => s.setChartConfig)

  if (!result || result.columns.length === 0) {
    return <Empty description="查询结果为空，无法生成图表" />
  }

  return (
    <div>
      <ChartControls
        columns={result.columns}
        config={chartConfig}
        onChange={setChartConfig}
      />
      <ChartCanvas
        chartType={chartConfig.chartType}
        xColumn={chartConfig.xColumn}
        yColumn={chartConfig.yColumn}
        columns={result.columns}
        rows={result.rows}
      />
    </div>
  )
}
```

### 6.3 ChartControls

**职责：** 渲染图表类型、X 字段、Y 字段选择器。

- 图表类型：Ant Design `Segmented` 或 `Radio.Group`，选项为 `bar`、`line`、`pie`。
- X 字段：`Select`，选项为所有 `columns`。
- Y 字段：`Select`，选项为自动识别的数值列 + 可选全部列（允许用户手动选择）。

**Y 字段推荐：** 默认只列出数值列；如果用户需要非数值列，可提供「显示所有字段」开关或直接从全部列中选择。MVP 简化为：全部列可选，但非数值列会在 ChartCanvas 中提示无法聚合。

### 6.4 ChartCanvas

**职责：** 接收转换后的 ECharts option 并渲染图表。

```typescript
interface ChartCanvasProps {
  chartType: 'bar' | 'line' | 'pie'
  xColumn: string | null
  yColumn: string | null
  columns: string[]
  rows: any[][]
}
```

- 使用 `echarts/core` + `echarts/charts` 按需引入；
- 在 `useEffect` 中初始化 ECharts 实例；
- 在 `useEffect` 中监听 props 变化并调用 `chart.setOption()`；
- 组件卸载时调用 `chart.dispose()`。

---

## 7. ECharts 集成

### 7.1 按需引入策略

使用 ECharts 5 的按需引入，避免全量 bundle：

```typescript
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
])
```

### 7.2 Bundle 风险

- 全量 `echarts` 约 300KB+ gzip；
- 按需引入 bar/line/pie + 必要组件后，预计增量约 **150-200KB gzip**；
- 当前前端 bundle 已约 2MB（build 时有 chunk size warning），新增 150-200KB 可接受；
- 未来可进一步通过动态 `import()` 在切换到「图表」Tab 时按需加载 ECharts，降低首屏负担。

### 7.3 jsdom 测试策略

jsdom 不支持 Canvas 的真实渲染，因此：

- **数据转换函数**：单独单元测试，不依赖 ECharts；
- **ChartCanvas 组件测试**：mock `echarts/core` 的 `init` 方法，断言 `setOption` 被调用且 option 结构正确；
- **ChartPreview 组件测试**：验证控件渲染、用户选择字段后配置更新、空状态；
- **真实渲染验证**：使用 `browse` skill 或手动在浏览器中验证图表显示。

Mock 示例（供测试参考）：

```typescript
const mockSetOption = vi.fn()
const mockDispose = vi.fn()
const mockChartInstance = {
  setOption: mockSetOption,
  dispose: mockDispose,
  resize: vi.fn(),
}

vi.mock('echarts/core', () => ({
  init: vi.fn(() => mockChartInstance),
  use: vi.fn(),
}))
```

---

## 8. 数据转换层

### 8.1 输入

```typescript
interface ChartDataInput {
  chartType: 'bar' | 'line' | 'pie'
  xColumn: string
  yColumn: string
  columns: string[]
  rows: any[][]
}
```

### 8.2 字段索引定位

```typescript
const xIndex = columns.indexOf(xColumn)
const yIndex = columns.indexOf(yColumn)
```

### 8.3 聚合规则

**bar / line：**
- 按 X 字段值分组；
- 每组对 Y 字段求和（`sum`）；
- 返回 `{ categories: string[], values: number[] }`。

**pie：**
- 按 X 字段值分组；
- 每组对 Y 字段求和；
- 返回 `{ name: string, value: number }[]`。

### 8.4 NULL / 非数值处理

- NULL 值在聚合时跳过（不参与 sum）；
- 如果 Y 字段某行无法解析为数值，跳过该行；
- 如果分组后所有值都被跳过，该分组值为 0；
- 如果 Y 字段完全非数值，ChartCanvas 显示 Alert「所选 Y 字段不是数值类型，无法生成图表」。

### 8.5 空结果 / 数值字段不足

- `rows.length === 0`：显示 Empty「查询结果为空」；
- 未选择 X 或 Y 字段：显示 Empty「请选择 X/Y 字段」；
- 没有数值列：Y 字段选择器提示「结果中无数值列，无法生成图表」。

### 8.6 大数据量限制

- 图表最大处理数据点：**100 个分组**（bar/line 的 categories 数量，pie 的 slice 数量）；
- 超过限制时：
  - bar/line：对 X 字段做截断，显示前 100 个分组，并提示「数据点过多，仅显示前 100 个分组」；
  - pie：显示前 100 个最大的 slice，其余归为「其他」；
- 该限制仅影响图表渲染，不影响表格数据。

---

## 9. 错误与边界状态

| 场景 | 预期行为 |
|------|---------|
| 结果集为空 | Empty「查询结果为空，无法生成图表」 |
| 未选择 X/Y 字段 | Empty「请选择 X 轴字段和 Y 轴字段」 |
| Y 字段非数值 | Alert「所选 Y 字段无法聚合为数值」 |
| 没有数值列 | Y 字段选择器禁用，提示「无数值列」 |
| 数据点超过 100 | 截断/聚合为「其他」，显示提示 Tag |
| 所有 Y 值为 NULL | 图表显示 0，提示「所有值均为 NULL」 |
| 切换回表格 Tab | ResultTable 正常显示，排序/滚动状态保留 |

---

## 10. 测试策略

### 10.1 数据转换函数测试

新增 `frontend/src/utils/chartData.test.ts`：

```typescript
describe('aggregateChartData', () => {
  it('aggregates bar data by summing Y values per X group', () => { /* ... */ })
  it('aggregates pie data into name/value pairs', () => { /* ... */ })
  it('skips NULL Y values in aggregation', () => { /* ... */ })
  it('returns empty when rows is empty', () => { /* ... */ })
  it('returns empty when Y column is not numeric', () => { /* ... */ })
  it('limits bar categories to MAX_CHART_GROUPS', () => { /* ... */ })
})
```

### 10.2 ChartPreview 组件测试

新增 `frontend/src/components/ChartPreview.test.tsx`：

```typescript
describe('ChartPreview', () => {
  it('renders chart type selector', () => { /* ... */ })
  it('renders X and Y field selectors from columns', () => { /* ... */ })
  it('updates chart config when user selects fields', () => { /* ... */ })
  it('shows empty state when result has no rows', () => { /* ... */ })
  it('shows empty state when no X/Y field selected', () => { /* ... */ })
  it('shows alert when Y field is not numeric', () => { /* ... */ })
})
```

### 10.3 ChartCanvas 组件测试

新增 `frontend/src/components/ChartCanvas.test.tsx`：

```typescript
describe('ChartCanvas', () => {
  it('initializes echarts with correct option', () => { /* mock echarts.init */ })
  it('calls setOption when props change', () => { /* ... */ })
  it('disposes chart on unmount', () => { /* ... */ })
})
```

### 10.4 ResultPanel 集成测试

补充 `frontend/src/components/ResultPanel.test.tsx`（或扩展现有测试）：

```typescript
describe('ResultPanel', () => {
  it('defaults to table tab', () => { /* ... */ })
  it('switches to chart tab when clicked', () => { /* ... */ })
  it('renders ResultTable in table tab', () => { /* ... */ })
  it('renders ChartPreview in chart tab', () => { /* ... */ })
  it('keeps ResultToolbar visible across tabs', () => { /* ... */ })
})
```

### 10.5 验证命令

| 命令 | 用途 |
|------|------|
| `cd frontend && npx vitest run src/utils/chartData.test.ts` | 数据转换测试 |
| `cd frontend && npx vitest run src/components/ChartPreview.test.tsx` | ChartPreview 测试 |
| `cd frontend && npx vitest run src/components/ChartCanvas.test.tsx` | ChartCanvas 测试 |
| `cd frontend && npx vitest run src/components/ResultPanel.test.tsx` | ResultPanel 集成测试 |
| `cd frontend && npm test` | 全量测试 |
| `cd frontend && npx tsc --noEmit` | TypeScript 编译 |
| `cd frontend && npm run build` | 生产构建 |

---

## 11. 明确排除项

| 排除项 | 理由 | 后续阶段 |
|--------|------|---------|
| 图表配置持久化 | 需要后端模型/API | Phase 5D 报表草稿 |
| 报表草稿 | 涉及 SQL + chart config 关联 | Phase 5D |
| 自动图表推荐 | 算法复杂，MVP 先验证手动模式 | Phase 5C+ 或 5D |
| 拖拽字段到图表 | 交互复杂，非核心 | Phase 5C+ |
| 多 Y 轴 / 多系列 / 堆叠图 | 超出 MVP | Phase 5C+ |
| 图表导出 PNG | 需要 ECharts 导出功能 | Phase 5C+ |
| 实时刷新 / 动态数据 | 超出范围 | Phase 5D+ |
| 后端聚合 / 大数据分页 | 需要后端支持 | Phase 5C+ |
| 散点图 / 雷达图 / 热力图等 | 超出 bar/line/pie 范围 | Phase 5C+ |
| 后端 API / 数据库表 / migration | 零后端变更 | — |
| E2E 测试框架 | 保持现有测试栈 | — |
| CJK 宽度估算优化 | 属于 UI polish | 后续 LOW backlog |

---

## 12. 风险清单

| 风险 | 等级 | 缓解策略 |
|------|------|---------|
| ECharts bundle 体积增加 | 中 | 按需引入，未来动态 import |
| jsdom 下 canvas 渲染不可测 | 中 | mock ECharts init，重点测试数据转换 |
| 大数据量导致图表卡顿 | 中 | 限制 100 个分组，超过截断/聚合 |
| 字段类型识别不准确 | 中低 | 自动识别 + 用户手动选择 + 非数值提示 |
| NULL / 空值处理不当 | 低 | 聚合时跳过 NULL，空结果显示 Empty |
| Tab 切换时状态丢失 | 低 | chartConfig 存 store，切换不重置 |
| 时间字段排序错误 | 低 | 折线图按字符串/时间排序，必要时提示 |
| 饼图切片过多可读性差 | 低 | 限制 100 个 slice，其余归为「其他」 |

---

## 13. 文件变更清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `frontend/src/components/ChartPreview.tsx` | 图表预览容器组件 |
| `frontend/src/components/ChartControls.tsx` | 图表类型和字段选择器 |
| `frontend/src/components/ChartCanvas.tsx` | ECharts 渲染组件 |
| `frontend/src/utils/chartData.ts` | 数据转换与聚合函数 |
| `frontend/src/utils/chartData.test.ts` | 数据转换函数测试 |
| `frontend/src/components/ChartPreview.test.tsx` | ChartPreview 组件测试 |
| `frontend/src/components/ChartCanvas.test.tsx` | ChartCanvas 组件测试 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `frontend/src/components/ResultPanel.tsx` | 增加「表格 / 图表」Tab 切换 |
| `frontend/src/components/ResultPanel.test.tsx` | 补充 Tab 切换集成测试 |
| `frontend/src/stores/sqlWorkbenchStore.ts` | 增加 `resultView` 和 `chartConfig` 会话级状态 |

### 不修改的文件

- `frontend/src/components/ResultTable.tsx`
- `frontend/src/components/ResultToolbar.tsx`
- `frontend/src/api/sqlWorkbench.ts`
- 任何后端文件

### 统计

- **新增文件：** 7
- **修改文件：** 3
- **后端变更：** 0
- **数据库变更：** 0
- **新增依赖：** 1（echarts）

---

## 14. 成功标准

- [ ] ResultPanel 可在「表格 / 图表」Tab 之间切换
- [ ] ChartPreview 支持 bar / line / pie 三种图表类型
- [ ] 用户可手动选择 X/Y 字段
- [ ] 图表数据基于当前 `ExecuteResult` 生成，不请求后端
- [ ] 空结果、NULL、非数值 Y 字段、数值字段不足时有明确提示
- [ ] 图表最大处理数据量不超过 100 个分组
- [ ] 全量测试通过
- [ ] TypeScript 编译通过
- [ ] 生产构建通过
- [ ] 不引入 E2E，不修改后端 API/DB

---

## 15. 后续路线

Phase 5C MVP 完成后，可选方向：

- **Phase 5C+**：图表导出 PNG、多系列/堆叠图、自动图表推荐；
- **Phase 5D**：图表配置持久化、报表草稿、SQL draft + chart config 关联。
