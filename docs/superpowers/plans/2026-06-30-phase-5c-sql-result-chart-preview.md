# Phase 5C：SQL Workbench 结果轻量图表预览 MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 SQL Workbench 结果区增加轻量图表预览能力，支持基于当前 SQL 执行结果生成柱状图、折线图、饼图。

**Architecture:** 纯前端变更，零后端改动。新增 `frontend/src/utils/chartData.ts` 数据转换层、新增 `ChartCanvas`/`ChartControls`/`ChartPreview` 组件，修改 `ResultPanel` 增加「表格 / 图表」Tab 切换，扩展 `sqlWorkbenchStore` 增加会话级图表 UI 状态。数据来自前端 store 中已有的 `ExecuteResult`。

**Tech Stack:** React 18 + TypeScript, Ant Design `^5.20.0`, ECharts 5 (按需引入), Zustand, Vitest + React Testing Library

## Global Constraints

- **零后端变更** — 不新增/修改后端 API、路由、服务方法、数据库表、migration
- **仅新增一个 npm 依赖 `echarts`** — 按需引入 `echarts/core` + `echarts/charts` + `echarts/components` + `echarts/renderers`
- **不引入 E2E 测试框架** — 保持现有 Vitest + React Testing Library 测试栈
- **图表类型限定为 bar / line / pie** — 不做散点、雷达、热力图等
- **不做图表配置持久化** — `chartConfig` 为会话级状态，不保存到后端或 localStorage
- **不做报表草稿 / 自动推荐 / 拖拽字段 / 多 Y 轴 / 导出 PNG / 实时刷新**
- **不处理 Phase 4 遗留未跟踪文件**
- **git add 必须显式列出文件** — 不使用 `git add -A` 或 `git add .`
- **每个任务独立 commit**
- **不 push、不 merge、不创建 PR，除非用户明确授权**

---

## File Structure

### 新增文件

| 文件 | 职责 |
|------|------|
| `frontend/src/utils/chartData.ts` | 将 `ExecuteResult` 转换为图表数据结构的纯函数 |
| `frontend/src/utils/chartData.test.ts` | `chartData.ts` 单元测试 |
| `frontend/src/components/ChartCanvas.tsx` | ECharts 渲染组件（按需引入、init/setOption/dispose） |
| `frontend/src/components/ChartCanvas.test.tsx` | `ChartCanvas` 组件测试（mock ECharts） |
| `frontend/src/components/ChartControls.tsx` | 图表类型、X 字段、Y 字段选择器 |
| `frontend/src/components/ChartPreview.tsx` | 图表预览容器，组合 ChartControls + ChartCanvas |
| `frontend/src/components/ChartPreview.test.tsx` | `ChartPreview` 组件测试 |
| `frontend/src/components/ResultPanel.test.tsx` | ResultPanel Tab 切换集成测试 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `frontend/src/components/ResultPanel.tsx` | 增加「表格 / 图表」Tab 切换 |
| `frontend/src/stores/sqlWorkbenchStore.ts` | 增加 `resultView` 和 `chartConfig` 会话级状态 |
| `frontend/package.json` | 新增 `echarts` 依赖 |
| `frontend/package-lock.json` | 依赖锁定文件自动更新 |

### 不修改的文件

- `frontend/src/components/ResultTable.tsx`
- `frontend/src/components/ResultToolbar.tsx`
- `frontend/src/api/sqlWorkbench.ts`
- `frontend/src/utils/csv.ts`
- 任何后端文件

---

## Task 1: 图表数据转换层

**Files:**
- Create: `frontend/src/utils/chartData.ts`
- Create: `frontend/src/utils/chartData.test.ts`

**Interfaces:**
- Consumes: none (pure utility functions)
- Produces:
  - `aggregateChartData(input: ChartDataInput): AggregatedResult`
  - `isNumericColumn(sampleValues: any[]): boolean`
  - `MAX_CHART_GROUPS = 100`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/utils/chartData.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { aggregateChartData, isNumericColumn, MAX_CHART_GROUPS } from './chartData'

describe('isNumericColumn', () => {
  it('returns true for numeric values', () => {
    expect(isNumericColumn(['1', '2', '3'])).toBe(true)
  })

  it('returns false for non-numeric values', () => {
    expect(isNumericColumn(['a', 'b', 'c'])).toBe(false)
  })

  it('returns false when all values are NULL', () => {
    expect(isNumericColumn([null, null, null])).toBe(false)
  })
})

