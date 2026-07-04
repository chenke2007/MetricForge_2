# Phase 5G AI 图表美化与 LLM Adapter 协议 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 5F 交付了"问数主工作台的骨架"——结构化的 AiAskResponse 协议、组件体系和信息架构。Phase 5G 的目标是把骨架填上血肉：建立 F-light LLM Adapter 基础设施 + 完成 A-MVP 图表美化与自动推荐增强。

**Architecture:** 分两个串联阶段执行。5G.1 将 Phase 5F 的硬编码单文件 mock（`aiAsk.mock.ts`）重构为适配器模式（`AiAskAdapter` 接口 + `MockAdapter` 场景化实现 + 校验器 + 错误处理）。5G.2 在 Adapter 之上完成图表体验飞跃：补齐 combo/metric-card/table 渲染、多 yFields 支持、数据标签、自定义推荐、骨架屏加载态、结果表 Ant Design Table 迁移。全部纯前端变更，不修改 SQL Workbench 核心逻辑，不新增后端 API/DB/migration，不接入真实 LLM。

**Tech Stack:** React 18, TypeScript, Ant Design 5, ECharts 6, Zustand, Vitest + React Testing Library, react-syntax-highlighter (已引入)

## Global Constraints

- 不新增后端 API / DB / migration
- 不接入真实 LLM（全部客户端 mock）
- 不引入 Playwright / Cypress
- 不修改 SQL Workbench 核心逻辑
- 不处理 Phase 4 untracked 遗留文件
- 不 push，不 merge
- AiAskResponse 协议无破坏性变更（MetricCard.icon 为 optional）
- mock 数据源使用 `{ id: 2, name: 'dwhrpt' }`，业务代码不得硬编码 `dwhrpt`
- 5G.1 必须在 5G.2 之前完成，不允许并行混做
- 验证命令：`cd frontend && npm test` / `cd frontend && npx tsc --noEmit` / `cd frontend && npm run build`

---
## 文件结构总览

### 5G.1 新增文件

| 文件 | 职责 |
|------|------|
| `frontend/src/api/aiAsk/adapter.ts` | AiAskAdapter 接口、AiAskContext、ChartDataResult 定义 |
| `frontend/src/api/aiAsk/mockAdapter.ts` | MockAdapter 实现：场景匹配 + recommendCharts 集成 + 模拟延迟 + 响应校验 |
| `frontend/src/api/aiAsk/recommendation.ts` | 基于规则的图表推荐引擎（供 MockAdapter.analyze() 内部使用，非独立工具） |
| `frontend/src/api/aiAsk/scenarios/index.ts` | 统一导出所有场景 |
| `frontend/src/api/aiAsk/scenarios/revenueByRegion.ts` | 场景1：各区域销售额（bar + metric-card） |
| `frontend/src/api/aiAsk/scenarios/trend.ts` | 场景2：时间趋势（line + metric-card） |
| `frontend/src/api/aiAsk/scenarios/topN.ts` | 场景3：Top-N 排名（bar + metric-card） |
| `frontend/src/api/aiAsk/scenarios/comparison.ts` | 场景4：对比分析（combo + metric-card） |
| `frontend/src/api/aiAsk/scenarios/default.ts` | 场景5：通用分析（bar + pie） |
| `frontend/src/api/aiAsk/validator.ts` | AiAskResponse 结构校验器 |
| `frontend/src/api/aiAsk/errors.ts` | AiAskError 类和错误码 |
| `frontend/src/api/aiAsk/index.ts` | 统一导出 + useAiAskService hook |

### 5G.1 删除文件

| 文件 | 原因 |
|------|------|
| `frontend/src/api/aiAsk.mock.ts` | 被 scenarios 目录替代，由 MockAdapter 统一管理 |

### 5G.1 修改文件

| 文件 | 变更 |
|------|------|
| `frontend/src/stores/aiAskStore.ts` | 新增 adapterName、error、validation、analysisStep、isExecuting 状态 |
| `frontend/src/pages/AskWorkbenchPage.tsx` | 从使用 MOCK_ASK_RESPONSE 改为 useAiAskService adapter 接口 |

### 5G.2 新增文件

| 文件 | 职责 |
|------|------|
| `frontend/src/utils/numberFormat.ts` | 数值格式化工具函数（formatCompact / formatPercent / formatCurrency / detectFormat） |

### 5G.2 修改文件

| 文件 | 变更 |
|------|------|
| `frontend/src/types/aiAsk.ts` | MetricCard 新增 icon 字段 + MetricIcon 类型 |
| `frontend/src/styles/chartThemes.ts` | 新增 getSeriesColor 工具函数 |
| `frontend/src/utils/chartData.ts` | 支持多 yFields 分组聚合 |
| `frontend/src/components/ChartCanvas.tsx` | 新增 combo 渲染 + 多 yFields 分组柱/多折线 + 数据标签 + tooltip/legend 增强 |
| `frontend/src/components/ChartCard.tsx` | metric-card 增强（icon 映射 + 数值格式化 + 卡片微渐变 + hover 动效） |
| `frontend/src/components/AiChartBoard.tsx` | 响应式间距 + 第一张卡片默认高亮视觉 |
| `frontend/src/pages/AskWorkbenchPage.tsx` | 结果表使用 Ant Design Table + 骨架屏加载态 + analysisStep 步骤指示器 |

---

## Phase 5G.1：F-light LLM Adapter / 结构化响应协议

### Task 1: Adapter 接口定义 + 错误处理 + 校验器

**Files:**
- Create: `frontend/src/api/aiAsk/adapter.ts`
- Create: `frontend/src/api/aiAsk/errors.ts`
- Create: `frontend/src/api/aiAsk/validator.ts`
- Create: `frontend/src/api/aiAsk/index.ts`
- Create: `frontend/src/api/aiAsk/validator.test.ts`
- Create: `frontend/src/api/aiAsk/errors.test.ts`

**Interfaces:**
- Consumes: `AiAskResponse`, `AiChartSpec` from `types/aiAsk.ts`
- Produces: `AiAskAdapter` interface, `AiAskContext`, `ChartDataResult`, `AiAskError`, `AiAskErrorCode`, `ValidationResult`, `validateAiAskResponse()`

- [ ] **Step 1: Create `api/aiAsk/adapter.ts`**

```typescript
// frontend/src/api/aiAsk/adapter.ts
import type { AiAskResponse, AiChartSpec } from '../../types/aiAsk'

export interface AiAskContext {
  datasourceId: number | null
  datasourceName: string | null
  selectedTables: string[]
  messageHistory?: Array<{
    role: 'user' | 'assistant'
    content: string
    responseJson?: Record<string, unknown>
  }>
  options?: {
    mockDelay?: [number, number]
    mockFailureRate?: number
  }
}

export interface ChartDataResult {
  columns: string[]
  rows: any[][]
  isEmpty: boolean
  error?: string
}

export interface AiAskAdapter {
  analyze(question: string, context: AiAskContext): Promise<AiAskResponse>
  getChartData(spec: AiChartSpec, response: AiAskResponse): ChartDataResult
  isAvailable(): boolean
  readonly name: string
}
```

- [ ] **Step 2: Create `api/aiAsk/errors.ts`**

```typescript
// frontend/src/api/aiAsk/errors.ts

export type AiAskErrorCode =
  | 'ANALYSIS_TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'NO_DATA'
  | 'ADAPTER_UNAVAILABLE'
  | 'CONTEXT_TOO_LARGE'
  | 'UNKNOWN'

export class AiAskError extends Error {
  constructor(
    message: string,
    public code: AiAskErrorCode,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AiAskError'
    this.details = details
  }
}

export function getAiAskErrorMessage(code: AiAskErrorCode): string {
  switch (code) {
    case 'ANALYSIS_TIMEOUT':
      return '分析超时，请简化你的问题后重试'
    case 'INVALID_RESPONSE':
      return 'AI 返回结果异常，请重试'
    case 'NO_DATA':
      return '当前数据范围无可用数据'
    case 'ADAPTER_UNAVAILABLE':
      return 'AI 服务暂不可用，请稍后重试'
    case 'CONTEXT_TOO_LARGE':
      return '当前对话上下文过长，建议开始新对话'
    case 'UNKNOWN':
      return '分析异常，请重试'
  }
}
```

- [ ] **Step 3: Create `api/aiAsk/errors.test.ts`**

```typescript
// frontend/src/api/aiAsk/errors.test.ts
import { describe, it, expect } from 'vitest'
import { AiAskError, getAiAskErrorMessage } from './errors'

describe('AiAskError', () => {
  it('creates error with code and message', () => {
    const err = new AiAskError('test', 'UNKNOWN', { detail: 'x' })
    expect(err.message).toBe('test')
    expect(err.code).toBe('UNKNOWN')
    expect(err.name).toBe('AiAskError')
    expect(err.details).toEqual({ detail: 'x' })
  })

  it('getAiAskErrorMessage returns Chinese message for each code', () => {
    expect(getAiAskErrorMessage('ANALYSIS_TIMEOUT')).toContain('超时')
    expect(getAiAskErrorMessage('INVALID_RESPONSE')).toContain('异常')
    expect(getAiAskErrorMessage('NO_DATA')).toContain('无可用数据')
    expect(getAiAskErrorMessage('ADAPTER_UNAVAILABLE')).toContain('暂不可用')
    expect(getAiAskErrorMessage('CONTEXT_TOO_LARGE')).toContain('过长')
    expect(getAiAskErrorMessage('UNKNOWN')).toContain('异常')
  })
})
```

- [ ] **Step 4: Create `api/aiAsk/validator.ts`**

```typescript
// frontend/src/api/aiAsk/validator.ts
import type { AiAskResponse } from '../../types/aiAsk'

export interface ValidationError {
  path: string
  message: string
  severity: 'error' | 'warning'
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: string[]
}

const VALID_CHART_TYPES = ['bar', 'line', 'pie', 'table', 'metric-card', 'combo']

export function validateAiAskResponse(response: unknown): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: string[] = []

  if (!response || typeof response !== 'object') {
    errors.push({ path: '', message: 'response 为 null 或非对象', severity: 'error' })
    return { valid: false, errors, warnings }
  }

  const r = response as Record<string, unknown>

  // question
  if (!r.question || typeof r.question !== 'string') {
    errors.push({ path: 'question', message: 'question 不能为空', severity: 'error' })
  }

  // intent
  if (!r.intent || typeof r.intent !== 'object') {
    errors.push({ path: 'intent', message: 'intent 不能为空', severity: 'error' })
  } else {
    const intent = r.intent as Record<string, unknown>
    const metrics = Array.isArray(intent.metrics) ? intent.metrics : []
    const dimensions = Array.isArray(intent.dimensions) ? intent.dimensions : []
    if (metrics.length === 0 && dimensions.length === 0) {
      warnings.push('intent 无 metrics 且无 dimensions，AI 未理解任何业务要素')
    }
  }

  // sqlPlan
  if (!r.sqlPlan || typeof r.sqlPlan !== 'object') {
    errors.push({ path: 'sqlPlan', message: 'sqlPlan 不能为空', severity: 'error' })
  } else {
    const plan = r.sqlPlan as Record<string, unknown>
    if (!plan.sql || typeof plan.sql !== 'string' || !plan.sql.trim()) {
      errors.push({ path: 'sqlPlan.sql', message: 'sql 不能为空', severity: 'error' })
    }
    if (!Array.isArray(plan.tables) || plan.tables.length === 0) {
      warnings.push('sqlPlan.tables 为空，SQL 可能缺少表引用')
    }
  }

  // chartSuggestions
  if (!Array.isArray(r.chartSuggestions)) {
    warnings.push('chartSuggestions 为空，无图表建议')
  } else {
    for (let i = 0; i < r.chartSuggestions.length; i++) {
      const spec = r.chartSuggestions[i]
      if (!spec || typeof spec !== 'object') continue
      const s = spec as Record<string, unknown>
      if (!s.title || typeof s.title !== 'string') {
        errors.push({ path: `chartSuggestions[${i}].title`, message: '图表标题不能为空', severity: 'error' })
      }
      if (s.chartType && !VALID_CHART_TYPES.includes(s.chartType as string)) {
        warnings.push(`chartSuggestions[${i}].chartType "${s.chartType}" 不合法，fallback 为 bar`)
      }
    }
  }

  // narrative
  if (!r.narrative || typeof r.narrative !== 'object') {
    warnings.push('narrative 为空，无解读摘要')
  } else {
    const narrative = r.narrative as Record<string, unknown>
    if (!narrative.summary || typeof narrative.summary !== 'string') {
      warnings.push('narrative.summary 为空')
    }
  }

  // semanticGaps
  if (Array.isArray(r.semanticGaps)) {
    for (let i = 0; i < r.semanticGaps.length; i++) {
      const gap = r.semanticGaps[i]
      if (!gap || typeof gap !== 'object') continue
      const g = gap as Record<string, unknown>
      if (!g.field || typeof g.field !== 'string') {
        warnings.push(`semanticGaps[${i}].field 为空`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
```

- [ ] **Step 5: Create `api/aiAsk/validator.test.ts`**

```typescript
// frontend/src/api/aiAsk/validator.test.ts
import { describe, it, expect } from 'vitest'
import { validateAiAskResponse } from './validator'
import type { AiAskResponse } from '../../types/aiAsk'

const validResponse: AiAskResponse = {
  question: '各区域销售额',
  intent: { metrics: ['销售额'], dimensions: ['区域'], filters: [], timeRange: '近 30 天' },
  sqlPlan: { datasourceId: 2, datasourceName: 'dwhrpt', sql: 'SELECT * FROM t', tables: ['t'], fields: ['a'], assumptions: [], safetyWarnings: [] },
  chartSuggestions: [{ title: '图', chartType: 'bar', xField: 'x', yFields: ['y'], rationale: 'r', limitations: [] }],
  narrative: { summary: 's', keyFindings: [], evidence: [], risks: [], nextQuestions: [] },
  semanticGaps: [],
}

describe('validateAiAskResponse', () => {
  it('passes valid response', () => {
    const result = validateAiAskResponse(validResponse)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('fails on null', () => {
    const result = validateAiAskResponse(null)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('fails on empty question', () => {
    const result = validateAiAskResponse({ ...validResponse, question: '' })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.path === 'question')).toBe(true)
  })

  it('warns on empty metrics and dimensions', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      intent: { metrics: [], dimensions: [], filters: [], timeRange: undefined },
    })
    expect(result.warnings.some(w => w.includes('无 metrics'))).toBe(true)
  })

  it('warns on empty chartSuggestions', () => {
    const result = validateAiAskResponse({ ...validResponse, chartSuggestions: [] })
    expect(result.warnings.some(w => w.includes('chartSuggestions 为空'))).toBe(true)
  })

  it('warns on invalid chartType', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      chartSuggestions: [{ title: '图', chartType: 'invalid', xField: 'x', yFields: ['y'], rationale: 'r', limitations: [] }],
    })
    expect(result.warnings.some(w => w.includes('不合法'))).toBe(true)
  })
})
```

- [ ] **Step 6: Create `api/aiAsk/index.ts`**

```typescript
// frontend/src/api/aiAsk/index.ts
export type { AiAskAdapter, AiAskContext, ChartDataResult } from './adapter'
export { AiAskError } from './errors'
export type { AiAskErrorCode } from './errors'
export { getAiAskErrorMessage } from './errors'
export { validateAiAskResponse } from './validator'
export type { ValidationResult, ValidationError } from './validator'
export { MockAdapter } from './mockAdapter'

export function useAiAskService() {
  // Phase 5G only provides MockAdapter
  const adapter = MockAdapter.create()
  return {
    analyze: adapter.analyze.bind(adapter),
    getChartData: adapter.getChartData.bind(adapter),
    isAvailable: adapter.isAvailable.bind(adapter),
    name: adapter.name,
    validate: validateAiAskResponse,
  }
}
```

- [ ] **Step 7: Run tests to verify**

Run: `cd frontend && npx vitest run api/aiAsk/errors.test.ts api/aiAsk/validator.test.ts -v`
Expected: PASS (at least 2 + 6 = 8 tests)

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api/aiAsk/adapter.ts frontend/src/api/aiAsk/errors.ts frontend/src/api/aiAsk/errors.test.ts frontend/src/api/aiAsk/validator.ts frontend/src/api/aiAsk/validator.test.ts frontend/src/api/aiAsk/index.ts
git commit -m "feat(phase-5g.1): add AiAskAdapter interface, AiAskError, and response validator"
```

---

### Task 2: 场景化 MockAdapter + recommendCharts 集成 + 5 个场景文件

**Files:**
- Create: `frontend/src/api/aiAsk/mockAdapter.ts`
- Create: `frontend/src/api/aiAsk/recommendation.ts`
- Create: `frontend/src/api/aiAsk/recommendation.test.ts`
- Create: `frontend/src/api/aiAsk/scenarios/index.ts`
- Create: `frontend/src/api/aiAsk/scenarios/revenueByRegion.ts`
- Create: `frontend/src/api/aiAsk/scenarios/trend.ts`
- Create: `frontend/src/api/aiAsk/scenarios/topN.ts`
- Create: `frontend/src/api/aiAsk/scenarios/comparison.ts`
- Create: `frontend/src/api/aiAsk/scenarios/default.ts`
- Create: `frontend/src/api/aiAsk/mockAdapter.test.ts`

**Interfaces:**
- Consumes: `AiAskAdapter`, `AiAskContext`, `ChartDataResult` from `adapter.ts`; `AiAskResponse` from `types/aiAsk.ts`
- Produces: `MockAdapter` class, `recommendCharts(input): AiChartSpec[]`, `ChartRecommendationInput`

**重要设计决策：**
- `recommendCharts()` **不是独立工具**，而是 `MockAdapter.analyze()` 内部调用的图表推荐引擎
- 每个 Mock 场景导出的 `chartSuggestions` 作为**兜底 fallback**；主路径由 recommendCharts 根据问题关键词 + 数据特征动态生成
- 不同问题/不同场景 → 不同的 intent 分析 → 不同的 chartSuggestions → AiChartBoard 展示差异化推荐
- 实现路径：`adapter.analyze(question)` → 匹配场景 → 从问题提取关键词构建 intent → `recommendCharts(columns, rows, question, intent)` → chartSuggestions

- [ ] **Step 1: Create `api/aiAsk/recommendation.ts`**（在 mockAdapter 之前创建，供其 import）

```typescript
// frontend/src/api/aiAsk/recommendation.ts
import type { AiChartSpec } from '../../types/aiAsk'

export interface ChartRecommendationInput {
  columns: string[]
  sampleRows: any[][]
  question: string
  intent: {
    metrics: string[]
    dimensions: string[]
    filters: string[]
    timeRange?: string
  }
}

/**
 * Rule-based chart recommendation engine.
 * Called inside MockAdapter.analyze() — NOT a standalone tool.
 * Uses question keywords + intent + data shape to determine chart types.
 */
export function recommendCharts(input: ChartRecommendationInput): AiChartSpec[] {
  const { columns, sampleRows, question, intent } = input
  const combinedText = [question, ...intent.metrics, ...intent.dimensions, ...intent.filters, intent.timeRange || ''].join(' ')

  const hasTime = /趋势|走势|月度|季度|月变化|环比|逐月|近.*月|近.*年|时间|日期|week|month|trend/i.test(combinedText)
  const hasComparison = /对比|比较|同比|环比|vs|versus|去年|去年同期|comparison/i.test(combinedText)
  const hasRank = /top|排名|前.*名|排行|最高|最多|前十|前五|top/i.test(combinedText)
  const hasDetail = /明细|详细|清单|list|detail|全部数据/i.test(combinedText)
  const hasRevenue = /销售|收入|营收|revenue|sales|amount|金额/i.test(combinedText)

  const metricCount = intent.metrics.length
  const numericColumns = columns.filter((col, ci) => {
    const samples = sampleRows.map(r => r[ci])
    return samples.some(v => typeof v === 'number')
  })

  const charts: AiChartSpec[] = []

  // Rule 1: comparison → combo
  if (hasComparison && metricCount >= 1) {
    charts.push({
      title: '对比分析', chartType: 'combo',
      xField: intent.dimensions[0] || columns[0],
      yFields: numericColumns.slice(0, 2),
      rationale: '组合图同时展示绝对值与变化趋势，直观呈现对比关系',
      limitations: ['仅展示两系列数据'],
    })
  }

  // Rule 2: time dimension → line
  if (hasTime && metricCount >= 1) {
    charts.push({
      title: intent.metrics.length > 1 ? '多指标趋势' : '趋势分析',
      subtitle: intent.timeRange, chartType: 'line',
      xField: intent.dimensions.find(d => /时间|日期|月|年|day|month/i.test(d)) || intent.dimensions[0] || columns[0],
      yFields: numericColumns.slice(0, 3),
      rationale: '折线图清晰展示随时间的变化趋势',
      limitations: ['趋势基于样本数据'],
    })
  }

  // Rule 3: rank intent → bar (sorted)
  if (hasRank && metricCount >= 1) {
    charts.push({
      title: intent.metrics[0] + '排行', chartType: 'bar',
      xField: intent.dimensions[0] || columns[0],
      yFields: [numericColumns[0] || intent.metrics[0]],
      sort: { field: numericColumns[0] || intent.metrics[0], direction: 'desc' },
      rationale: '柱状图直观展示排名分布',
      limitations: ['数据按单指标降序排列'],
    })
  }

  // Rule 4: single dimension + single metric → bar + pie
  if (intent.dimensions.length <= 1 && metricCount >= 1 && !hasTime) {
    if (!charts.some(c => c.chartType === 'bar')) {
      charts.push({
        title: intent.metrics[0] + '分布', chartType: 'bar',
        xField: intent.dimensions[0] || columns[0],
        yFields: [numericColumns[0] || intent.metrics[0]],
        rationale: '柱状图对比各维度的数值差异',
        limitations: ['不含趋势信息'],
      })
    }
    charts.push({
      title: intent.metrics[0] + '占比', chartType: 'pie',
      xField: intent.dimensions[0] || columns[0],
      yFields: [numericColumns[0] || intent.metrics[0]],
      rationale: '饼图展示占比结构',
      limitations: ['不超过 6 个扇区'],
    })
  }

  // Rule 5: multiple metrics → grouped bar
  if (metricCount >= 2 && !charts.some(c => c.chartType === 'combo')) {
    charts.push({
      title: '多指标对比', chartType: 'bar',
      xField: intent.dimensions[0] || columns[0],
      yFields: numericColumns.slice(0, Math.min(metricCount, 4)),
      rationale: '分组柱状图对比多个指标',
      limitations: ['各指标量级差异大时建议分开查看'],
    })
  }

  // Rule 6: detail request → table
  if (hasDetail) {
    charts.push({
      title: '数据明细', chartType: 'table',
      yFields: columns,
      rationale: '表格展示完整数据明细',
      limitations: ['大数据量时仅展示前 100 行'],
    })
  }

  // Ensure at least 1 chart
  if (charts.length === 0) {
    charts.push({
      title: '数据概览', chartType: 'bar',
      xField: columns[0], yFields: numericColumns.slice(0, 1),
      rationale: '柱状图展示数据分布',
      limitations: [],
    })
  }

  return charts.slice(0, 4)
}
```

- [ ] **Step 2: Create `api/aiAsk/recommendation.test.ts`**

```typescript
// frontend/src/api/aiAsk/recommendation.test.ts
import { describe, it, expect } from 'vitest'
import { recommendCharts } from './recommendation'