describe('aggregateChartData', () => {
  it('aggregates bar data by summing Y values per X group', () => {
    const result = aggregateChartData({
      chartType: 'bar',
      xColumn: 'category',
      yColumn: 'amount',
      columns: ['category', 'amount'],
      rows: [
        ['A', '100'],
        ['B', '200'],
        ['A', '50'],
      ],
    })
    expect(result.categories).toEqual(['A', 'B'])
    expect(result.values).toEqual([150, 200])
  })

  it('aggregates pie data into name/value pairs', () => {
    const result = aggregateChartData({
      chartType: 'pie',
      xColumn: 'category',
      yColumn: 'amount',
      columns: ['category', 'amount'],
      rows: [
        ['A', '100'],
        ['B', '200'],
        ['A', '50'],
      ],
    })
    expect(result.pieData).toEqual([
      { name: 'A', value: 150 },
      { name: 'B', value: 200 },
    ])
  })

  it('skips NULL Y values in aggregation', () => {
    const result = aggregateChartData({
      chartType: 'bar',
      xColumn: 'category',
      yColumn: 'amount',
      columns: ['category', 'amount'],
      rows: [
        ['A', '100'],
        ['A', null],
        ['B', null],
      ],
    })
    expect(result.values).toEqual([100, 0])
  })

  it('returns empty when rows is empty', () => {
    const result = aggregateChartData({
      chartType: 'bar',
      xColumn: 'category',
      yColumn: 'amount',
      columns: ['category', 'amount'],
      rows: [],
    })
    expect(result.isEmpty).toBe(true)
  })

  it('returns error when Y column is not numeric', () => {
    const result = aggregateChartData({
      chartType: 'bar',
      xColumn: 'category',
      yColumn: 'name',
      columns: ['category', 'name'],
      rows: [
        ['A', 'Alice'],
        ['B', 'Bob'],
      ],
    })
    expect(result.error).toBe('y_not_numeric')
  })

  it('limits bar categories to MAX_CHART_GROUPS', () => {
    const rows = Array.from({ length: MAX_CHART_GROUPS + 10 }, (_, i) => [`item-${i}`, '1'])
    const result = aggregateChartData({
      chartType: 'bar',
      xColumn: 'category',
      yColumn: 'amount',
      columns: ['category', 'amount'],
      rows,
    })
    expect(result.categories?.length).toBe(MAX_CHART_GROUPS)
    expect(result.isTruncated).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/utils/chartData.test.ts --reporter=verbose
```

Expected: FAIL — module not found for `./chartData`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/utils/chartData.ts`:

```typescript
export const MAX_CHART_GROUPS = 100

export type ChartType = 'bar' | 'line' | 'pie'

export interface ChartDataInput {
  chartType: ChartType
  xColumn: string
  yColumn: string
  columns: string[]
  rows: any[][]
}

export interface AggregatedResult {
  categories?: string[]
  values?: number[]
  pieData?: { name: string; value: number }[]
  isEmpty: boolean
  isTruncated?: boolean
  error?: 'y_not_numeric' | 'x_not_found' | 'y_not_found'
}

export function isNumericColumn(sampleValues: any[]): boolean {
  const firstValid = sampleValues.find((v) => v !== null && v !== undefined && v !== '')
  if (firstValid === undefined) return false
  const str = String(firstValid)
  return str !== '' && !isNaN(Number(str))
}

function parseNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = Number(String(value))
  return isNaN(num) ? null : num
}

export function aggregateChartData(input: ChartDataInput): AggregatedResult {
  const { chartType, xColumn, yColumn, columns, rows } = input
  const xIndex = columns.indexOf(xColumn)
  const yIndex = columns.indexOf(yColumn)

  if (xIndex === -1) return { isEmpty: true, error: 'x_not_found' }
  if (yIndex === -1) return { isEmpty: true, error: 'y_not_found' }
  if (rows.length === 0) return { isEmpty: true }

  const ySamples = rows.map((row) => row[yIndex])
  if (!isNumericColumn(ySamples)) {
    return { isEmpty: true, error: 'y_not_numeric' }
  }

  const groups = new Map<string, number>()
  for (const row of rows) {
    const xValue = row[xIndex] == null ? '' : String(row[xIndex])
    const yValue = parseNumber(row[yIndex])
    if (yValue === null) continue
    groups.set(xValue, (groups.get(xValue) || 0) + yValue)
  }

  const sortedEntries = Array.from(groups.entries()).sort((a, b) => b[1] - a[1])
  const isTruncated = sortedEntries.length > MAX_CHART_GROUPS
  const limitedEntries = sortedEntries.slice(0, MAX_CHART_GROUPS)

  if (chartType === 'pie') {
    const otherSum = sortedEntries
      .slice(MAX_CHART_GROUPS)
      .reduce((sum, [, value]) => sum + value, 0)
    const pieData = limitedEntries.map(([name, value]) => ({ name, value }))
    if (otherSum > 0) {
      pieData.push({ name: '其他', value: otherSum })
    }
    return { pieData, isEmpty: false, isTruncated }
  }

  // bar / line
  const categories = limitedEntries.map(([name]) => name)
  const values = limitedEntries.map(([, value]) => value)
  return { categories, values, isEmpty: false, isTruncated }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run src/utils/chartData.test.ts --reporter=verbose
```

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
cd D:/projects/MetricForge
git add frontend/src/utils/chartData.ts frontend/src/utils/chartData.test.ts
git commit -m "feat: add chart data aggregation utilities"
```

---

## Task 2: ECharts 按需引入与 ChartCanvas

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/src/components/ChartCanvas.tsx`
- Create: `frontend/src/components/ChartCanvas.test.tsx`

**Interfaces:**
- Consumes: `aggregateChartData` from `../utils/chartData` (Task 1)
- Produces: `ChartCanvas` component — renders ECharts based on `chartType`, `xColumn`, `yColumn`, `columns`, `rows`

- [ ] **Step 1: Install ECharts**

```bash
cd frontend && npm install echarts
```

Expected: `package.json` and `package-lock.json` updated with `echarts` dependency.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/components/ChartCanvas.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ChartCanvas from './ChartCanvas'

const mockSetOption = vi.fn()
const mockDispose = vi.fn()

vi.mock('echarts/core', () => ({
  init: vi.fn(() => ({
    setOption: mockSetOption,
    dispose: mockDispose,
    resize: vi.fn(),
  })),
  use: vi.fn(),
}))

describe('ChartCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders chart container', () => {
    render(
      <ChartCanvas
        chartType="bar"
        xColumn="category"
        yColumn="amount"
        columns={['category', 'amount']}
        rows={[
          ['A', '100'],
          ['B', '200'],
        ]}
      />
    )
    expect(screen.getByTestId('chart-canvas')).toBeInTheDocument()
  })

  it('calls echarts init with container ref', async () => {
    const echartsCore = await import('echarts/core')
    render(
      <ChartCanvas
        chartType="bar"
        xColumn="category"
        yColumn="amount"
        columns={['category', 'amount']}
        rows={[
          ['A', '100'],
          ['B', '200'],
        ]}
      />
    )
    expect(echartsCore.init).toHaveBeenCalled()
  })

  it('calls setOption when props change', () => {
    const { rerender } = render(
      <ChartCanvas
        chartType="bar"
        xColumn="category"
        yColumn="amount"
        columns={['category', 'amount']}
        rows={[
          ['A', '100'],
          ['B', '200'],
        ]}
      />
    )
    expect(mockSetOption).toHaveBeenCalled()

    rerender(
      <ChartCanvas
        chartType="line"
        xColumn="category"
        yColumn="amount"
        columns={['category', 'amount']}
        rows={[
          ['A', '100'],
          ['B', '200'],
          ['C', '300'],
        ]}
      />
    )
    expect(mockSetOption).toHaveBeenCalledTimes(2)
  })

  it('disposes chart on unmount', () => {
    const { unmount } = render(
      <ChartCanvas
        chartType="bar"
        xColumn="category"
        yColumn="amount"
        columns={['category', 'amount']}
        rows={[
          ['A', '100'],
        ]}
      />
    )
    unmount()
    expect(mockDispose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/components/ChartCanvas.test.tsx --reporter=verbose
```

Expected: FAIL — module not found for `ChartCanvas`

- [ ] **Step 4: Write minimal implementation**

Create `frontend/src/components/ChartCanvas.tsx`:

```typescript
import React, { useEffect, useRef } from 'react'
import * as echartsCore from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsType } from 'echarts/core'
import { aggregateChartData, ChartType } from '../utils/chartData'

echartsCore.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
])

interface ChartCanvasProps {
  chartType: ChartType
  xColumn: string | null
  yColumn: string | null
  columns: string[]
  rows: any[][]
}

const ChartCanvas: React.FC<ChartCanvasProps> = ({
  chartType,
  xColumn,
  yColumn,
  columns,
  rows,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsType | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    chartRef.current = echartsCore.init(containerRef.current)

    return () => {
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!chartRef.current || !xColumn || !yColumn) return

    const aggregated = aggregateChartData({
      chartType,
      xColumn,
      yColumn,
      columns,
      rows,
    })

    if (aggregated.isEmpty || aggregated.error) {
      chartRef.current.clear()
      return
    }

    const option =
      chartType === 'pie'
        ? {
            tooltip: { trigger: 'item' },
            legend: { top: '5%' },
            series: [
              {
                type: 'pie',
                radius: '50%',
                data: aggregated.pieData,
              },
            ],
          }
        : {
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: aggregated.categories },
            yAxis: { type: 'value' },
            series: [
              {
                type: chartType,
                data: aggregated.values,
              },
            ],
          }

    chartRef.current.setOption(option, true)
  }, [chartType, xColumn, yColumn, columns, rows])

  return <div ref={containerRef} data-testid="chart-canvas" style={{ height: 400 }} />
}

export default ChartCanvas
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd frontend && npx vitest run src/components/ChartCanvas.test.tsx --reporter=verbose
```

Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
cd D:/projects/MetricForge
git add frontend/package.json frontend/package-lock.json frontend/src/components/ChartCanvas.tsx frontend/src/components/ChartCanvas.test.tsx
git commit -m "feat: add ECharts integration and ChartCanvas component"
```

---

## Task 3: ChartControls 与 ChartPreview

**Files:**
- Create: `frontend/src/components/ChartControls.tsx`
- Create: `frontend/src/components/ChartPreview.tsx`
- Create: `frontend/src/components/ChartPreview.test.tsx`

**Interfaces:**
- Consumes: `ChartCanvas` from `./ChartCanvas` (Task 2), `aggregateChartData` from `../utils/chartData` (Task 1)
- Produces:
  - `ChartControls` component — renders chart type + X/Y field selectors
  - `ChartPreview` component — composes ChartControls + ChartCanvas + empty/error states

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ChartPreview.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = vi.hoisted(() => ({
  result: null as any,
  chartConfig: { chartType: 'bar' as const, xColumn: null as string | null, yColumn: null as string | null },
  setChartConfig: vi.fn(),
}))

vi.mock('../stores/sqlWorkbenchStore', () => ({
  useSqlWorkbenchStore: (selector: any) => selector(mockStore),
}))

vi.mock('echarts/core', () => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
  })),
  use: vi.fn(),
}))