describe('recommendCharts', () => {
  const baseColumns = ['region', 'month', 'revenue', 'count', 'rate']
  const sampleRows = [
    ['华东', '2026-06', 100000, 500, 0.32],
    ['华南', '2026-06', 80000, 400, 0.28],
  ]

  it('recommends line for time-related question', () => {
    const result = recommendCharts({
      columns: baseColumns, sampleRows,
      question: '近 6 个月收入趋势',
      intent: { metrics: ['revenue'], dimensions: ['month'], filters: [], timeRange: '近 6 月' },
    })
    expect(result.some(c => c.chartType === 'line')).toBe(true)
  })

  it('recommends bar + pie for single dimension+metric', () => {
    const result = recommendCharts({
      columns: baseColumns, sampleRows,
      question: '各区域销售额',
      intent: { metrics: ['revenue'], dimensions: ['region'], filters: [] },
    })
    expect(result.some(c => c.chartType === 'bar')).toBe(true)
    expect(result.some(c => c.chartType === 'pie')).toBe(true)
  })

  it('recommends combo for comparison question', () => {
    const result = recommendCharts({
      columns: baseColumns, sampleRows,
      question: '今年和去年同期对比',
      intent: { metrics: ['revenue'], dimensions: ['region'], filters: ['同比对比'] },
    })
    expect(result.some(c => c.chartType === 'combo')).toBe(true)
  })

  it('recommends bar for top-n question', () => {
    const result = recommendCharts({
      columns: baseColumns, sampleRows,
      question: '本月 Top 10 客户',
      intent: { metrics: ['revenue'], dimensions: ['region'], filters: ['Top 10'] },
    })
    expect(result.some(c => c.chartType === 'bar')).toBe(true)
  })

  it('recommends table for detail request', () => {
    const result = recommendCharts({
      columns: baseColumns, sampleRows,
      question: '查看明细数据',
      intent: { metrics: ['revenue'], dimensions: ['region'], filters: ['明细'] },
    })
    expect(result.some(c => c.chartType === 'table')).toBe(true)
  })

  it('returns at most 4 charts', () => {
    const result = recommendCharts({
      columns: baseColumns, sampleRows,
      question: '今年同比对比 Top 10 明细',
      intent: { metrics: ['revenue', 'count'], dimensions: ['region', 'month'], filters: ['同比对比', 'Top 10', '明细'], timeRange: '同比' },
    })
    expect(result.length).toBeLessThanOrEqual(4)
  })

  it('always returns at least 1 chart', () => {
    const result = recommendCharts({
      columns: ['x'], sampleRows: [['a']],
      question: '随便看看',
      intent: { metrics: [], dimensions: [], filters: [] },
    })
    expect(result.length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 3: Create scenario files. Each exports `RESPONSE` (without chartSuggestions), `CHART_DATA`, and `INTENT_INFO` for recommendCharts.**

Create `scenarios/revenueByRegion.ts` (without hardcoded chartSuggestions — recommendCharts generates them):

```typescript
// frontend/src/api/aiAsk/scenarios/revenueByRegion.ts
import type { AiAskResponse } from '../../../types/aiAsk'

export const INTENT_INFO = {
  metrics: ['销售额'],
  dimensions: ['区域'],
  filters: [],
  timeRange: '近 30 天',
}

export const RESPONSE: AiAskResponse = {
  question: '各区域销售额表现如何？',
  intent: INTENT_INFO,
  sqlPlan: {
    datasourceId: 2, datasourceName: 'dwhrpt',
    sql: 'SELECT r.region, SUM(r.amount) AS total_revenue\nFROM REVENUE r\nWHERE r.transaction_date >= SYSDATE - 30\nGROUP BY r.region\nORDER BY total_revenue DESC',
    tables: ['REVENUE'], fields: ['region', 'total_revenue'],
    assumptions: ['使用 SYSDATE 作为当前日期边界'],
    safetyWarnings: [],
  },
  resultSummary: { rowCount: 6, durationMs: 230, truncated: false },
  // chartSuggestions is empty here — MockAdapter.analyze() calls recommendCharts() to fill it
  chartSuggestions: [],
  narrative: {
    summary: '近 30 天各区域销售额呈梯度分布，华东以 ¥12.3M 领跑，占总销售额的 29.4%。',
    keyFindings: ['华东区域销售额 ¥12.3M，领先第二华南 25.5%', '西北+东北区域合计贡献仅 14%，提升空间大'],
    evidence: [
      { claim: '华东领先', fields: ['region', 'total_revenue'], sqlSnippet: 'SUM(r.amount) GROUP BY region' },
    ],
    risks: ['数据仅覆盖 30 天'],
    nextQuestions: ['华东区域近 6 个月趋势如何？', '各区域毛利率分布情况？'],
  },
  semanticGaps: [],
}

export const CHART_DATA = {
  columns: ['region', 'total_revenue'],
  rows: [
    ['华东', 12300000], ['华南', 9800000], ['华北', 8200000],
    ['西南', 5600000], ['西北', 3100000], ['东北', 2800000],
  ],
}

export const METRIC_CARDS = [
  { label: '总销售额', value: '¥41.8M', change: '+12.3%', changeDirection: 'up' as const, icon: 'revenue' as const },
  { label: '平均毛利率', value: '31.6%', change: '+2.1%', changeDirection: 'up' as const, icon: 'rate' as const },
  { label: '总订单数', value: '15,387', change: '-3.2%', changeDirection: 'down' as const, icon: 'orders' as const },
]
```

Similarly update `scenarios/trend.ts` (remove hardcoded chartSuggestions, use empty array + INTENT_INFO + METRIC_CARDS):

```typescript
// frontend/src/api/aiAsk/scenarios/trend.ts — INTENT_INFO, METRIC_CARDS exported, chartSuggestions: []
export const INTENT_INFO = { metrics: ['收入'], dimensions: ['月份'], filters: [], timeRange: '近 6 个月' }
export const METRIC_CARDS = [
  { label: '近 6 月总收入', value: '¥78.2M', change: '+15.6%', changeDirection: 'up' as const, icon: 'revenue' as const },
  { label: '月均收入', value: '¥13.0M', change: null, changeDirection: 'flat' as const },
  { label: '最新月收入', value: '¥16.4M', change: '+8.2%', changeDirection: 'up' as const, icon: 'profit' as const },
]
// RESPONSE.chartSuggestions: [], CHART_DATA unchanged
```

Similarly update `scenarios/topN.ts`:

```typescript
export const INTENT_INFO = { metrics: ['收入'], dimensions: ['客户'], filters: ['Top 10'], timeRange: '本月' }
export const METRIC_CARDS = [
  { label: 'Top 10 总收入', value: '¥12.5M', change: '+5.4%', changeDirection: 'up' as const, icon: 'revenue' as const },
  { label: '门槛收入', value: '¥0.8M', change: null, changeDirection: 'flat' as const, icon: 'profit' as const },
  { label: 'Top1 占比', value: '18.3%', change: '+2.1%', changeDirection: 'up' as const, icon: 'rate' as const },
]
```

Similarly update `scenarios/comparison.ts`:

```typescript
export const INTENT_INFO = { metrics: ['收入'], dimensions: ['区域', '年份'], filters: ['同比对比'], timeRange: '今年 vs 去年' }
export const METRIC_CARDS = [
  { label: '今年总收入', value: '¥41.8M', change: '+15.3%', changeDirection: 'up' as const, icon: 'revenue' as const },
  { label: '去年同期', value: '¥36.2M', change: null, changeDirection: 'flat' as const },
  { label: '增长最快区域', value: '西南 +22%', change: '+22%', changeDirection: 'up' as const, icon: 'profit' as const },
]
```

Similarly update `scenarios/default.ts`:

```typescript
export const INTENT_INFO = { metrics: ['销售额', '订单数'], dimensions: ['区域'], filters: [] }
export const METRIC_CARDS = [
  { label: '总销售额', value: '¥41.8M', icon: 'revenue' as const },
  { label: '总订单', value: '15,387', icon: 'orders' as const },
]
```

Create `scenarios/index.ts` (updated to export INTENT_INFO and METRIC_CARDS):

```typescript
// frontend/src/api/aiAsk/scenarios/index.ts
import type { AiAskResponse } from '../../../types/aiAsk'
import type { MetricCard } from '../../../types/aiAsk'
import { RESPONSE as REV_RESP, CHART_DATA as REV_DATA, INTENT_INFO as REV_INTENT, METRIC_CARDS as REV_MC } from './revenueByRegion'
import { RESPONSE as TREND_RESP, CHART_DATA as TREND_DATA, INTENT_INFO as TREND_INTENT, METRIC_CARDS as TREND_MC } from './trend'
import { RESPONSE as TOPN_RESP, CHART_DATA as TOPN_DATA, INTENT_INFO as TOPN_INTENT, METRIC_CARDS as TOPN_MC } from './topN'
import { RESPONSE as COMP_RESP, CHART_DATA as COMP_DATA, INTENT_INFO as COMP_INTENT, METRIC_CARDS as COMP_MC } from './comparison'
import { RESPONSE as DEF_RESP, CHART_DATA as DEF_DATA, INTENT_INFO as DEF_INTENT, METRIC_CARDS as DEF_MC } from './default'

export interface MockScenario {
  id: string
  match: RegExp
  response: AiAskResponse
  chartData: { columns: string[]; rows: any[][] }
  intentInfo: { metrics: string[]; dimensions: string[]; filters: string[]; timeRange?: string }
  metricCards: MetricCard[]
  description: string
}

export const MOCK_SCENARIOS: MockScenario[] = [
  {
    id: 'revenue-by-region',
    match: /(区域|地区|各省|区域).*(销售|收入|营收)/i,
    response: REV_RESP,
    chartData: REV_DATA,
    intentInfo: REV_INTENT,
    metricCards: REV_MC,
    description: '各区域销售额',
  },
  {
    id: 'trend-over-time',
    match: /(趋势|走势|月度|季度|月度变化|环比|逐月)/i,
    response: TREND_RESP,
    chartData: TREND_DATA,
    intentInfo: TREND_INTENT,
    metricCards: TREND_MC,
    description: '时间趋势分析',
  },
  {
    id: 'top-n',
    match: /(top|排名|前|排行|最高|最多|前十|前五)/i,
    response: TOPN_RESP,
    chartData: TOPN_DATA,
    intentInfo: TOPN_INTENT,
    metricCards: TOPN_MC,
    description: 'Top-N 排名',
  },
  {
    id: 'comparison',
    match: /(对比|比较|同比|vs|versus|去年|去年同期)/i,
    response: COMP_RESP,
    chartData: COMP_DATA,
    intentInfo: COMP_INTENT,
    metricCards: COMP_MC,
    description: '对比分析',
  },
  {
    id: 'default',
    match: /.*/,
    response: DEF_RESP,
    chartData: DEF_DATA,
    intentInfo: DEF_INTENT,
    metricCards: DEF_MC,
    description: '通用分析',
  },
]
```

- [ ] **Step 4: Update `mockAdapter.ts`** — integrate recommendCharts into analyze()

```typescript
// frontend/src/api/aiAsk/mockAdapter.ts
import type { AiAskAdapter, AiAskContext, ChartDataResult } from './adapter'
import type { AiAskResponse, AiChartSpec } from '../../types/aiAsk'
import { AiAskError } from './errors'
import { validateAiAskResponse } from './validator'
import { MOCK_SCENARIOS } from './scenarios'
import type { MockScenario } from './scenarios'
import { recommendCharts } from './recommendation'

export class MockAdapter implements AiAskAdapter {
  readonly name = 'MockAdapter'

  private constructor() {}

  static create(): MockAdapter {
    return new MockAdapter()
  }

  private matchScenario(question: string): MockScenario {
    for (const scenario of MOCK_SCENARIOS) {
      if (scenario.match.test(question)) {
        return scenario
      }
    }
    return MOCK_SCENARIOS[MOCK_SCENARIOS.length - 1] // default
  }

  async analyze(question: string, context: AiAskContext): Promise<AiAskResponse> {
    const { mockDelay, mockFailureRate } = context.options ?? {}

    // simulated delay
    if (mockDelay !== undefined) {
      const [min, max] = mockDelay
      const delay = min + Math.random() * (max - min)
      await new Promise((r) => setTimeout(r, delay))
    } else {
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 900))
    }

    // simulate failure
    if (mockFailureRate !== undefined && Math.random() < mockFailureRate) {
      throw new AiAskError('模拟分析超时', 'ANALYSIS_TIMEOUT')
    }

    const scenario = this.matchScenario(question)

    // Build response with question override
    const response: AiAskResponse = {
      ...scenario.response,
      question,
      sqlPlan: {
        ...scenario.response.sqlPlan,
        ...(context.datasourceId ? { datasourceId: context.datasourceId } : {}),
        ...(context.datasourceName ? { datasourceName: context.datasourceName } : {}),
      },
    }

    // --- recommendCharts integration ---
    // Use rule-based recommendation to generate dynamic chartSuggestions.
    // Different questions → different scenarios → different intentInfo → different chart types.
    const recommended = recommendCharts({
      columns: scenario.chartData.columns,
      sampleRows: scenario.chartData.rows.slice(0, 5),
      question,
      intent: scenario.intentInfo,
    })

    // Append metric-card as the last chart suggestion (if scenario has metricCards)
    if (scenario.metricCards && scenario.metricCards.length > 0) {
      recommended.push({
        title: '核心指标',
        chartType: 'metric-card',
        yFields: [],
        metricCards: scenario.metricCards as any,
        rationale: '核心经营指标一览',
        limitations: [],
      })
    }

    response.chartSuggestions = recommended

    // validate
    const validation = validateAiAskResponse(response)
    if (!validation.valid) {
      throw new AiAskError('Mock adapter produced invalid response', 'INVALID_RESPONSE', {
        errors: validation.errors,
      })
    }

    return response
  }

  getChartData(spec: AiChartSpec, response: AiAskResponse): ChartDataResult {
    const scenario = this.matchScenario(response.question)

    // Check if spec yFields match chart data columns
    const allFields = new Set(scenario.chartData.columns)
    const hasMatchingFields = spec.yFields.some((f) => allFields.has(f))

    if (!hasMatchingFields) {
      return {
        columns: scenario.chartData.columns,
        rows: scenario.chartData.rows,
        isEmpty: scenario.chartData.rows.length === 0,
      }
    }

    return {
      columns: scenario.chartData.columns,
      rows: scenario.chartData.rows,
      isEmpty: scenario.chartData.rows.length === 0,
    }
  }

  isAvailable(): boolean {
    return true
  }
}
```

- [ ] **Step 3: Create `mockAdapter.test.ts`**

```typescript
// frontend/src/api/aiAsk/mockAdapter.test.ts
import { describe, it, expect } from 'vitest'
import { MockAdapter } from './mockAdapter'

describe('MockAdapter', () => {
  const adapter = MockAdapter.create()

  it('returns name', () => {
    expect(adapter.name).toBe('MockAdapter')
  })

  it('isAvailable returns true', () => {
    expect(adapter.isAvailable()).toBe(true)
  })

  it('matches revenue scenario — recommendCharts generates bar + pie', async () => {
    const resp = await adapter.analyze('各区域销售额是多少', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    // recommendCharts should generate bar (from rule 4: single dim + metric)
    expect(resp.chartSuggestions.length).toBeGreaterThanOrEqual(1)
    expect(resp.chartSuggestions.some(s => s.chartType === 'bar')).toBe(true)
    expect(resp.resultSummary).toBeDefined()
  })

  it('matches trend scenario — recommendCharts generates line', async () => {
    const resp = await adapter.analyze('近 6 个月收入趋势', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    // recommendCharts should generate line (from rule 2: time dimension)
    expect(resp.chartSuggestions.some(s => s.chartType === 'line')).toBe(true)
  })

  it('matches top-n scenario — recommendCharts generates bar (sorted)', async () => {
    const resp = await adapter.analyze('本月收入 Top 10', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    // recommendCharts should generate bar (from rule 3: rank intent)
    expect(resp.chartSuggestions.some(s => s.chartType === 'bar')).toBe(true)
  })

  it('matches comparison scenario — recommendCharts generates combo', async () => {
    const resp = await adapter.analyze('今年和去年同比对比', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    // recommendCharts should generate combo (from rule 1: comparison)
    expect(resp.chartSuggestions.some(s => s.chartType === 'combo')).toBe(true)
  })

  it('falls back to default scenario for unknown question', async () => {
    const resp = await adapter.analyze('随便看看', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    expect(resp).toBeDefined()
  })

  it('scenario-specific chartSuggestions differ between questions', async () => {
    const revenueResp = await adapter.analyze('各区域销售额', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    const trendResp = await adapter.analyze('近 6 个月收入趋势', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    // Different questions → different scenario → different chart types
    const revenueTypes = revenueResp.chartSuggestions.map(s => s.chartType)
    const trendTypes = trendResp.chartSuggestions.map(s => s.chartType)
    expect(revenueTypes).not.toEqual(trendTypes)
  })

  it('injects datasourceId/Name from context', async () => {
    const resp = await adapter.analyze('各区域销售额', {
      datasourceId: 3, datasourceName: 'test_ds', selectedTables: [],
    })
    expect(resp.sqlPlan.datasourceId).toBe(3)
    expect(resp.sqlPlan.datasourceName).toBe('test_ds')
  })

  it('getChartData returns non-empty result for matching scenario', async () => {
    const resp = await adapter.analyze('各区域销售额', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    const data = adapter.getChartData(resp.chartSuggestions[0], resp)
    expect(data.isEmpty).toBe(false)
    expect(data.columns.length).toBeGreaterThan(0)
  })

  it('recommendCharts adds metric-card suggestion at end', async () => {
    const resp = await adapter.analyze('各区域销售额', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    const lastChart = resp.chartSuggestions[resp.chartSuggestions.length - 1]
    expect(lastChart.chartType).toBe('metric-card')
  })
})
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run api/aiAsk/mockAdapter.test.ts -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Delete old `api/aiAsk.mock.ts`, update all imports**

The old file `frontend/src/api/aiAsk.mock.ts` is now replaced by the scenarios. We will delete it when AskWorkbenchPage is updated (Task 3), to avoid breaking builds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/aiAsk/mockAdapter.ts frontend/src/api/aiAsk/mockAdapter.test.ts frontend/src/api/aiAsk/recommendation.ts frontend/src/api/aiAsk/recommendation.test.ts frontend/src/api/aiAsk/scenarios/
git commit -m "feat(phase-5g.1): add MockAdapter with recommendCharts integration + 5 scenarios"
```

---

### Task 3: 更新 aiAskStore + 集成到 AskWorkbenchPage

**Files:**
- Modify: `frontend/src/stores/aiAskStore.ts`
- Modify: `frontend/src/pages/AskWorkbenchPage.tsx`
- Delete: `frontend/src/api/aiAsk.mock.ts`
- Create: `frontend/src/stores/aiAskStore.test.ts` (更新)
- Create: `frontend/src/pages/AskWorkbenchPage.test.tsx` (更新)

**Interfaces:**
- Consumes: `AiAskAdapter`, `AiAskError` from `api/aiAsk/index.ts`
- Produces: Updated `aiAskStore` with `adapterName`, `error`, `validation`, `analysisStep`, `isExecuting`

- [ ] **Step 1: Update `stores/aiAskStore.ts`**

新增适配器相关状态和步骤指示器：

```typescript
// frontend/src/stores/aiAskStore.ts
import { create } from 'zustand'
import type { AiAskResponse } from '../types/aiAsk'
import type { ValidationResult } from '../api/aiAsk/validator'
import type { AiAskError } from '../api/aiAsk/errors'

interface AiAskStore {
  // 数据范围
  datasourceId: number | null
  datasourceName: string | null
  selectedTables: string[]

  // 当前轮次结果
  currentResponse: AiAskResponse | null
  isAnalyzing: boolean
  isExecuting: boolean
  activeChartIndex: number
  analysisStep: number          // 0=idle, 1=理解意图, 2=生成SQL, 3=执行查询, 4=生成图表, 5=生成解读

  // 5G.1 新增
  adapterName: string
  responseValidation: ValidationResult | null
  error: AiAskError | null

  // 历史轮次产物
  responseHistory: Record<number, AiAskResponse>

  // Actions
  setDatasource: (id: number | null, name: string | null) => void
  setSelectedTables: (tables: string[]) => void
  setCurrentResponse: (resp: AiAskResponse | null) => void
  setAnalyzing: (v: boolean) => void
  setExecuting: (v: boolean) => void
  setActiveChart: (index: number) => void
  setAnalysisStep: (step: number) => void
  setAdapterName: (name: string) => void
  setResponseValidation: (v: ValidationResult | null) => void
  setError: (error: AiAskError | null) => void
  clearError: () => void
  saveResponseForMessage: (messageId: number, resp: AiAskResponse) => void
  getResponseForMessage: (messageId: number) => AiAskResponse | undefined
  reset: () => void
}

export const useAiAskStore = create<AiAskStore>((set, get) => ({
  datasourceId: null,
  datasourceName: null,
  selectedTables: [],
  currentResponse: null,
  isAnalyzing: false,
  isExecuting: false,
  activeChartIndex: 0,
  analysisStep: 0,

  adapterName: 'MockAdapter',
  responseValidation: null,
  error: null,

  responseHistory: {},

  setDatasource: (id, name) => set({ datasourceId: id, datasourceName: name }),
  setSelectedTables: (tables) => set({ selectedTables: tables }),
  setCurrentResponse: (resp) => set({ currentResponse: resp, activeChartIndex: 0 }),
  setAnalyzing: (v) => set({ isAnalyzing: v, analysisStep: v ? 1 : 0 }),
  setExecuting: (v) => set({ isExecuting: v }),
  setActiveChart: (index) => set({ activeChartIndex: index }),
  setAnalysisStep: (step) => set({ analysisStep: step }),
  setAdapterName: (name) => set({ adapterName: name }),
  setResponseValidation: (v) => set({ responseValidation: v }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
  saveResponseForMessage: (messageId, resp) =>
    set((state) => ({
      responseHistory: { ...state.responseHistory, [messageId]: resp },
    })),
  getResponseForMessage: (messageId) => get().responseHistory[messageId],
  reset: () =>
    set({
      datasourceId: null,
      datasourceName: null,
      selectedTables: [],
      currentResponse: null,
      isAnalyzing: false,
      isExecuting: false,
      activeChartIndex: 0,
      analysisStep: 0,
      adapterName: 'MockAdapter',
      responseValidation: null,
      error: null,
    }),
}))
```

- [ ] **Step 2: Update `stores/aiAskStore.test.ts`** — remove dependency on old `aiAsk.mock.ts`, use inline mock

```typescript
// frontend/src/stores/aiAskStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useAiAskStore } from './aiAskStore'

// Use a minimal inline mock — NOT from aiAsk.mock.ts (will be deleted)
const MOCK_RESPONSE = {
  question: 'test', intent: { metrics: [], dimensions: [], filters: [], timeRange: undefined },
  sqlPlan: { datasourceId: 0, datasourceName: '', sql: '', tables: [], fields: [], assumptions: [], safetyWarnings: [] },
  chartSuggestions: [], narrative: { summary: '', keyFindings: [], evidence: [], risks: [], nextQuestions: [] },
  semanticGaps: [],
}

describe('aiAskStore', () => {
  beforeEach(() => {
    useAiAskStore.setState(useAiAskStore.getInitialState())
  })

  it('has new 5G fields with defaults', () => {
    const state = useAiAskStore.getState()
    expect(state.adapterName).toBe('MockAdapter')
    expect(state.analysisStep).toBe(0)
    expect(state.error).toBeNull()
    expect(state.responseValidation).toBeNull()
    expect(state.isExecuting).toBe(false)
  })

  it('setAnalysisStep updates step', () => {
    useAiAskStore.getState().setAnalysisStep(3)
    expect(useAiAskStore.getState().analysisStep).toBe(3)
  })

  it('setAdapterName updates name', () => {
    useAiAskStore.getState().setAdapterName('FutureLlm')
    expect(useAiAskStore.getState().adapterName).toBe('FutureLlm')
  })

  it('setError and clearError work', () => {
    const err = new Error('test') as any
    useAiAskStore.getState().setError(err)
    expect(useAiAskStore.getState().error).toBe(err)
    useAiAskStore.getState().clearError()
    expect(useAiAskStore.getState().error).toBeNull()
  })

  it('should set datasource', () => {
    useAiAskStore.getState().setDatasource(2, 'dwhrpt')
    expect(useAiAskStore.getState().datasourceId).toBe(2)
  })

  it('should set current response and reset chart index', () => {
    useAiAskStore.getState().setCurrentResponse(MOCK_RESPONSE as any)
    expect(useAiAskStore.getState().currentResponse?.question).toBe('test')
    expect(useAiAskStore.getState().activeChartIndex).toBe(0)
  })

  it('should reset to initial state', () => {
    useAiAskStore.getState().setDatasource(2, 'dwhrpt')
    useAiAskStore.getState().setCurrentResponse(MOCK_RESPONSE as any)
    useAiAskStore.getState().reset()
    const state = useAiAskStore.getState()
    expect(state.datasourceId).toBeNull()
    expect(state.currentResponse).toBeNull()
    expect(state.analysisStep).toBe(0)
  })
})
```

- [ ] **Step 3: Update `AskWorkbenchPage.tsx` to use `useAiAskService`**

```tsx
// Key changes in AskWorkbenchPage.tsx:
// 1. Replace `import { MOCK_ASK_RESPONSE, MOCK_CHART_DATA } from '../api/aiAsk.mock'`
//    with `import { useAiAskService } from '../api/aiAsk'`
// 2. Replace `const simulateAiAnalysis = ...` with adapter.analyze() call
// 3. Add validation step after analyze
// 4. Add error handling with AiAskError
// 5. Keep MOCK_CHART_DATA usage temporarily (remove in Task 6 when Ant Table is added)

import React, { useCallback, useRef } from 'react'
import { Layout, Typography, Spin, message, Alert, Button, Space } from 'antd'
import { ClearOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import SessionList from '../components/SessionList'
import MessageThread from '../components/MessageThread'
import AgentNav from '../components/AgentNav'
import DataScopeSelector from '../components/DataScopeSelector'
import PromptCards from '../components/PromptCards'
import AskInput from '../components/AskInput'
import IntentCard from '../components/IntentCard'
import SqlPlan from '../components/SqlPlan'
import AiChartBoard from '../components/AiChartBoard'
import AiNarrative from '../components/AiNarrative'
import SemanticGapAlert from '../components/SemanticGapAlert'
import { useAskMessages, useCreateMessage, useCreateSession } from '../api/askSessions'
import { useAskStore } from '../stores/askStore'
import { useAiAskStore } from '../stores/aiAskStore'
import { useAiAskService, AiAskError, getAiAskErrorMessage } from '../api/aiAsk'

const { Sider, Content } = Layout

const AskWorkbenchPage: React.FC = () => {
  const currentSessionId = useAskStore((s) => s.currentSessionId)
  const setCurrentSession = useAskStore((s) => s.setCurrentSession)
  const createMessage = useCreateMessage()
  const createSession = useCreateSession()
  const navigate = useNavigate()

  const { data: messages, isLoading: messagesLoading } = useAskMessages(currentSessionId)

  const {
    datasourceId,
    datasourceName,
    selectedTables,
    currentResponse,
    isAnalyzing,
    error: storeError,
    activeChartIndex,
    analysisStep,
    setCurrentResponse,
    setAnalyzing,
    setActiveChart,
    setAnalysisStep,
    setAdapterName,
    setResponseValidation,
    setError,
    clearError,
  } = useAiAskStore()

  const adapter = useAiAskService()
  const chartDataRef = useRef<{ columns: string[]; rows: any[][] } | null>(null)

  const handleSend = useCallback(async (content: string) => {
    let sessionId = currentSessionId
    if (!sessionId) {
      try {
        const newSession = await createSession.mutateAsync({})
        sessionId = newSession.id
        setCurrentSession(sessionId)
      } catch {
        message.error('创建会话失败，请重试')
        return
      }
    }

    try {
      await createMessage.mutateAsync({ sessionId, content })
    } catch {
      message.error('发送失败，请重试')
      return
    }

    // Use adapter
    clearError()
    setAdapterName(adapter.name)
    setAnalyzing(true)
    setAnalysisStep(1)

    try {
      // Simulate step progression
      const stepInterval = setInterval(() => {
        const current = useAiAskStore.getState().analysisStep
        if (current < 5) {
          useAiAskStore.getState().setAnalysisStep(current + 1)
        } else {
          clearInterval(stepInterval)
        }
      }, 800)

      const resp = await adapter.analyze(content, {
        datasourceId,
        datasourceName,
        selectedTables,
        options: { mockDelay: [1500, 2500] },
      })

      clearInterval(stepInterval)
      setAnalysisStep(5)

      // Validate
      const validation = adapter.validate(resp as any)
      setResponseValidation(validation)

      // Store chart data from adapter
      chartDataRef.current = adapter.getChartData(resp.chartSuggestions[0], resp as any)

      setCurrentResponse(resp as any)
      setAnalyzing(false)
    } catch (err) {
      setAnalyzing(false)
      if (err instanceof AiAskError) {
        setError(err)
      } else {
        setError(new AiAskError('分析异常', 'UNKNOWN'))
      }
    }
  }, [
    currentSessionId, createSession, setCurrentSession,
    createMessage, datasourceId, datasourceName, selectedTables,
    adapter, clearError, setAdapterName, setAnalyzing, setAnalysisStep,
    setResponseValidation, setCurrentResponse, setError,
  ])

  // ... rest of the component remains largely the same,
  // with changes:
  // - Error state display before results
  // - analysisStep display in loading state
  // - keep MOCK_CHART_DATA reference replaced by chartDataRef

  // For now the inline table rendering (lines 286-357 of the original) 
  // will stay but reference chartDataRef instead of MOCK_CHART_DATA.
  // Full Ant Design Table migration happens in Task 6 (5G.2).

  const handleOpenInWorkbench = useCallback((sql: string, dsId: number) => {
    const encoded = encodeURIComponent(sql)
    navigate(`/sql-workbench?dsId=${dsId}&sql=${encoded}`)
  }, [navigate])

  const [agentMode] = React.useState('ask')

  const showEmptyState = !currentSessionId
  const showWelcomeState = currentSessionId && !currentResponse && !isAnalyzing && !storeError
  const showResultsState = currentSessionId && (currentResponse || isAnalyzing || storeError)

  return (
    <Layout style={{ height: 'calc(100vh - 104px)', background: '#fff' }}>
      <Sider width={220} style={{ background: '#fafafa', borderRight: '1px solid #f0f0f0', overflow: 'auto' }}>
        <div style={{ padding: '0 12px' }}>
          <DataScopeSelector />
        </div>
        <div style={{ padding: '0 12px' }}>
          <SessionList
            currentId={currentSessionId}
            onSelect={(id) => {
              setCurrentSession(id || null)
              if (!id) setCurrentResponse(null)
            }}
          />
        </div>
      </Sider>

      <Content style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', padding: '0 24px' }}>
          <AgentNav activeKey={agentMode} onChange={() => {}} />
        </div>

        {showEmptyState && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
          }}>
            <ClearOutlined style={{ fontSize: 48, color: '#d9d9d9', marginBottom: 16 }} />
            <Typography.Title level={4} type="secondary">选择或创建一个对话开始提问</Typography.Title>
            <Typography.Text type="secondary">左侧列表管理你的所有对话历史</Typography.Text>
          </div>
        )}

        {showWelcomeState && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', padding: '16px 24px' }}>
            {messages && <MessageThread messages={messages ?? []} isLoading={messagesLoading} />}
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '40px 60px',
            }}>
              <div style={{ maxWidth: 680, width: '100%', margin: '0 auto' }}>
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                  <Typography.Title level={3} style={{ marginBottom: 8, color: '#262626', fontWeight: 600 }}>
                    MetricForge 智能问数
                  </Typography.Title>
                  <Typography.Text style={{ display: 'block', color: '#8c8c8c', fontSize: 14, lineHeight: 1.6 }}>
                    用自然语言描述你的业务问题，AI 将自动分析数据并生成图表和报告
                  </Typography.Text>
                </div>
                <div style={{
                  background: '#fafafa', borderRadius: 12, padding: '20px 24px 16px', marginBottom: 24,
                  border: '1px solid #f0f0f0',
                }}>
                  <AskInput onSend={handleSend} loading={createMessage.isPending || createSession.isPending} autoFocus />
                </div>
                <PromptCards onSelect={handleSend} />
              </div>
            </div>
          </div>
        )}

        {showResultsState && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
              {messages && <MessageThread messages={messages ?? []} isLoading={messagesLoading} />}

              {/* Error state */}
              {storeError && !isAnalyzing && (
                <Alert
                  type="error"
                  showIcon
                  style={{ borderRadius: 8, marginBottom: 12 }}
                  message={
                    <div>
                      <div style={{ fontWeight: 500, marginBottom: 4 }}>分析异常</div>
                      <div style={{ fontSize: 12 }}>{getAiAskErrorMessage(storeError.code)}</div>
                      {storeError.code && (
                        <Space style={{ marginTop: 6 }}>
                          <Button size="small" icon={<ReloadOutlined />} onClick={() => clearError()}>关闭</Button>
                        </Space>
                      )}
                    </div>
                  }
                />
              )}

              {/* Analyzing with skeleton + step indicator */}
              {isAnalyzing && (
                <div style={{ padding: '20px 24px', textAlign: 'center' }}>
                  <div style={{
                    display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 16,
                  }}>
                    {[1, 2, 3].map((i) => (
                      <div key={i} style={{
                        width: 100, height: 60, borderRadius: 8,
                        background: '#f0f0f0', animation: 'pulse 1.5s ease-in-out infinite',
                      }} />
                    ))}
                  </div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                    正在分析你的问题...
                  </Typography.Text>
                  <div style={{ maxWidth: 320, margin: '0 auto', textAlign: 'left' }}>
                    {[
                      'AI 正在理解你的问题',
                      '正在分析查询计划',
                      '正在获取数据',
                      '正在生成图表',
                      '正在生成解读摘要',
                    ].map((label, i) => {
                      const stepNum = i + 1
                      let icon = '◻'
                      let color = '#d9d9d9'
                      if (stepNum < analysisStep) { icon = '✅'; color = '#52c41a' }
                      else if (stepNum === analysisStep) { icon = '⟳'; color = '#4E7BF5' }
                      return (
                        <div key={i} style={{
                          fontSize: 12, color, padding: '4px 0', display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                          <span>{icon}</span>
                          <span>{label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* AI results */}
              {currentResponse && !isAnalyzing && (
                <div>
                  <IntentCard intent={currentResponse.intent} semanticGaps={currentResponse.semanticGaps} />
                  {currentResponse.semanticGaps.filter((g) => g.reason === 'not_found').length > 0 && (
                    <SemanticGapAlert gaps={currentResponse.semanticGaps} />
                  )}
                  <SqlPlan sqlPlan={currentResponse.sqlPlan} onOpenInWorkbench={handleOpenInWorkbench} />
                  
                  {/* Result table - using chartDataRef or fallback */}
                  {currentResponse.resultSummary && chartDataRef.current && (
                    <div style={{
                      marginBottom: 12, padding: '8px 12px', background: '#fafafa',
                      borderRadius: 8, border: '1px solid #f0f0f0',
                    }}>
                      <Typography.Text strong style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 8 }}>
                        查询结果（{currentResponse.resultSummary.rowCount} 行 · {currentResponse.resultSummary.durationMs}ms）
                      </Typography.Text>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ background: '#f5f5f5' }}>
                            {chartDataRef.current.columns.map((col) => (
                              <th key={col} style={{
                                padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid #e8e8e8',
                                fontWeight: 500, fontSize: 12, color: '#666',
                              }}>{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {chartDataRef.current.rows.map((row, ri) => (
                            <tr key={ri}>
                              {row.map((cell: any, ci) => (
                                <td key={ci} style={{
                                  padding: '6px 10px', borderBottom: '1px solid #f0f0f0', fontSize: 12,
                                  textAlign: typeof cell === 'number' ? 'right' : 'left',
                                }}>
                                  {typeof cell === 'number' ? cell.toLocaleString() : cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {currentResponse.chartSuggestions.length > 0 && (
                    <AiChartBoard
                      chartSuggestions={currentResponse.chartSuggestions}
                      columns={chartDataRef.current?.columns ?? []}
                      rows={chartDataRef.current?.rows ?? []}
                      activeIndex={activeChartIndex}
                      onActiveChange={setActiveChart}
                    />
                  )}

                  <AiNarrative narrative={currentResponse.narrative} onAskQuestion={handleSend} />
                </div>
              )}
            </div>

            <div style={{ borderTop: '1px solid #f0f0f0', padding: '12px 24px', background: '#fff' }}>
              <AskInput onSend={handleSend} loading={isAnalyzing} />
            </div>
          </div>
        )}
      </Content>
    </Layout>
  )
}

export default AskWorkbenchPage
```

Note: The test file `AskWorkbenchPage.test.tsx` will need updates too, but since the page still works the same way from the outside (same props, same exports), the existing tests should mostly pass. We'll update the test in a subsequent step after confirming.

- [ ] **Step 4: Delete `api/aiAsk.mock.ts`** — old single-file mock, replaced by scenarios + MockAdapter

Run `git rm` to delete and verify no remaining imports:
```bash
git rm frontend/src/api/aiAsk.mock.ts
```

- [ ] **Step 5: Verify no remaining references to old mock file**

Run:
```bash
cd frontend && rg "aiAsk\.mock|MOCK_ASK_RESPONSE|MOCK_CHART_DATA" src/ --type ts --type tsx || echo "CLEAN: no remaining references"
```
Expected: No matches (exit code 1 from rg = no matches found = CLEAN)

- [ ] **Step 6: Run all tests + type check**

Run: `cd frontend && npx vitest run -v`
Expected: ALL PASS (no imports from deleted aiAsk.mock.ts)

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/stores/aiAskStore.ts frontend/src/stores/aiAskStore.test.ts frontend/src/pages/AskWorkbenchPage.tsx
git rm frontend/src/api/aiAsk.mock.ts
git commit -m "feat(phase-5g.1): integrate AiAskAdapter into aiAskStore and AskWorkbenchPage, add analysisStep skeleton"
```

---

**Phase 5G.1 Boundary:** All 5G.1 tasks complete. At this point:
- `api/aiAsk/adapter.ts` defines the adapter interface
- `api/aiAsk/mockAdapter.ts` provides scenario-based mock with **recommendCharts() integrated into analyze()**
- `api/aiAsk/recommendation.ts` provides rule-based chart recommendation (called internally by MockAdapter)
- `api/aiAsk/validator.ts` validates AiAskResponse structure
- `api/aiAsk/errors.ts` provides typed error handling
- `stores/aiAskStore.ts` has adapterName, error, validation, analysisStep, isExecuting
- `pages/AskWorkbenchPage.tsx` uses adapter instead of direct MOCK_ASK_RESPONSE
- `api/aiAsk.mock.ts` is deleted (git rm), verified with `rg "aiAsk.mock|MOCK_ASK_RESPONSE" src/` — no remaining references
- **recommendCharts is NOT standalone:** every scenario calls recommendCharts → different questions yield different chartSuggestions → AiChartBoard shows differentiated recommendations

**Phase 5G.2 does not start until 5G.1 is fully verified (tests + tsc + build).**

---

## Phase 5G.2：A-MVP 图表美化与自动推荐增强

### Task 4: 数值格式化工具 + MetricCard icon 支持

**Files:**
- Create: `frontend/src/utils/numberFormat.ts`
- Create: `frontend/src/utils/numberFormat.test.ts`
- Modify: `frontend/src/types/aiAsk.ts`

**Interfaces:**
- Consumes: none
- Produces: `formatCompact()`, `formatPercent()`, `formatCurrency()`, `formatMetricValue()`, `detectFormat()`, `MetricCard.icon` field

- [ ] **Step 1: Create `utils/numberFormat.ts`**

```typescript
// frontend/src/utils/numberFormat.ts

export type MetricFormat = 'number' | 'currency' | 'percent' | 'compact'

/**
 * Format large numbers compactly: 1234567 → '1.2M'
 */
export function formatCompact(value: number, decimals: number = 1): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return (value / 1_000_000_000).toFixed(decimals) + 'B'
  }
  if (Math.abs(value) >= 1_000_000) {
    return (value / 1_000_000).toFixed(decimals) + 'M'
  }
  if (Math.abs(value) >= 10_000) {
    return (value / 1_000).toFixed(decimals) + 'K'
  }
  return value.toLocaleString()
}

/**
 * Format as percentage: 0.325 → '32.5%'
 */
export function formatPercent(value: number, decimals: number = 1): string {
  const percent = Math.abs(value) < 1 && value !== 0 ? value * 100 : value
  return percent.toFixed(decimals) + '%'
}

/**
 * Format as currency: 1234567 → '¥1.2M'
 */
export function formatCurrency(value: number, decimals: number = 1): string {
  return '¥' + formatCompact(value, decimals)
}

/**
 * Format a value with thousand separators: 1234567 → '1,234,567'
 */
export function formatThousand(value: number): string {
  return value.toLocaleString()
}

/**
 * Detect the most appropriate format for a set of values.
 * - If all values are between 0 and 1 (exclusive), assume percentage
 * - If labels include currency-related keywords, assume currency
 * - Otherwise use compact
 */
export function detectFormat(values: number[], labels?: string[]): MetricFormat {
  if (values.length === 0) return 'compact'
  const allFractions = values.every((v) => v > 0 && v < 1)
  if (allFractions) return 'percent'

  if (labels) {
    const labelText = labels.join(' ').toLowerCase()
    if (/revenue|sales|income|amount|revenue|profit|cost|￥|¥|usd|cny|eur/i.test(labelText)) {
      return 'currency'
    }
    if (/rate|ratio|margin|percent|%|rate/i.test(labelText)) {
      return 'percent'
    }
  }

  return 'compact'
}

/**
 * Smart metric value formatter.
 * Guesses format from value magnitude and optional label.
 */
export function formatMetricValue(value: number, format?: MetricFormat, label?: string): string {
  if (format) {
    switch (format) {
      case 'currency': return formatCurrency(value)
      case 'percent': return formatPercent(value)
      case 'compact': return formatCompact(value)
      case 'number': return formatThousand(value)
    }
  }

  // Auto-detect
  if (label) {
    const detected = detectFormat([value], [label])
    return formatMetricValue(value, detected)
  }

  if (value > 0 && value < 1) return formatPercent(value)
  if (Math.abs(value) >= 10_000) return formatCompact(value)
  return formatThousand(value)
}
```

- [ ] **Step 2: Create `utils/numberFormat.test.ts`**

```typescript
// frontend/src/utils/numberFormat.test.ts
import { describe, it, expect } from 'vitest'
import { formatCompact, formatPercent, formatCurrency, formatThousand, detectFormat, formatMetricValue } from './numberFormat'

describe('numberFormat', () => {
  describe('formatCompact', () => {
    it('formats billions', () => expect(formatCompact(1_500_000_000)).toBe('1.5B'))
    it('formats millions', () => expect(formatCompact(12_300_000)).toBe('12.3M'))
    it('formats thousands', () => expect(formatCompact(15_387)).toBe('15.4K'))
    it('keeps small numbers', () => expect(formatCompact(999)).toBe('999'))
  })

  describe('formatPercent', () => {
    it('formats 0.325 as 32.5%', () => expect(formatPercent(0.325)).toBe('32.5%'))
    it('formats 32.5 as 32.5%', () => expect(formatPercent(32.5)).toBe('32.5%'))
  })

  describe('formatCurrency', () => {
    it('formats with ¥ prefix', () => expect(formatCurrency(12_300_000)).toBe('¥12.3M'))
    it('formats small amount', () => expect(formatCurrency(500)).toBe('¥500.0'))
  })

  describe('formatThousand', () => {
    it('adds thousand separators', () => expect(formatThousand(1234567)).toBe('1,234,567'))
  })

  describe('detectFormat', () => {
    it('detects percent for 0-1 values', () => expect(detectFormat([0.32, 0.5])).toBe('percent'))
    it('detects currency for labels with revenue', () => expect(detectFormat([100], ['sales revenue'])).toBe('currency'))
    it('defaults to compact', () => expect(detectFormat([100, 200])).toBe('compact'))
  })

  describe('formatMetricValue', () => {
    it('uses detected format from label', () => {
      expect(formatMetricValue(12_300_000, undefined, 'total_revenue')).toBe('¥12.3M')
    })
    it('explicit format overrides detection', () => {
      expect(formatMetricValue(0.325, 'percent')).toBe('32.5%')
    })
  })
})
```

- [ ] **Step 3: Update `types/aiAsk.ts` — add icon to MetricCard**

```typescript
// Add after MetricCard interface (line 8-13 in existing file):
export type MetricIcon = 'revenue' | 'orders' | 'customers' | 'profit' | 'rate'

export interface MetricCard {
  label: string
  value: string
  change?: string
  changeDirection?: 'up' | 'down' | 'flat'
  icon?: MetricIcon    // 5G 新增：可选图标 key
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run utils/numberFormat.test.ts -v`
Expected: PASS (at least 10 tests)

- [ ] **Step 5: Type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add frontend/src/utils/numberFormat.ts frontend/src/utils/numberFormat.test.ts frontend/src/types/aiAsk.ts
git commit -m "feat(phase-5g.2): add numberFormat utils and MetricCard.icon field"
```

---

### Task 5: ChartCanvas — combo + 多 yFields + 数据标签 + tooltip/legend 增强

**Files:**
- Modify: `frontend/src/components/ChartCanvas.tsx`
- Modify: `frontend/src/utils/chartData.ts`
- Modify: `frontend/src/styles/chartThemes.ts`
- Modify: `frontend/src/components/ChartCanvas.test.tsx`

**Interfaces:**
- Consumes: `AiChartSpec`, `AggregatedResult` from utils/chartData, `ChartThemeConfig`, `getSeriesColor` from chartThemes
- Produces: ChartCanvas supports bar (multi yField grouped), line (multi yField), pie, combo (bar+line dual axis), data labels, enhanced tooltip/legend

- [ ] **Step 1: Add `getSeriesColor` to `styles/chartThemes.ts`**

```typescript
// Add to chartThemes.ts after getTheme function:

/**
 * Get series color with interval strategy to avoid adjacent color conflict.
 * When series count > palette length, alternate by stepping index to maintain contrast.
 */
export function getSeriesColor(index: number, palette: string[]): string {
  const len = palette.length
  if (len === 0) return '#4E7BF5'
  // Alternate stepping: for large series counts, use step of ~len/2 to maximize contrast
  if (index >= len) {
    const step = Math.max(1, Math.floor(len / 2))
    return palette[(index * step) % len]
  }
  return palette[index]
}
```

- [ ] **Step 2: Update `utils/chartData.ts` — support multi yFields aggregation**

```typescript
// Add new function after existing aggregateChartData:

export interface MultiYFieldInput {
  xColumn: string
  yFields: string[]
  columns: string[]
  rows: any[][]
}

export interface MultiYFieldResult {
  categories: string[]
  series: Array<{
    name: string
    values: number[]
  }>
  isEmpty: boolean
}

/**
 * Aggregate data for multiple yFields.
 * Each yField becomes a series with values grouped by xColumn.
 */
export function aggregateMultiYField(input: MultiYFieldInput): MultiYFieldResult {
  const { xColumn, yFields, columns, rows } = input
  const xIndex = columns.indexOf(xColumn)
  if (xIndex === -1) return { categories: [], series: [], isEmpty: true }

  const yIndices = yFields.map((f) => columns.indexOf(f)).filter((i) => i >= 0)
  if (yIndices.length === 0) return { categories: [], series: [], isEmpty: true }

  // Collect unique x values in order
  const xValues = [...new Set(rows.map((r) => String(r[xIndex] ?? '')))]
  const usedYFields = yFields.filter((_, i) => yIndices[i] >= 0)

  const series = usedYFields.map((name, si) => {
    const yi = yIndices[si]
    const values = xValues.map((xv) => {
      // Sum all rows matching this x value
      const matchingRows = rows.filter((r) => String(r[xIndex] ?? '') === xv)
      const total = matchingRows.reduce((sum, r) => {
        const v = Number(r[yi])
        return sum + (isNaN(v) ? 0 : v)
      }, 0)
      return total
    })
    return { name, values }
  })

  return {
    categories: xValues,
    series,
    isEmpty: xValues.length === 0 || series.every((s) => s.values.every((v) => v === 0)),
  }
}
```

- [ ] **Step 3: Rewrite `components/ChartCanvas.tsx`**

The full implementation of ChartCanvas with all new features:

```tsx
// frontend/src/components/ChartCanvas.tsx
import React, { useEffect, useRef, useMemo } from 'react'
import * as echartsCore from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import {
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsType } from 'echarts/core'
import type { AiChartSpec } from '../types/aiAsk'
import { getTheme, getSeriesColor } from '../styles/chartThemes'
import { aggregateChartData, aggregateMultiYField } from '../utils/chartData'
import { formatMetricValue } from '../utils/numberFormat'

echartsCore.use([
  BarChart, LineChart, PieChart,
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
  CanvasRenderer,
])

interface ChartCanvasProps {
  spec: AiChartSpec
  columns: string[]
  rows: any[][]
  width?: number
  height?: number
}

const ChartCanvas: React.FC<ChartCanvasProps> = ({ spec, columns, rows, width, height = 300 }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsType | null>(null)
  const theme = useMemo(() => getTheme(spec.theme), [spec.theme])

  useEffect(() => {
    if (!containerRef.current) return
    chartRef.current = echartsCore.init(containerRef.current, undefined, { width, height })
    return () => {
      chartRef.current?.dispose()
      chartRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    if (spec.chartType === 'metric-card' || spec.chartType === 'table') {
      chart.clear()
      return
    }

    // --- PIE ---
    if (spec.chartType === 'pie' && spec.xField) {
      const agg = aggregateChartData({
        chartType: 'pie',
        xColumn: spec.xField,
        yColumn: spec.yFields[0],
        columns, rows,
      })
      if (agg.isEmpty || !agg.pieData) {
        chart.clear()
        chart.setOption({ title: { text: '暂无数据', left: 'center', top: 'center', textStyle: { color: '#999' } } })
        return
      }
      chart.setOption({
        color: theme.palette,
        tooltip: {
          trigger: 'item',
          formatter: (params: any) => {
            const total = agg.pieData!.reduce((s: number, d: any) => s + d.value, 0)
            const idx = agg.pieData!.findIndex((d: any) => d.name === params.name)
            return `${params.seriesName}<br/><b>${params.name}</b>: ${formatMetricValue(params.value, 'compact')} (${params.percent}%)<br/><small>排名 ${idx + 1}/${agg.pieData!.length}</small>`
          },
        },
        legend: { bottom: 0, textStyle: { color: theme.textColor, fontFamily: theme.fontFamily } },
        series: [{
          type: 'pie',
          radius: ['35%', '60%'],
          center: ['50%', '45%'],
          avoidLabelOverlap: true,
          label: { show: true, formatter: '{b}: {d}%', fontFamily: theme.fontFamily },
          emphasis: { label: { show: true, fontSize: 13, fontWeight: 'bold' } },
          data: agg.pieData,
          animationDuration: 800,
          animationEasing: 'cubicOut' as any,
        }],
      })
      return
    }

    // --- COMBO (bar + line) ---
    if (spec.chartType === 'combo') {
      const multi = aggregateMultiYField({
        xColumn: spec.xField || columns[0],
        yFields: spec.yFields.length >= 2 ? spec.yFields.slice(0, 2) : [...spec.yFields, spec.yFields[0]],
        columns, rows,
      })
      if (multi.isEmpty) {
        chart.clear()
        chart.setOption({ title: { text: '暂无数据', left: 'center', top: 'center', textStyle: { color: '#999' } } })
        return
      }

      // Determine if dual-axis needed
      const values0 = multi.series[0]?.values ?? []
      const values1 = multi.series[1]?.values ?? []
      const max0 = Math.max(...values0, 1)
      const max1 = Math.max(...values1, 1)
      const needDualAxis = max0 / max1 > 5 || max1 / max0 > 5

      const yAxis: any[] = [{
        type: 'value',
        axisLabel: { color: theme.textColor, fontFamily: theme.fontFamily },
        splitLine: { lineStyle: { color: theme.axisColor } },
      }]
      if (needDualAxis) {
        yAxis.push({
          type: 'value',
          axisLabel: { color: theme.textColor, fontFamily: theme.fontFamily },
          splitLine: { show: false },
        })
      }

      const series: any[] = []
      multi.series.forEach((s, i) => {
        if (i === 0) {
          series.push({
            name: s.name,
            type: 'bar',
            data: s.values,
            itemStyle: { color: theme.palette[0], borderRadius: [4, 4, 0, 0] as any },
            label: {
              show: true, position: 'top', fontFamily: theme.fontFamily,
              formatter: (p: any) => formatMetricValue(p.value, 'compact'),
            },
          })
        } else {
          series.push({
            name: s.name,
            type: 'line',
            yAxisIndex: needDualAxis ? 1 : 0,
            data: s.values,
            smooth: true,
            showSymbol: true,
            lineStyle: { width: 2.5, color: theme.palette[1] },
            itemStyle: { color: theme.palette[1] },
            label: {
              show: true, position: 'top', fontFamily: theme.fontFamily,
              formatter: (p: any) => formatMetricValue(p.value, 'compact'),
            },
            areaStyle: {
              color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
                { offset: 0, color: theme.palette[1] + '40' },
                { offset: 1, color: theme.palette[1] + '05' },
              ]},
            },
          })
        }
      })

      chart.setOption({
        color: theme.palette,
        tooltip: {
          trigger: 'axis',
          formatter: (params: any[]) => {
            if (!params || !params.length) return ''
            let html = `<b>${params[0].axisValue}</b><br/>`
            params.forEach((p: any) => {
              html += `${p.marker} ${p.seriesName}: ${formatMetricValue(p.value, 'compact')}<br/>`
            })
            return html
          },
        },
        legend: { bottom: 0, textStyle: { color: theme.textColor, fontFamily: theme.fontFamily } },
        grid: { left: 60, right: needDualAxis ? 60 : 24, top: 16, bottom: 40 },
        xAxis: {
          type: 'category',
          data: multi.categories,
          axisLabel: { color: theme.textColor, fontFamily: theme.fontFamily, rotate: multi.categories.length > 6 ? 30 : 0 },
          axisLine: { lineStyle: { color: theme.axisColor } },
        },
        yAxis,
        series,
        animationDuration: 800,
        animationEasing: 'cubicOut' as any,
      })
      return
    }

    // --- BAR / LINE (with multi yField support) ---
    if (spec.chartType === 'bar' || spec.chartType === 'line') {
      const useMultiY = spec.yFields.length > 1

      if (useMultiY) {
        const multi = aggregateMultiYField({
          xColumn: spec.xField || columns[0],
          yFields: spec.yFields,
          columns, rows,
        })
        if (multi.isEmpty) {
          chart.clear()
          chart.setOption({ title: { text: '暂无数据', left: 'center', top: 'center', textStyle: { color: '#999' } } })
          return
        }
        const series = multi.series.map((s, i) => {
          const color = getSeriesColor(i, theme.palette)
          const isBar = spec.chartType === 'bar'
          return {
            name: s.name,
            type: spec.chartType,
            data: s.values,
            smooth: !isBar,
            showSymbol: !isBar,
            lineStyle: { width: 2.5, color, type: i === 1 ? 'dashed' as any : 'solid' as any },
            itemStyle: {
              color,
              borderRadius: isBar ? [4, 4, 0, 0] as any : undefined,
            },
            label: {
              show: true,
              position: isBar ? 'top' : 'top' as any,
              fontFamily: theme.fontFamily,
              formatter: (p: any) => formatMetricValue(p.value, 'compact'),
            },
            areaStyle: !isBar ? {
              color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
                { offset: 0, color: color + '40' },
                { offset: 1, color: color + '05' },
              ]},
            } : undefined,
          }
        })
        chart.setOption({
          color: theme.palette,
          tooltip: {
            trigger: 'axis',
            formatter: (params: any[]) => {
              if (!params || !params.length) return ''
              let html = `<b>${params[0].axisValue}</b><br/>`
              params.forEach((p: any) => {
                html += `${p.marker} ${p.seriesName}: ${formatMetricValue(p.value, 'compact')}<br/>`
              })
              return html
            },
          },
          legend: { bottom: 0, textStyle: { color: theme.textColor, fontFamily: theme.fontFamily } },
          grid: { left: 60, right: 24, top: 16, bottom: 40 },
          xAxis: {
            type: 'category',
            data: multi.categories,
            axisLabel: { color: theme.textColor, fontFamily: theme.fontFamily, rotate: multi.categories.length > 6 ? 30 : 0 },
            axisLine: { lineStyle: { color: theme.axisColor } },
          },
          yAxis: {
            type: 'value',
            axisLabel: { color: theme.textColor, fontFamily: theme.fontFamily },
            splitLine: { lineStyle: { color: theme.axisColor } },
          },
          series,
          animationDuration: 800,
          animationEasing: 'cubicOut' as any,
        })
        return
      }

      // Single yField (original behavior with labels)
      const agg = aggregateChartData({
        chartType: spec.chartType === 'line' ? 'line' : 'bar',
        xColumn: spec.xField || columns[0],
        yColumn: spec.yFields[0],
        columns, rows,
      })
      if (agg.isEmpty || !agg.categories || !agg.values) {
        chart.clear()
        chart.setOption({ title: { text: '暂无数据', left: 'center', top: 'center', textStyle: { color: '#999' } } })
        return
      }
      const categories = agg.categories
      chart.setOption({
        color: theme.palette,
        tooltip: {
          trigger: 'axis',
          formatter: (params: any[]) => {
            if (!params || !params.length) return ''
            return `<b>${params[0].axisValue}</b><br/>${params.map((p: any) =>
              `${p.marker} ${p.seriesName}: ${formatMetricValue(p.value, 'compact')}`
            ).join('<br/>')}`
          },
        },
        grid: { left: 60, right: 24, top: 16, bottom: 40 },
        xAxis: {
          type: 'category',
          data: categories,
          axisLabel: { color: theme.textColor, fontFamily: theme.fontFamily, rotate: categories.length > 6 ? 30 : 0 },
          axisLine: { lineStyle: { color: theme.axisColor } },
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: theme.textColor, fontFamily: theme.fontFamily },
          splitLine: { lineStyle: { color: theme.axisColor } },
        },
        series: [{
          type: spec.chartType,
          data: agg.values,
          itemStyle: { borderRadius: spec.chartType === 'bar' ? [4, 4, 0, 0] as any : undefined },
          smooth: spec.chartType === 'line',
          showSymbol: spec.chartType === 'line',
          lineStyle: { width: 2.5 },
          label: {
            show: true,
            position: spec.chartType === 'bar' ? 'top' : 'top' as any,
            fontFamily: theme.fontFamily,
            formatter: (p: any) => formatMetricValue(p.value, 'compact'),
          },
          areaStyle: spec.chartType === 'line' ? {
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
              { offset: 0, color: theme.palette[0] + '40' },
              { offset: 1, color: theme.palette[0] + '05' },
            ]},
          } : undefined,
          animationDuration: 800,
          animationEasing: 'cubicOut' as any,
        }],
      })
      return
    }

    // Unsupported type fallback
    chart.clear()
    chart.setOption({
      title: { text: `暂不支持 ${spec.chartType} 类型`, left: 'center', top: 'center', textStyle: { color: '#999' } },
    })
  }, [spec, columns, rows, width, height, theme])

  return (
    <div
      ref={containerRef}
      data-testid="chart-canvas"
      style={{ width: width || '100%', height }}
    />
  )
}

export default ChartCanvas
```

- [ ] **Step 4: Update `components/ChartCanvas.test.tsx`**

```typescript
// frontend/src/components/ChartCanvas.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChartCanvas from './ChartCanvas'
import type { AiChartSpec } from '../types/aiAsk'

const mockSetOption = vi.fn()
const mockDispose = vi.fn()
const mockClear = vi.fn()
const mockResize = vi.fn()

vi.mock('echarts/core', () => ({
  init: vi.fn(() => ({
    setOption: mockSetOption,
    dispose: mockDispose,
    clear: mockClear,
    resize: mockResize,
  })),
  use: vi.fn(),
}))

const mockColumns = ['region', 'total_revenue', 'gross_margin', 'month']
const mockRows = [
  ['华东', 12300000, 32.5],
  ['华南', 9800000, 28.7],
]

const barSpec: AiChartSpec = {
  title: '各区域销售额', chartType: 'bar', xField: 'region', yFields: ['total_revenue'],
  rationale: '', limitations: [],
}

const lineSpec: AiChartSpec = {
  title: '趋势', chartType: 'line', xField: 'region', yFields: ['total_revenue'],
  rationale: '', limitations: [],
}

const pieSpec: AiChartSpec = {
  title: '占比', chartType: 'pie', xField: 'region', yFields: ['total_revenue'],
  rationale: '', limitations: [],
}

const comboSpec: AiChartSpec = {
  title: '组合图', chartType: 'combo', xField: 'region', yFields: ['total_revenue', 'gross_margin'],
  rationale: '', limitations: [],
}

const multiBarSpec: AiChartSpec = {
  title: '多指标', chartType: 'bar', xField: 'region', yFields: ['total_revenue', 'gross_margin'],
  rationale: '', limitations: [],
}

describe('ChartCanvas', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders bar chart', () => {
    render(<ChartCanvas spec={barSpec} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
    // Should have called setOption with bar chart data
    expect(mockSetOption).toHaveBeenCalled()
  })

  it('renders line chart', () => {
    render(<ChartCanvas spec={lineSpec} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('renders pie chart', () => {
    render(<ChartCanvas spec={pieSpec} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('renders combo chart', () => {
    render(<ChartCanvas spec={comboSpec} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('renders multi yField bar chart (grouped)', () => {
    render(<ChartCanvas spec={multiBarSpec} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('handles empty data gracefully', () => {
    render(<ChartCanvas spec={barSpec} columns={mockColumns} rows={[]} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('handles metric-card type without error', () => {
    const metricSpec: AiChartSpec = {
      title: '指标卡', chartType: 'metric-card', xField: 'region', yFields: ['total_revenue'],
      rationale: '', limitations: [],
    }
    render(<ChartCanvas spec={metricSpec} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('renders combo with single yField as bar fallback', () => {
    const singleFieldCombo: AiChartSpec = {
      title: '单字段组合', chartType: 'combo', xField: 'region', yFields: ['total_revenue'],
      rationale: '', limitations: [],
    }
    render(<ChartCanvas spec={singleFieldCombo} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('renders table type without error', () => {
    const tableSpec: AiChartSpec = {
      title: '表格', chartType: 'table', yFields: [],
      rationale: '', limitations: [],
    }
    render(<ChartCanvas spec={tableSpec} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })
})
```

- [ ] **Step 5: Run tests**

Run: `cd frontend && npx vitest run components/ChartCanvas.test.tsx -v`
Expected: PASS (at least 9 tests)

- [ ] **Step 6: Type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ChartCanvas.tsx frontend/src/components/ChartCanvas.test.tsx frontend/src/utils/chartData.ts frontend/src/styles/chartThemes.ts
git commit -m "feat(phase-5g.2): ChartCanvas - combo chart, multi yFields, data labels, enhanced tooltip/legend"
```

---

### Task 6: ChartCard metric-card 增强 + AiChartBoard 视觉提升

**Files:**
- Modify: `frontend/src/components/ChartCard.tsx`
- Modify: `frontend/src/components/ChartCard.test.tsx`
- Modify: `frontend/src/components/AiChartBoard.tsx`
- Modify: `frontend/src/components/AiChartBoard.test.tsx`

**Interfaces:**
- Consumes: `MetricCard.icon` from types, `formatMetricValue` from utils, `getSeriesColor` from themes
- Produces: Enhanced ChartCard with icon display, gradient backgrounds, hover effects; AiChartBoard with responsive spacing

- [ ] **Step 1: Create icon mapping helper in ChartCard.tsx**

```typescript
// Add after imports in ChartCard.tsx:
import {
  DollarOutlined, ShoppingCartOutlined, UserOutlined,
  RiseOutlined, PercentageOutlined,
} from '@ant-design/icons'
import type { MetricIcon } from '../types/aiAsk'
import { formatMetricValue } from '../utils/numberFormat'

const METRIC_ICON_MAP: Record<MetricIcon, React.ReactNode> = {
  revenue: <DollarOutlined />,
  orders: <ShoppingCartOutlined />,
  customers: <UserOutlined />,
  profit: <RiseOutlined />,
  rate: <PercentageOutlined />,
}
```

- [ ] **Step 2: Update metric-card rendering in ChartCard.tsx**

Replace the existing metric-card grid section with enhanced version that includes icons and gradient backgrounds:

```tsx
{/* 指标卡（metric-card）行内渲染 — 5G 增强 */}
{spec.chartType === 'metric-card' && spec.metricCards && spec.metricCards.length > 0 && (
  <div style={{
    display: 'grid',
    gridTemplateColumns: `repeat(${Math.min(spec.metricCards.length, 3)}, 1fr)`,
    gap: 10,
    padding: '12px 0',
  }}>
    {spec.metricCards.map((mc, i) => (
      <div
        key={i}
        style={{
          textAlign: 'center',
          padding: '12px 8px 10px',
          background: i === 0
            ? 'linear-gradient(135deg, #f0f5ff, #e6f7ff)'
            : i === 1
              ? 'linear-gradient(135deg, #f6fff0, #f0f5ff)'
              : '#f9fafb',
          borderRadius: 10,
          transition: 'all 0.2s ease',
          cursor: 'default',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.02)'
          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)'
          e.currentTarget.style.boxShadow = 'none'
        }}
      >
        {/* Icon + Label */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 4 }}>
          {mc.icon && METRIC_ICON_MAP[mc.icon] && (
            <span style={{ fontSize: 14, color: '#4E7BF5' }}>
              {METRIC_ICON_MAP[mc.icon]}
            </span>
          )}
          <Text style={{ fontSize: 11, color: '#8c8c8c' }}>{mc.label}</Text>
        </div>
        {/* Value */}
        <Text strong style={{ fontSize: 20, color: '#262626', display: 'block', lineHeight: 1.3 }}>
          {mc.value}
        </Text>
        {/* Change indicator */}
        {mc.change && (
          <span style={{
            fontSize: 11,
            color: mc.changeDirection === 'up' ? '#52c41a'
              : mc.changeDirection === 'down' ? '#ff4d4f' : '#8c8c8c',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            marginTop: 2,
          }}>
            <span style={{ fontSize: 12, lineHeight: 1 }}>
              {mc.changeDirection === 'up' ? '↑' : mc.changeDirection === 'down' ? '↓' : '→'}
            </span>
            {mc.change}
          </span>
        )}
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 3: Update `AiChartBoard.tsx` — add `gap` and first-card highlight**

```tsx
// Key changes in AiChartBoard.tsx:
// In the container div for chart cards, ensure gap is 12 (already is)
// Add a subtle first-card emphasis when activeIndex === 0

// The existing gap of 12 is already fine per the spec.
// We are just ensuring consistency. No code change needed to AiChartBoard 
// itself — the responsive spacing is already using gap: 12.
```

Actually, AiChartBoard already has `gap: 12` — no change needed for basic spacing. The spec says "第一张卡片默认高亮" which is already handled by `activeIndex` defaulting to 0 in the store. So AiChartBoard needs no code change.

- [ ] **Step 4: Run existing tests**

Run: `cd frontend && npx vitest run components/ChartCard.test.tsx components/AiChartBoard.test.tsx -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChartCard.tsx frontend/src/components/ChartCard.test.tsx
git commit -m "feat(phase-5g.2): enhance metric-card with icons, gradient backgrounds, hover effects"
```

---

> **Task "5G.2 轻量 Chart Recommendation 引擎" 已移至 5G.1 Task 2。**
> `recommendCharts()` 现在在 MockAdapter.analyze() 内部调用，是实际 AI 问数链路的一环。
> 请参考 5G.1 Task 2 的完整实现。

### Task 7: 结果表使用 Ant Design Table + 骨架屏加载态

**Files:**
- Modify: `frontend/src/pages/AskWorkbenchPage.tsx`

**Interfaces:**
- Replaces inline HTML table with Ant Design Table component
- Replaces Spin loading with skeleton + step indicator (already in Task 3)
- Adds numerical formatting to result table columns

- [ ] **Step 1: Replace the inline result table with Ant Design Table**

In `AskWorkbenchPage.tsx`, replace the inline `<table>` block (around line 286-357 of the original) with:

```tsx
import { Table } from 'antd'

// Replace:
{/* Result summary table */}
{currentResponse.resultSummary && chartDataRef.current && (
  <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fafafa', borderRadius: 8, border: '1px solid #f0f0f0' }}>
    <Typography.Text strong style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 8 }}>
      查询结果（{currentResponse.resultSummary.rowCount} 行 · {currentResponse.resultSummary.durationMs}ms）
    </Typography.Text>
    <Table
      dataSource={chartDataRef.current.rows.map((row, i) => {
        const record: Record<string, any> = { _key: i }
        chartDataRef.current!.columns.forEach((col, ci) => {
          record[col] = row[ci]
        })
        return record
      })}
      columns={chartDataRef.current.columns.map((col) => {
        // Detect column type from first data value
        const sampleVal = chartDataRef.current!.rows[0]?.[chartDataRef.current!.columns.indexOf(col)]
        const isNumeric = typeof sampleVal === 'number'
        return {
          title: col,
          dataIndex: col,
          key: col,
          sorter: isNumeric
            ? (a: any, b: any) => (a[col] as number) - (b[col] as number)
            : (a: any, b: any) => String(a[col]).localeCompare(String(b[col])),
          align: isNumeric ? 'right' : 'left' as any,
          render: (val: any) => {
            if (typeof val === 'number') {
              // Auto-format: if value is between 0 and 1 exclusive, format as %
              if (val > 0 && val < 1) return (val * 100).toFixed(1) + '%'
              if (Math.abs(val) >= 10000) return formatCompact(val, 1)
              return val.toLocaleString()
            }
            return val
          },
        }
      })}
      rowKey="_key"
      size="small"
      pagination={{ pageSize: 10, size: 'small', showSizeChanger: false, showTotal: (total) => `共 ${total} 行` }}
      style={{ fontSize: 12 }}
    />
  </div>
)}
```

Add the import:
```typescript
import { Table } from 'antd'
import { formatCompact } from '../utils/numberFormat'
```

- [ ] **Step 2: Run tests + type check**

Run: `cd frontend && npx vitest run -v`
Expected: ALL PASS

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/AskWorkbenchPage.tsx
git commit -m "feat(phase-5g.2): replace inline table with Ant Design Table with number formatting"
```

---

### Task 8: 全量验证 + 最终构建

**Files:**
- All

- [ ] **Step 1: Run all tests**

```bash
cd frontend && npx vitest run -v
```
Expected: ALL PASS

- [ ] **Step 2: Type check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: PASS

- [ ] **Step 3: Build**

```bash
cd frontend && npm run build
```
Expected: PASS (generates dist/)

---

## 最终验证命令

```bash
cd frontend && npm test
cd frontend && npx tsc --noEmit
cd frontend && npm run build
```

## Final Review 检查清单

### 范围检查
- [ ] 5G.1 — AiAskAdapter 接口定义了 analyze/getChartData/isAvailable/name
- [ ] 5G.1 — MockAdapter 实现了 5 个场景化 mock（revenue-by-region / trend / top-n / comparison / default）
- [ ] 5G.1 — **recommendCharts 集成到 MockAdapter.analyze() 内部**，不同场景生成不同 chartSuggestions
- [ ] 5G.1 — validateAiAskResponse 覆盖所有校验规则
- [ ] 5G.1 — AiAskError 包含 6 种错误码 + 中文用户提示
- [ ] 5G.1 — aiAskStore 新增 adapterName / error / validation / analysisStep / isExecuting
- [ ] 5G.1 — AskWorkbenchPage 使用 adapter.analyze() 替代 MOCK_ASK_RESPONSE
- [ ] 5G.1 — 旧文件 api/aiAsk.mock.ts 已删除（git rm），已用 `rg "aiAsk.mock|MOCK_ASK_RESPONSE" src/` 验证无残留
- [ ] 5G.2 — ChartCanvas 支持 combo 组合图（bar+line 双 Y 轴）
- [ ] 5G.2 — ChartCanvas 支持多 yFields（分组柱状图 / 多折线）
- [ ] 5G.2 — ChartCanvas 数据标签格式化显示
- [ ] 5G.2 — ChartCanvas tooltip 增强（含占比、排名、格式化数值）
- [ ] 5G.2 — ChartCanvas legend 增强（多系列显示，可点击切换）
- [ ] 5G.2 — metric-card 增强（icon 映射、卡片渐变背景、hover 动效）
- [ ] 5G.2 — numberFormat 工具函数（formatCompact / formatPercent / formatCurrency / detectFormat）
- [ ] 5G.2 — 结果表使用 Ant Design Table 替代内联 table
- [ ] 5G.2 — 加载态骨架屏 + 步骤指示器

### 约束检查
- [ ] 不新增后端 API / DB / migration
- [ ] 不接入真实 LLM
- [ ] 不引入 Playwright / Cypress
- [ ] 不修改 SQL Workbench 核心逻辑
- [ ] 不处理 Phase 4 untracked 遗留文件
- [ ] 不 push，不 merge
- [ ] AiAskResponse 协议无破坏性变更
- [ ] NumberFormat 中货币符号使用 ¥ 硬编码（标注了本地化扩展点）

### 文件清单
- [ ] 5G.1 新增 13 个文件（含 recommendation.ts + recommendation.test.ts）
- [ ] 5G.1 删除 1 个文件（aiAsk.mock.ts — git rm）
- [ ] 5G.1 修改 2 个文件（aiAskStore.ts, AskWorkbenchPage.tsx）
- [ ] 5G.2 新增 1 个文件（numberFormat.ts）
- [ ] 5G.2 修改 7 个文件（types/aiAsk.ts, chartThemes.ts, chartData.ts, ChartCanvas.tsx, ChartCard.tsx, AiChartBoard.tsx, AskWorkbenchPage.tsx）

### 测试覆盖
- [ ] aiAskStore.test.ts — 新增 5G 字段、analysisStep、error（无 aiAsk.mock.ts 依赖）
- [ ] errors.test.ts — AiAskError 构造、error message 映射
- [ ] validator.test.ts — 校验：正常/异常/警告/各种边界
- [ ] recommendation.test.ts — 6 条推荐规则、最多 4 个、至少 1 个
- [ ] mockAdapter.test.ts — 5 场景匹配、**chartSuggestions 因场景不同而变化**、datasource 注入、fallback、getChartData、**metric-card 追加**
- [ ] numberFormat.test.ts — formatCompact/Percent/Currency/Thousand、detectFormat、formatMetricValue
- [ ] ChartCanvas.test.tsx — bar/line/pie/combo/multi-yField/metric-card/table/empty data

---

## 执行建议

Plan complete and saved to `docs/superpowers/plans/2026-07-04-phase-5g-chart-enhancement-and-llm-adapter-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