describe('ChartPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.result = null
    mockStore.chartConfig = { chartType: 'bar', xColumn: null, yColumn: null }
  })

  it('renders empty state when result has no rows', async () => {
    mockStore.result = { columns: ['category', 'amount'], rows: [], row_count: 0 }
    const ChartPreview = (await import('./ChartPreview')).default
    render(<ChartPreview />)
    expect(screen.getByText('查询结果为空，无法生成图表')).toBeInTheDocument()
  })

  it('renders chart type selector', async () => {
    mockStore.result = { columns: ['category', 'amount'], rows: [['A', '100']], row_count: 1 }
    const ChartPreview = (await import('./ChartPreview')).default
    render(<ChartPreview />)
    expect(screen.getByText('柱状图')).toBeInTheDocument()
    expect(screen.getByText('折线图')).toBeInTheDocument()
    expect(screen.getByText('饼图')).toBeInTheDocument()
  })

  it('renders X and Y field selectors from columns', async () => {
    mockStore.result = { columns: ['category', 'amount'], rows: [['A', '100']], row_count: 1 }
    const ChartPreview = (await import('./ChartPreview')).default
    render(<ChartPreview />)
    expect(screen.getByText('category')).toBeInTheDocument()
    expect(screen.getByText('amount')).toBeInTheDocument()
  })

  it('updates chart config when user changes chart type', async () => {
    mockStore.result = { columns: ['category', 'amount'], rows: [['A', '100']], row_count: 1 }
    const ChartPreview = (await import('./ChartPreview')).default
    render(<ChartPreview />)
    const lineTab = screen.getByText('折线图')
    fireEvent.click(lineTab)
    expect(mockStore.setChartConfig).toHaveBeenCalledWith(expect.objectContaining({ chartType: 'line' }))
  })

  it('shows alert when Y field is not numeric', async () => {
    mockStore.result = {
      columns: ['category', 'name'],
      rows: [['A', 'Alice']],
      row_count: 1,
    }
    mockStore.chartConfig = { chartType: 'bar', xColumn: 'category', yColumn: 'name' }
    const ChartPreview = (await import('./ChartPreview')).default
    render(<ChartPreview />)
    expect(screen.getByText(/所选 Y 字段不是数值类型/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/components/ChartPreview.test.tsx --reporter=verbose
```

Expected: FAIL — modules not found

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/components/ChartControls.tsx`:

```typescript
import React from 'react'
import { Select, Segmented, Space } from 'antd'
import type { ChartType } from '../utils/chartData'

interface ChartControlsProps {
  columns: string[]
  chartType: ChartType
  xColumn: string | null
  yColumn: string | null
  onChange: (config: { chartType?: ChartType; xColumn?: string | null; yColumn?: string | null }) => void
}

const ChartControls: React.FC<ChartControlsProps> = ({
  columns,
  chartType,
  xColumn,
  yColumn,
  onChange,
}) => {
  return (
    <Space size="middle" style={{ marginBottom: 16 }}>
      <Segmented
        value={chartType}
        onChange={(value) => onChange({ chartType: value as ChartType })}
        options={[
          { label: '柱状图', value: 'bar' },
          { label: '折线图', value: 'line' },
          { label: '饼图', value: 'pie' },
        ]}
      />
      <Select
        placeholder="选择 X 轴字段"
        value={xColumn}
        onChange={(value) => onChange({ xColumn: value })}
        options={columns.map((col) => ({ label: col, value: col }))}
        style={{ minWidth: 160 }}
      />
      <Select
        placeholder="选择 Y 轴字段"
        value={yColumn}
        onChange={(value) => onChange({ yColumn: value })}
        options={columns.map((col) => ({ label: col, value: col }))}
        style={{ minWidth: 160 }}
      />
    </Space>
  )
}

export default ChartControls
```

Create `frontend/src/components/ChartPreview.tsx`:

```typescript
import React from 'react'
import { Empty, Alert } from 'antd'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'
import ChartControls from './ChartControls'
import ChartCanvas from './ChartCanvas'
import { aggregateChartData } from '../utils/chartData'

const ChartPreview: React.FC = () => {
  const result = useSqlWorkbenchStore((s) => s.result)
  const chartConfig = useSqlWorkbenchStore((s) => s.chartConfig)
  const setChartConfig = useSqlWorkbenchStore((s) => s.setChartConfig)

  if (!result || result.columns.length === 0 || result.row_count === 0) {
    return <Empty description="查询结果为空，无法生成图表" />
  }

  const hasSelection = chartConfig.xColumn && chartConfig.yColumn
  let errorMessage: string | null = null

  if (hasSelection) {
    const aggregated = aggregateChartData({
      chartType: chartConfig.chartType,
      xColumn: chartConfig.xColumn,
      yColumn: chartConfig.yColumn,
      columns: result.columns,
      rows: result.rows,
    })
    if (aggregated.error === 'y_not_numeric') {
      errorMessage = '所选 Y 字段不是数值类型，无法生成图表'
    }
  }

  return (
    <div>
      <ChartControls
        columns={result.columns}
        chartType={chartConfig.chartType}
        xColumn={chartConfig.xColumn}
        yColumn={chartConfig.yColumn}
        onChange={(patch) => setChartConfig({ ...chartConfig, ...patch })}
      />
      {errorMessage && <Alert type="warning" message={errorMessage} showIcon style={{ marginBottom: 16 }} />}
      {!hasSelection && <Empty description="请选择 X 轴字段和 Y 轴字段" />}
      {hasSelection && !errorMessage && (
        <ChartCanvas
          chartType={chartConfig.chartType}
          xColumn={chartConfig.xColumn}
          yColumn={chartConfig.yColumn}
          columns={result.columns}
          rows={result.rows}
        />
      )}
    </div>
  )
}

export default ChartPreview
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run src/components/ChartPreview.test.tsx --reporter=verbose
```

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
cd D:/projects/MetricForge
git add frontend/src/components/ChartControls.tsx frontend/src/components/ChartPreview.tsx frontend/src/components/ChartPreview.test.tsx
git commit -m "feat: add ChartControls and ChartPreview components"
```

---

## Task 4: ResultPanel 集成与 Store 扩展

**Files:**
- Modify: `frontend/src/stores/sqlWorkbenchStore.ts`
- Modify: `frontend/src/components/ResultPanel.tsx`
- Create: `frontend/src/components/ResultPanel.test.tsx`

**Interfaces:**
- Consumes: `ChartPreview` from `./ChartPreview` (Task 3), `ResultToolbar`/`ResultTable` (existing)
- Produces:
  - `sqlWorkbenchStore` with `resultView` and `chartConfig`
  - `ResultPanel` with「表格 / 图表」Tab 切换

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ResultPanel.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = vi.hoisted(() => ({
  resultVisible: true,
  result: {
    columns: ['category', 'amount'],
    rows: [['A', '100']],
    row_count: 1,
    truncated: false,
    elapsed_ms: 50,
    error: null,
  },
  resultView: 'table' as const,
  setResultView: vi.fn(),
  chartConfig: { chartType: 'bar' as const, xColumn: null as string | null, yColumn: null as string | null },
}))

vi.mock('../stores/sqlWorkbenchStore', () => ({
  useSqlWorkbenchStore: (selector: any) => selector(mockStore),
}))

vi.mock('echarts/core', () => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
  })),
  use: vi.fn(),
}))

describe('ResultPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.resultView = 'table'
  })

  it('renders ResultTable by default', async () => {
    const ResultPanel = (await import('./ResultPanel')).default
    render(<ResultPanel />)
    // ResultTable renders column headers
    expect(screen.getByText('category')).toBeInTheDocument()
  })

  it('switches to chart tab when clicked', async () => {
    const ResultPanel = (await import('./ResultPanel')).default
    render(<ResultPanel />)
    const chartTab = screen.getByText('图表')
    fireEvent.click(chartTab)
    expect(mockStore.setResultView).toHaveBeenCalledWith('chart')
  })

  it('renders ChartPreview when resultView is chart', async () => {
    mockStore.resultView = 'chart'
    const ResultPanel = (await import('./ResultPanel')).default
    render(<ResultPanel />)
    expect(screen.getByText('柱状图')).toBeInTheDocument()
  })

  it('keeps ResultToolbar visible across tabs', async () => {
    const ResultPanel = (await import('./ResultPanel')).default
    render(<ResultPanel />)
    expect(screen.getByText(/1 行/)).toBeInTheDocument()
    const chartTab = screen.getByText('图表')
    fireEvent.click(chartTab)
    expect(screen.getByText(/1 行/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/components/ResultPanel.test.tsx --reporter=verbose
```

Expected: FAIL — store/ResultPanel not updated

- [ ] **Step 3: Extend sqlWorkbenchStore**

Modify `frontend/src/stores/sqlWorkbenchStore.ts`:

Import `ChartType` from chartData and add `ChartConfig` type:

```typescript
import type { ChartType } from '../utils/chartData'

export interface ChartConfig {
  chartType: ChartType
  xColumn: string | null
  yColumn: string | null
}
```

Add to `WorkbenchState`:

```typescript
resultView: 'table' | 'chart'
chartConfig: ChartConfig
setResultView: (view: 'table' | 'chart') => void
setChartConfig: (config: ChartConfig) => void
```

Add to initial state:

```typescript
const initialState = {
  // ...existing fields
  resultView: 'table' as const,
  chartConfig: {
    chartType: 'bar' as const,
    xColumn: null,
    yColumn: null,
  },
}
```

Add actions:

```typescript
setResultView: (view) => set({ resultView: view }),
setChartConfig: (config) => set({ chartConfig: config }),
```

- [ ] **Step 4: Update ResultPanel**

Modify `frontend/src/components/ResultPanel.tsx`:

```typescript
import React from 'react'
import { Divider, Tabs } from 'antd'
import ResultToolbar from './ResultToolbar'
import ResultTable from './ResultTable'
import ChartPreview from './ChartPreview'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'

const ResultPanel: React.FC = () => {
  const resultVisible = useSqlWorkbenchStore((s) => s.resultVisible)
  const resultView = useSqlWorkbenchStore((s) => s.resultView)
  const setResultView = useSqlWorkbenchStore((s) => s.setResultView)

  if (!resultVisible) return null

  return (
    <div style={{ marginTop: 8 }}>
      <Divider style={{ margin: '8px 0' }} />
      <ResultToolbar />
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

export default ResultPanel
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd frontend && npx vitest run src/components/ResultPanel.test.tsx --reporter=verbose
```

Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
cd D:/projects/MetricForge
git add frontend/src/stores/sqlWorkbenchStore.ts frontend/src/components/ResultPanel.tsx frontend/src/components/ResultPanel.test.tsx
git commit -m "feat: integrate ChartPreview into ResultPanel with table/chart tabs"
```

---

## Task 5: 全量验证与 Final Review

**Files:**
- No new files — verification only

- [ ] **Step 1: Run full test suite**

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

Expected: Build successful. May show pre-existing chunk size warning.

- [ ] **Step 4: Verify scope compliance**

```bash
cd D:/projects/MetricForge
git diff --name-status main...HEAD
```

Expected: Only frontend files changed, no backend/API/DB/migration files.

Checklist:
- [ ] 无后端文件变更
- [ ] 无数据库 migration 文件
- [ ] 无 E2E 测试框架引入
- [ ] 无 Phase 5D/报表草稿/持久化代码
- [ ] 无自动图表推荐代码
- [ ] 无拖拽字段/多 Y 轴/堆叠图/导出 PNG/实时刷新代码
- [ ] Phase 4 遗留未跟踪文件未被 `git add`

- [ ] **Step 5: Manual edge case review**

| Check | Expected |
|-------|----------|
| `ResultPanel` defaults to `table` tab | ✅ `resultView: 'table'` |
| `ResultToolbar` visible in both tabs | ✅ Placed above Tabs |
| `ResultTable` behavior unchanged | ✅ No modifications to ResultTable.tsx |
| Chart type limited to bar/line/pie | ✅ `ChartType` union type |
| X/Y fields come from `result.columns` | ✅ Select options from columns |
| No backend API calls added | ✅ No api/sqlWorkbench.ts changes |
| ECharts imported on-demand | ✅ `echarts/core` + `echarts/charts` |

- [ ] **Step 6: Commit any final polish fixes**

If any fixes needed from Step 4/5:

```bash
cd D:/projects/MetricForge
git add <relevant files>
git commit -m "fix: address final review findings for Phase 5C"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec 要求 | 对应 Task |
|-----------|-----------|
| ResultPanel「表格 / 图表」切换 | Task 4 |
| ChartPreview 组件 | Task 3 |
| ChartCanvas ECharts 渲染 | Task 2 |
| 数据转换层 bar/line/pie + sum + 100 分组限制 | Task 1 |
| NULL/空结果/非数值 Y/数值字段不足处理 | Task 1, Task 3 |
| ECharts 按需引入 + bundle 说明 | Task 2 |
| jsdom mock ECharts 测试 | Task 2 |
| 测试策略（数据转换/组件/集成） | Task 1-4 |
| 零后端/API/DB/migration | Global Constraints + Task 5 |

### Placeholder Scan

- [ ] 无 TBD/TODO
- [ ] 无 "appropriate error handling" 等模糊描述
- [ ] 每个代码步骤包含代码示例
- [ ] 每个运行步骤包含 exact 命令与预期输出

### Type Consistency

- [ ] `ChartType` 在 `chartData.ts` 和 store 中一致
- [ ] `ChartConfig` shape 在 store 和 ChartPreview/ChartControls 中一致
- [ ] `aggregateChartData` 输入/输出类型在 Task 1 定义并在 Task 2/3 使用

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-30-phase-5c-sql-result-chart-preview.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

**Waiting for user confirmation before proceeding.**
