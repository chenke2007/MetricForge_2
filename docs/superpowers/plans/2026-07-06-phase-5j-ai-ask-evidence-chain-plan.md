# Phase 5J AI 问数解释可信度与证据链增强 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance AI ask evidence trustworthiness by extending evidence items with confidence, calculation details, and progressive disclosure UI, plus add mapping chain display to ProcessPanel and evidence quality benchmarks.

**Architecture:** All changes are frontend-only, fully backward-compatible via optional fields. Type changes in `aiAsk.ts`, scenario data enrichment in `scenarios/*.ts`, UI additions in `AiNarrative.tsx` (evidence expand/collapse) and `ProcessPanel.tsx` (mapping chain), plus a new benchmark module.

**Tech Stack:** TypeScript, React 18, Ant Design, Vitest + RTL, npx tsx for benchmarks

## Global Constraints

- All Phase 5J new fields on EvidenceItem must be `optional` (`?`) for backward compatibility.
- No new backend APIs, DB changes, or migrations.
- No real LLM integration — all MockAdapter simulation.
- No Playwright / Cypress.
- No Monaco DOM testing.
- Business code must not hardcode `dwhrpt`; mock datasource uses `{ id: 2, name: 'dwhrpt' }`.
- Benchmark is a local dev tool (npx tsx), not a CI gate.
- ModuleReport format reuses Phase 5I's QualityBenchmarkReport.
- Evidence chain must not overwhelm conclusions — default collapsed state.

---
## File Manifest

### Modified files

| File | Change |
|------|--------|
| `frontend/src/types/aiAsk.ts` | EvidenceItem: +6 optional fields; AiInsightNarrative: +evidenceSummary; ProcessInsight: +mappingChain |
| `frontend/src/api/aiAsk/scenarios/revenueByRegion.ts` | Enrich evidence array with Phase 5J fields |
| `frontend/src/api/aiAsk/scenarios/trend.ts` | Same |
| `frontend/src/api/aiAsk/scenarios/topN.ts` | Same |
| `frontend/src/api/aiAsk/scenarios/comparison.ts` | Same |
| `frontend/src/api/aiAsk/scenarios/default.ts` | Same |
| `frontend/src/api/aiAsk/scenarios/followUpScenarios.ts` | Same for all 4 follow-up scenarios |
| `frontend/src/components/AiNarrative.tsx` | Add "查看证据" expand/collapse per evidence item; render evidenceSummary |
| `frontend/src/components/AiNarrative.test.tsx` | Tests for evidence expand/collapse, old data compat, confidence display |
| `frontend/src/components/ProcessPanel.tsx` | Add mappingChain display section |
| `frontend/src/components/ProcessPanel.test.tsx` | Tests for mappingChain rendering and compat |
| `frontend/scripts/runQualityBenchmarks.ts` | Register evidenceQuality module |

### Created files

| File | Change |
|------|--------|
| `frontend/scripts/benchmarks/evidenceQuality.bench.ts` | New benchmark module |

### Files NOT changed (explicitly unchanged)

- `frontend/src/api/aiAsk/adapter.ts` — protocol unchanged
- `frontend/src/api/aiAsk/mockAdapter.ts` — logic unchanged
- `frontend/src/api/aiAsk/followUpDetector.ts` — unchanged
- `frontend/src/api/aiAsk/contextPolicy.ts` — unchanged
- `frontend/src/api/aiAsk/inputGuard.ts` — unchanged
- `frontend/src/pages/AskWorkbenchPage.tsx` — unchanged
- `frontend/src/stores/aiAskStore.ts` — unchanged

---
## Task 1: Type System Extension

**Files:**
- Modify: `frontend/src/types/aiAsk.ts`

**Interfaces:**
- Produces: Updated `EvidenceItem`, `AiInsightNarrative`, `ProcessInsight` types

- [ ] **Step 1: Extend EvidenceItem with 6 optional fields**

Extend the existing `EvidenceItem` interface in `frontend/src/types/aiAsk.ts:46-52`:

```typescript
export interface EvidenceItem {
  claim: string
  fields: string[]
  sqlSnippet?: string
  value?: string
  significance?: string

  // Phase 5J: evidence trust & traceability (all optional for backward compat)
  sourceFields?: string[]
  calculation?: string
  confidence?: 'high' | 'medium' | 'low'
  confidenceReason?: string
  relatedIntent?: {
    metrics: string[]
    dimensions: string[]
    filters?: string[]
    timeRange?: string
  }
  displayValue?: string
}
```

- [ ] **Step 2: Extend AiInsightNarrative with evidenceSummary**

Add to `AiInsightNarrative` in `frontend/src/types/aiAsk.ts:98-106`:

```typescript
export interface AiInsightNarrative {
  summary: string
  keyFindings: string[]
  evidence: EvidenceItem[]
  risks: Array<string | RiskItem>
  nextQuestions: Array<string | NextQuestion>
  // Phase 5H additions:
  conclusion?: string

  // Phase 5J:
  evidenceSummary?: string
}
```

- [ ] **Step 3: Extend ProcessInsight with mappingChain**

Add to `ProcessInsight` in `frontend/src/types/aiAsk.ts:32-44`:

```typescript
export interface ProcessInsight {
  understoodMetrics: string[]
  understoodDimensions: string[]
  understoodTimeRange?: string
  understoodFilters: string[]
  semanticGaps: Array<{
    field: string
    candidates?: string[]
    severity: 'low' | 'medium' | 'high'
  }>
  analysisStrategy?: string
  contextChain?: string[]

  // Phase 5J:
  mappingChain?: Array<{
    step: 'intent' | 'sql_plan' | 'result' | 'conclusion'
    label: string
    detail?: string
    fields?: string[]
  }>
}
```

- [ ] **Step 4: Verify type correctness**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors (all new fields are optional, no consumers broken yet).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/aiAsk.ts
git commit -m "feat(phase-5j): extend EvidenceItem, AiInsightNarrative, ProcessInsight types"
```

---
## Task 2: Mock Scenario Evidence Field Enrichment

**Files:**
- Modify: `frontend/src/api/aiAsk/scenarios/revenueByRegion.ts`
- Modify: `frontend/src/api/aiAsk/scenarios/trend.ts`
- Modify: `frontend/src/api/aiAsk/scenarios/topN.ts`
- Modify: `frontend/src/api/aiAsk/scenarios/comparison.ts`
- Modify: `frontend/src/api/aiAsk/scenarios/default.ts`
- Modify: `frontend/src/api/aiAsk/scenarios/followUpScenarios.ts`
- Not modified: `frontend/src/api/aiAsk/mockAdapter.ts`, `frontend/src/api/aiAsk/scenarios/index.ts`

**Interfaces:**
- Consumes: Updated `EvidenceItem` from Task 1
- Produces: Scenario data with populated Phase 5J evidence fields

- [ ] **Step 1: Enrich revenueByRegion.ts evidence**

Replace the evidence array in `frontend/src/api/aiAsk/scenarios/revenueByRegion.ts:27-29`:

```typescript
evidence: [
  {
    claim: '华东领先',
    fields: ['region', 'total_revenue'],
    sqlSnippet: 'SUM(r.amount) GROUP BY region',
    value: '¥12.3M',
    significance: '占总收入 29.4%',
    sourceFields: ['r.region', 'r.amount'],
    calculation: 'SUM(r.amount) WHERE region=\'华东\' / SUM(r.amount) OVER()',
    confidence: 'high',
    confidenceReason: '数据覆盖 30 天，字段匹配率 100%，无缺失值',
    relatedIntent: { metrics: ['销售额'], dimensions: ['区域'], timeRange: '近 30 天' },
    displayValue: '¥12.3M (29.4%)',
  },
]
```

Also add `evidenceSummary` to the narrative:
```typescript
// After summary in the narrative object (line 25):
summary: '近 30 天各区域销售额呈梯度分布，华东以 ¥12.3M 领跑，占总销售额的 29.4%。',
evidenceSummary: '以下结论基于 REVENUE 表近 30 天数据，覆盖 6 个区域的销售额汇总。',
```

- [ ] **Step 2: Enrich trend.ts evidence**

Replace the evidence array in `frontend/src/api/aiAsk/scenarios/trend.ts:21-23`:

```typescript
evidence: [
  {
    claim: '持续增长',
    fields: ['month', 'total_revenue'],
    sqlSnippet: "TO_CHAR(t.transaction_date, 'YYYY-MM') AS month, SUM(t.amount) AS total_revenue FROM TRANSACTIONS GROUP BY month ORDER BY month",
    value: '+8.2%',
    significance: '环比增长',
    sourceFields: ['t.transaction_date', 't.amount', 'month'],
    calculation: 'SUM(t.amount) GROUP BY TO_CHAR(t.transaction_date, \'YYYY-MM\')',
    confidence: 'high',
    confidenceReason: '连续 4 个月正增长趋势一致，数据源稳定',
    relatedIntent: { metrics: ['收入'], dimensions: ['月份'], timeRange: '近 6 个月' },
    displayValue: '¥16.4M (环比 +8.2%)',
  },
]
```

Add `evidenceSummary` to narrative:
```typescript
evidenceSummary: '以下结论基于 TRANSACTIONS 表近 6 个月数据，按月汇总收入。',
```

- [ ] **Step 3: Enrich topN.ts evidence**

Replace the evidence array in `frontend/src/api/aiAsk/scenarios/topN.ts:21-23`:

```typescript
evidence: [
  {
    claim: '客户集中度高',
    fields: ['customer_name', 'total_revenue'],
    sqlSnippet: "SELECT c.customer_name, SUM(t.amount) AS total_revenue FROM TRANSACTIONS t JOIN CUSTOMERS c ON t.customer_id = c.id GROUP BY c.customer_name ORDER BY total_revenue DESC FETCH FIRST 10 ROWS ONLY",
    value: '76.2%',
    significance: 'Top 10 占总营收',
    sourceFields: ['t.amount', 'c.customer_name'],
    calculation: 'SUM(t.amount) GROUP BY c.customer_name ORDER BY SUM DESC FETCH FIRST 10 ROWS ONLY',
    confidence: 'high',
    confidenceReason: '基于完整本月交易数据，无抽样',
    relatedIntent: { metrics: ['收入'], dimensions: ['客户'], filters: ['Top 10'], timeRange: '本月' },
    displayValue: '¥12.5M (76.2%)',
  },
]
```

Add `evidenceSummary`:
```typescript
evidenceSummary: '以下结论基于本月 TRANSACTIONS 与 CUSTOMERS 表关联数据，按客户汇总。',
```

- [ ] **Step 4: Enrich comparison.ts evidence**

Replace the evidence array in `frontend/src/api/aiAsk/scenarios/comparison.ts:21-23`:

```typescript
evidence: [
  {
    claim: '西南增长最快',
    fields: ['region', 'yoy_pct'],
    sqlSnippet: 'GROUP BY region ORDER BY yoy_pct DESC',
    value: '+22%',
    significance: '同比增长率',
    sourceFields: ['r.region', 't.amount', 't.transaction_date'],
    calculation: '(this_year - last_year) / NULLIF(last_year, 0) * 100',
    confidence: 'high',
    confidenceReason: '去年与今年口径一致，数据完整',
    relatedIntent: { metrics: ['收入'], dimensions: ['区域', '年份'], filters: ['同比对比'], timeRange: '今年 vs 去年' },
    displayValue: '西南 +22%',
  },
]
```

Add `evidenceSummary`:
```typescript
evidenceSummary: '以下结论基于 REVENUE 与 TRANSACTIONS 表数据，按区域对比今年与去年收入。',
```

- [ ] **Step 5: Enrich default.ts evidence**

Replace the evidence array in `frontend/src/api/aiAsk/scenarios/default.ts:21-23`:

```typescript
evidence: [
  {
    claim: '华东领先',
    fields: ['region', 'total_sales'],
    sqlSnippet: 'SELECT r.region, SUM(r.amount) AS total_sales FROM REVENUE r JOIN TRANSACTIONS t GROUP BY r.region ORDER BY total_sales DESC',
    sourceFields: ['r.region', 'r.amount'],
    calculation: 'SUM(r.amount) GROUP BY r.region',
    confidence: 'medium',
    confidenceReason: '数据口径待确认，字段名基于推断匹配',
    relatedIntent: { metrics: ['销售额', '订单数'], dimensions: ['区域'] },
    displayValue: '华东 ¥12.3M',
  },
]
```

Add `evidenceSummary`:
```typescript
evidenceSummary: '以下结论基于 REVENUE 与 TRANSACTIONS 表数据。',
```

- [ ] **Step 6: Enrich followUpScenarios.ts evidence (Scenario 1: drill_down)**

In `frontend/src/api/aiAsk/scenarios/followUpScenarios.ts:37-40`, replace the evidence array:

```typescript
evidence: [
  {
    claim: '电子产品领先',
    fields: ['product_line', 'revenue'],
    sqlSnippet: "SELECT p.product_line, SUM(r.amount) AS revenue FROM REVENUE r JOIN PRODUCTS p ON r.product_id = p.id WHERE r.region = '华东' AND r.transaction_date >= SYSDATE - 30 GROUP BY p.product_line ORDER BY revenue DESC",
    value: '¥5.2M',
    significance: '占华东 42.3%',
    sourceFields: ['r.amount', 'product_line'],
    calculation: 'SUM(r.amount) WHERE region=\'华东\' GROUP BY p.product_line',
    confidence: 'medium',
    confidenceReason: '基于上一轮结果推理，数据范围有限',
    relatedIntent: { metrics: ['销售额'], dimensions: ['产品线'], filters: ['区域=华东'], timeRange: '近 30 天' },
    displayValue: '¥5.2M (42.3%)',
  },
  {
    claim: '服装线高毛利',
    fields: ['product_line', 'revenue', 'margin'],
    sqlSnippet: "SELECT p.product_line, SUM(r.amount) AS revenue, AVG(r.margin) AS margin FROM REVENUE r JOIN PRODUCTS p ON r.product_id = p.id WHERE r.region = '华东' GROUP BY p.product_line",
    value: '¥3.1M',
    significance: '毛利率 43.2%',
    sourceFields: ['r.amount', 'p.product_line', 'r.margin'],
    calculation: 'SUM(r.amount) WHERE region=\'华东\' GROUP BY p.product_line',
    confidence: 'low',
    confidenceReason: '毛利率字段为派生计算，原始数据可能存在口径差异',
    relatedIntent: { metrics: ['销售额', '毛利率'], dimensions: ['产品线'], filters: ['区域=华东'], timeRange: '近 30 天' },
    displayValue: '¥3.1M (毛利 43.2%)',
  },
]
```

Add `evidenceSummary` to the narrative:
```typescript
// Add after summary (line 35):
evidenceSummary: '以下结论基于华东区域近 30 天产品线数据，包含电子产品与服装线分析。',
```

- [ ] **Step 7: Enrich followUpScenarios.ts evidence (Scenario 2: why_down)**

In `frontend/src/api/aiAsk/scenarios/followUpScenarios.ts:71-74`, replace the evidence array:

```typescript
evidence: [
  {
    claim: '整体下降',
    fields: ['month', 'revenue'],
    sqlSnippet: "SELECT TRUNC(r.transaction_date, 'MM') AS month, SUM(r.amount) AS revenue FROM REVENUE r WHERE r.transaction_date >= SYSDATE - 30 GROUP BY TRUNC(r.transaction_date, 'MM') ORDER BY month",
    value: '18.5%',
    significance: '最后一周 vs 首周',
    sourceFields: ['r.transaction_date', 'revenue'],
    calculation: '(SUM(week1) - SUM(week4)) / SUM(week1) * 100',
    confidence: 'high',
    confidenceReason: '数据覆盖完整 30 天，趋势明确',
    relatedIntent: { metrics: ['销售额'], dimensions: ['月份'], filters: ['下降归因'], timeRange: '近 30 天' },
    displayValue: '-18.5%',
  },
  {
    claim: '华东区域主因',
    fields: ['region', 'revenue'],
    sqlSnippet: 'SELECT r.region, SUM(r.amount) AS revenue FROM REVENUE r WHERE r.transaction_date >= SYSDATE - 30 GROUP BY r.region',
    value: '42%',
    significance: '贡献下降的主要部分',
    sourceFields: ['r.region', 'r.amount'],
    calculation: 'SUM(region_decline) / SUM(total_decline) * 100',
    confidence: 'medium',
    confidenceReason: '区域贡献度计算基于近 30 天数据，需更多历史数据验证模式是否持续',
    relatedIntent: { metrics: ['销售额'], dimensions: ['区域'], filters: ['下降归因'], timeRange: '近 30 天' },
    displayValue: '42% 下降贡献',
  },
]
```

Add `evidenceSummary`:
```typescript
evidenceSummary: '以下结论基于近 30 天 REVENUE 表按周汇总数据，分析下降原因。',
```

- [ ] **Step 8: Enrich followUpScenarios.ts evidence (Scenario 3: time_shift)**

In `frontend/src/api/aiAsk/scenarios/followUpScenarios.ts:105-108`, replace the evidence array:

```typescript
evidence: [
  {
    claim: '6 月同比增幅最大',
    fields: ['month', 'this_year', 'last_year'],
    sqlSnippet: "SELECT TO_CHAR(t.transaction_date, 'MM') AS month, SUM(CASE WHEN EXTRACT(YEAR FROM t.transaction_date) = EXTRACT(YEAR FROM SYSDATE) THEN t.amount ELSE 0 END) AS this_year, SUM(CASE WHEN EXTRACT(YEAR FROM t.transaction_date) = EXTRACT(YEAR FROM SYSDATE) - 1 THEN t.amount ELSE 0 END) AS last_year FROM TRANSACTIONS t GROUP BY TO_CHAR(t.transaction_date, 'MM')",
    value: '+22.4%',
    significance: '去年同期为基数',
    sourceFields: ['t.transaction_date', 't.amount', 'month'],
    calculation: '(this_year - last_year) / last_year * 100',
    confidence: 'high',
    confidenceReason: '同比数据覆盖 12 个月完整周期，可比性强',
    relatedIntent: { metrics: ['收入'], dimensions: ['月份'], timeRange: '同比对比' },
    displayValue: '+22.4%',
  },
  {
    claim: '增长加速',
    fields: ['month', 'this_year'],
    sqlSnippet: "SELECT TO_CHAR(t.transaction_date, 'MM') AS month, SUM(CASE WHEN EXTRACT(YEAR FROM t.transaction_date) = EXTRACT(YEAR FROM SYSDATE) THEN t.amount ELSE 0 END) AS this_year FROM TRANSACTIONS t GROUP BY TO_CHAR(t.transaction_date, 'MM')",
    value: 'Q2 +18.9%',
    significance: '高于 Q1 的 +12.1%',
    sourceFields: ['t.transaction_date', 't.amount', 'this_year'],
    calculation: 'SUM(this_year) GROUP BY quarter',
    confidence: 'medium',
    confidenceReason: '增长加速趋势明显，但仅覆盖两个季度，需更多数据确认',
    relatedIntent: { metrics: ['收入'], dimensions: ['月份'], timeRange: '同比对比' },
    displayValue: 'Q2 +18.9%',
  },
]
```

Add `evidenceSummary`:
```typescript
evidenceSummary: '以下结论基于 TRANSACTIONS 表近 12 个月数据，同比分析今年与去年同期收入对比。',
```

- [ ] **Step 9: Enrich followUpScenarios.ts evidence (Scenario 4: top_n)**

In `frontend/src/api/aiAsk/scenarios/followUpScenarios.ts:143-146`, replace the evidence array:

```typescript
evidence: [
  {
    claim: '头部集中',
    fields: ['region', 'revenue'],
    sqlSnippet: "SELECT region, SUM(amount) AS revenue FROM (SELECT region, SUM(amount) AS revenue FROM REVENUE WHERE transaction_date >= SYSDATE - 30 GROUP BY region ORDER BY revenue DESC) WHERE ROWNUM <= 5",
    value: '85%',
    significance: 'TOP5 占总销售额',
    sourceFields: ['r.amount', 'r.region'],
    calculation: 'SUM(revenue OF TOP5) / SUM(revenue) * 100',
    confidence: 'high',
    confidenceReason: '基于完整近 30 天数据，排名稳定',
    relatedIntent: { metrics: ['销售额'], dimensions: ['排名'], filters: ['TOP N'], timeRange: '近 30 天' },
    displayValue: '85%',
  },
  {
    claim: '华东领先',
    fields: ['region', 'revenue'],
    sqlSnippet: "SELECT region, SUM(amount) AS revenue FROM REVENUE WHERE transaction_date >= SYSDATE - 30 GROUP BY region ORDER BY revenue DESC",
    value: '¥12.3M',
    significance: '占比 29.4%',
    sourceFields: ['r.amount', 'r.region'],
    calculation: 'SUM(revenue) WHERE region=\'华东\' GROUP BY region',
    confidence: 'high',
    confidenceReason: '数据覆盖 30 天，字段匹配率 100%',
    relatedIntent: { metrics: ['销售额'], dimensions: ['区域'], filters: ['TOP N'], timeRange: '近 30 天' },
    displayValue: '¥12.3M (29.4%)',
  },
]
```

Add `evidenceSummary`:
```typescript
evidenceSummary: '以下结论基于近 30 天 REVENUE 表数据，按区域销售额排名。',
```

- [ ] **Step 10: Verify type and test correctness**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors.

Run: `cd frontend && npm test`
Expected: All existing tests pass (scenario data changes should not break tests since tests don't assert on evidence field contents).

- [ ] **Step 11: Commit**

```bash
git add frontend/src/api/aiAsk/scenarios/revenueByRegion.ts frontend/src/api/aiAsk/scenarios/trend.ts frontend/src/api/aiAsk/scenarios/topN.ts frontend/src/api/aiAsk/scenarios/comparison.ts frontend/src/api/aiAsk/scenarios/default.ts frontend/src/api/aiAsk/scenarios/followUpScenarios.ts
git commit -m "feat(phase-5j): enrich mock scenario evidence with Phase 5J fields"
```

---
## Task 3: AiNarrative Evidence Chain Progressive Disclosure

**Files:**
- Modify: `frontend/src/components/AiNarrative.tsx`
- Modify: `frontend/src/components/AiNarrative.test.tsx`

**Interfaces:**
- Consumes: `AiInsightNarrative` with expanded `EvidenceItem` from Task 1; scenario data from Task 2
- Produces: Evidence items with per-item expand/collapse, evidenceSummary rendering, confidence display

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/components/AiNarrative.test.tsx` after the Phase 5H block (after line 155):

```typescript
// --- Phase 5J: Evidence chain progressive disclosure ---

describe('AiNarrative evidence chain (Phase 5J)', () => {
  const evidenceNarrative = {
    summary: '测试摘要',
    keyFindings: ['发现 1'],
    evidence: [
      {
        claim: '华东领先',
        fields: ['region', 'total_revenue'],
        value: '¥12.3M',
        significance: '占比 29.4%',
        sourceFields: ['r.region', 'r.amount'],
        calculation: 'SUM(r.amount) GROUP BY region',
        confidence: 'high' as const,
        confidenceReason: '数据覆盖 30 天',
        displayValue: '¥12.3M (29.4%)',
      },
      {
        claim: '华东下降',
        fields: ['region', 'revenue'],
        value: '¥5.2M',
        significance: '环比下降 18.5%',
        sourceFields: ['r.region', 'r.amount'],
        calculation: 'SUM(r.amount) GROUP BY region',
        confidence: 'low' as const,
        confidenceReason: '数据窗口较窄',
        displayValue: '¥5.2M (-18.5%)',
      },
    ],
    risks: [],
    nextQuestions: [],
  }

  it('renders evidence summary when present', () => {
    const withSummary = { ...evidenceNarrative, evidenceSummary: '以下结论基于近 30 天 REVENUE 表数据。' }
    render(<AiNarrative narrative={withSummary} />)
    expect(screen.getByText(/以下结论基于近 30 天 REVENUE 表数据/)).toBeInTheDocument()
  })

  it('does not render evidence summary when absent (backward compat)', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    expect(screen.queryByText(/证据来源/)).not.toBeInTheDocument()
  })

  it('renders evidence with displayValue when present', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    expect(screen.getByText('¥12.3M (29.4%)')).toBeInTheDocument()
  })

  it('shows "查看证据" button per evidence item', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    const buttons = screen.getAllByText('查看证据')
    expect(buttons).toHaveLength(2)
  })

  it('expands evidence detail on click', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    const buttons = screen.getAllByText('查看证据')
    fireEvent.click(buttons[0])
    // After clicking, detail content should be visible
    expect(screen.getByText(/字段：region, total_revenue/)).toBeInTheDocument()
    expect(screen.getByText(/SUM\(r.amount\) GROUP BY region/)).toBeInTheDocument()
  })

  it('collapses evidence detail on second click', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    const buttons = screen.getAllByText('查看证据')
    fireEvent.click(buttons[0])
    expect(screen.getByText(/字段：region, total_revenue/)).toBeInTheDocument()
    fireEvent.click(buttons[0])
    // After collapsing, use queryByText — should not be in document
    expect(screen.queryByText(/字段：region, total_revenue/)).not.toBeInTheDocument()
  })

  it('expands only the clicked evidence item', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    const buttons = screen.getAllByText('查看证据')
    fireEvent.click(buttons[0])
    // First evidence detail should be visible
    expect(screen.getByText(/字段：region, total_revenue/)).toBeInTheDocument()
    // Second evidence detail should NOT be visible
    expect(screen.queryByText(/字段：region, revenue/)).not.toBeInTheDocument()
    // Click second
    fireEvent.click(buttons[1])
    // Both should be visible now (independent expand)
    expect(screen.getByText(/字段：region, total_revenue/)).toBeInTheDocument()
    expect(screen.getByText(/字段：region, revenue/)).toBeInTheDocument()
  })

  it('shows high confidence indicator in evidence row', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    expect(screen.getByText(/(high|高)/).length || screen.getAllByText(/✅/).length).toBeGreaterThanOrEqual(1)
  })

  it('renders old format evidence (no Phase 5J fields) without error', () => {
    const oldEvidenceNarrative = {
      summary: '旧格式',
      keyFindings: [],
      evidence: [
        { claim: '旧断言', fields: ['a'] },
      ],
      risks: [],
      nextQuestions: [],
    }
    render(<AiNarrative narrative={oldEvidenceNarrative} />)
    expect(screen.getByText('旧断言')).toBeInTheDocument()
    // No "查看证据" button for old format evidence without sourceFields
    expect(screen.queryByText('查看证据')).not.toBeInTheDocument()
  })

  it('does not crash with empty evidence array', () => {
    const emptyEvidence = { summary: 's', keyFindings: [], evidence: [], risks: [], nextQuestions: [] }
    render(<AiNarrative narrative={emptyEvidence} />)
    expect(screen.getByText(/s/)).toBeInTheDocument()
  })

  it('shows confidence reason in expanded detail', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    const buttons = screen.getAllByText('查看证据')
    fireEvent.click(buttons[0])
    expect(screen.getByText(/数据覆盖 30 天/)).toBeInTheDocument()
  })

  it('shows calculation in expanded detail', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    const buttons = screen.getAllByText('查看证据')
    fireEvent.click(buttons[0])
    expect(screen.getByText(/SUM\(r.amount\) GROUP BY region/)).toBeInTheDocument()
  })

  it('shows sourceFields in expanded detail', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    const buttons = screen.getAllByText('查看证据')
    fireEvent.click(buttons[0])
    expect(screen.getByText(/r.region, r.amount/)).toBeInTheDocument()
  })

  it('renders confidence icon based on confidence level', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    // "高" for high confidence, "低" for low confidence should appear
    // The first evidence is high confidence, second is low
    // Both have display values so both show confidence indicators
    const highIndicators = screen.getAllByText(/✅/)
    expect(highIndicators.length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/AiNarrative.test.tsx`
Expected: FAIL — tests reference features not yet implemented (evidence detail expansion, evidenceSummary, etc.)

- [ ] **Step 3: Implement evidence progressive disclosure in AiNarrative.tsx**

Rewrite the evidence section of `AiNarrative.tsx` (lines 149-186). Replace the existing evidence block with:

```tsx
import React, { useState } from 'react'
// Other existing imports remain

// Inside the AiNarrative component, add state:
const [expandedEvidenceIndices, setExpandedEvidenceIndices] = useState<Set<number>>(new Set())

const toggleEvidence = (index: number) => {
  setExpandedEvidenceIndices(prev => {
    const next = new Set(prev)
    if (next.has(index)) {
      next.delete(index)
    } else {
      next.add(index)
    }
    return next
  })
}

// Helper to render confidence label
function renderConfidence(confidence?: 'high' | 'medium' | 'low') {
  if (confidence === 'high') return <span style={{ color: '#52c41a', fontSize: 12 }}>✅ 高</span>
  if (confidence === 'medium') return <span style={{ color: '#fa8c16', fontSize: 12 }}>⚠️ 中</span>
  if (confidence === 'low') return <span style={{ color: '#ff4d4f', fontSize: 12 }}>❌ 低</span>
  return null
}
```

Replace the evidence rendering block (currently lines 150-186) with:

```tsx
{/* Evidence (Phase 5H enhanced + Phase 5J progressive disclosure) */}
{hasEvidence && (
  <div style={{ marginBottom: 12 }}>
    <Text strong style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 6 }}>
      证据
    </Text>

    {/* evidenceSummary (Phase 5J) */}
    {narrative.evidenceSummary && (
      <div style={{
        fontSize: 12, color: '#666', marginBottom: 8, padding: '6px 10px',
        background: '#fafafa', borderRadius: 4, border: '1px solid #f0f0f0',
      }}>
        📎 {narrative.evidenceSummary}
      </div>
    )}

    {narrative.evidence.map((e, i) => {
      const isExpanded = expandedEvidenceIndices.has(i)
      const hasDetails = e.sourceFields || e.calculation || e.confidence || e.sqlSnippet
      return (
        <div key={i} style={{ marginBottom: 4 }}>
          {/* Evidence row */}
          <div style={{
            fontSize: 13, color: '#444', padding: '4px 0 4px 16px',
            lineHeight: 1.6, position: 'relative',
          }}>
            <span style={{ position: 'absolute', left: 0, color: '#52c41a' }}>•</span>
            <span>{e.claim}</span>
            {e.displayValue && (
              <span style={{ color: '#333', fontWeight: 500 }}>
                {' — '}{e.displayValue}
              </span>
            )}
            {!e.displayValue && (e.value || e.significance) && (
              <span style={{ color: '#666', fontSize: 12 }}>
                {' — '}
                {e.value && <span>{e.value}</span>}
                {e.value && e.significance && <span> · </span>}
                {e.significance && <span>{e.significance}</span>}
              </span>
            )}
            {/* Inline confidence indicator */}
            {e.confidence && (
              <span style={{ marginLeft: 8 }}>{renderConfidence(e.confidence)}</span>
            )}
          </div>

          {/* "查看证据" button — only show if there are Phase 5J details */}
          {hasDetails && (
            <div style={{ paddingLeft: 16 }}>
              <span
                onClick={() => toggleEvidence(i)}
                style={{
                  fontSize: 11, color: '#999', cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                {isExpanded ? '收起证据 ▲' : '查看证据 ▼'}
              </span>
            </div>
          )}

          {/* Expanded detail panel */}
          {isExpanded && hasDetails && (
            <div style={{
              margin: '4px 0 6px 16px', padding: '10px 12px',
              background: '#fafafa', borderRadius: 6, border: '1px solid #f0f0f0',
              fontSize: 12, lineHeight: 1.8,
            }}>
              {/* 结论来源 */}
              {e.sourceFields && e.sourceFields.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <Text strong style={{ fontSize: 11, color: '#666', display: 'block' }}>
                    结论来源
                  </Text>
                  <div style={{ color: '#555', paddingLeft: 8 }}>
                    字段：{e.sourceFields.join(', ')}
                    {e.fields.length > 0 && <span>（业务名：{e.fields.join(', ')}）</span>}
                  </div>
                </div>
              )}

              {/* 计算说明 */}
              {e.calculation && (
                <div style={{ marginBottom: 6 }}>
                  <Text strong style={{ fontSize: 11, color: '#666', display: 'block' }}>
                    计算说明
                  </Text>
                  <code style={{
                    display: 'block', padding: '6px 8px', background: '#f5f5f5',
                    borderRadius: 4, fontSize: 11, color: '#1d1d1d',
                    fontFamily: "'Consolas', 'Courier New', monospace",
                    whiteSpace: 'pre-wrap', lineHeight: 1.5,
                  }}>
                    {e.calculation}
                  </code>
                </div>
              )}

              {/* SQL snippet */}
              {e.sqlSnippet && (
                <div style={{ marginBottom: 6 }}>
                  <Text strong style={{ fontSize: 11, color: '#666', display: 'block' }}>
                    关联查询
                  </Text>
                  <code style={{
                    display: 'block', padding: '6px 8px', background: '#f5f5f5',
                    borderRadius: 4, fontSize: 11, color: '#1d1d1d',
                    fontFamily: "'Consolas', 'Courier New', monospace",
                    whiteSpace: 'pre-wrap', lineHeight: 1.5, maxHeight: 160, overflowY: 'auto',
                  }}>
                    {e.sqlSnippet}
                  </code>
                </div>
              )}

              {/* 可信度 */}
              {e.confidence && (
                <div>
                  <Text strong style={{ fontSize: 11, color: '#666', display: 'block' }}>
                    可信度：{renderConfidence(e.confidence)}
                  </Text>
                  {e.confidenceReason && (
                    <div style={{ color: '#555', paddingLeft: 8, fontSize: 11 }}>
                      原因：{e.confidenceReason}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Fallback: old format without Phase 5J fields shows source fields inline */}
          {!hasDetails && e.fields.length > 0 && (
            <div style={{ fontSize: 11, color: '#999', marginTop: 2, paddingLeft: 16 }}>
              → 来源字段：{e.fields.join(', ')}
              {e.sqlSnippet && <span> · SQL: {e.sqlSnippet}</span>}
            </div>
          )}
        </div>
      )
    })}
  </div>
)}
```

The component signature stays the same — `AiNarrativeProps` with `narrative` and `onAskQuestion`.

Note: Delete the old evidence rendering block (Phase 5H version) entirely — the new code replaces it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/AiNarrative.test.tsx`
Expected: PASS — all existing Phase 5H tests AND new Phase 5J tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AiNarrative.tsx frontend/src/components/AiNarrative.test.tsx
git commit -m "feat(phase-5j): add evidence chain progressive disclosure to AiNarrative"
```

---
## Task 4: ProcessPanel mappingChain Display

**Files:**
- Modify: `frontend/src/components/ProcessPanel.tsx`
- Modify: `frontend/src/components/ProcessPanel.test.tsx`

**Interfaces:**
- Consumes: `ProcessInsight` with optional `mappingChain` from Task 1
- Produces: Mapping chain display in ProcessPanel

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/components/ProcessPanel.test.tsx` after the existing tests (after line 65):

```typescript
// --- Phase 5J: mappingChain ---

describe('ProcessPanel mappingChain (Phase 5J)', () => {
  const processWithChain: ProcessInsight = {
    understoodMetrics: ['销售额'],
    understoodDimensions: ['区域'],
    understoodTimeRange: '近 30 天',
    understoodFilters: [],
    semanticGaps: [],
    analysisStrategy: '按区域分组汇总',
    mappingChain: [
      { step: 'intent', label: '识别意图：销售额×区域', detail: '用户查询各区域销售额', fields: ['region', 'total_revenue'] },
      { step: 'sql_plan', label: '生成查询计划', detail: 'FROM REVENUE GROUP BY region', fields: ['region', 'amount'] },
      { step: 'result', label: '查询结果', detail: '共 6 行数据', fields: [] },
      { step: 'conclusion', label: '生成结论', detail: '华东领先 ¥12.3M (29.4%)', fields: [] },
    ],
  }

  it('renders mapping chain section when expanded and mappingChain present', () => {
    render(<ProcessPanel process={processWithChain} />)
    fireEvent.click(screen.getByText(/AI 理解过程/))
    expect(screen.getByText('分析链路')).toBeInTheDocument()
  })

  it('shows all 4 mapping steps in order', () => {
    render(<ProcessPanel process={processWithChain} />)
    fireEvent.click(screen.getByText(/AI 理解过程/))
    expect(screen.getByText(/识别意图：销售额×区域/)).toBeInTheDocument()
    expect(screen.getByText(/生成查询计划/)).toBeInTheDocument()
    expect(screen.getByText(/共 6 行数据/)).toBeInTheDocument()
    expect(screen.getByText(/华东领先 ¥12.3M/)).toBeInTheDocument()
  })

  it('does not show mapping chain when absent (backward compat)', () => {
    const noChain: ProcessInsight = {
      understoodMetrics: ['销售额'], understoodDimensions: ['区域'],
      understoodTimeRange: '近 30 天', understoodFilters: [],
      semanticGaps: [],
    }
    render(<ProcessPanel process={noChain} />)
    fireEvent.click(screen.getByText(/AI 理解过程/))
    expect(screen.queryByText('分析链路')).not.toBeInTheDocument()
  })

  it('renders empty state for process with empty mappingChain', () => {
    const emptyChain: ProcessInsight = {
      understoodMetrics: [], understoodDimensions: [],
      understoodTimeRange: undefined, understoodFilters: [],
      semanticGaps: [], mappingChain: [],
    }
    render(<ProcessPanel process={emptyChain} />)
    fireEvent.click(screen.getByText(/AI 理解过程/))
    // Should not render "分析链路" section
    expect(screen.queryByText('分析链路')).not.toBeInTheDocument()
  })

  it('does not crash when mappingChain is undefined', () => {
    const noChain: ProcessInsight = {
      understoodMetrics: ['a'], understoodDimensions: [],
      understoodTimeRange: undefined, understoodFilters: [],
      semanticGaps: [],
    }
    render(<ProcessPanel process={noChain} />)
    fireEvent.click(screen.getByText(/AI 理解过程/))
    expect(screen.getByText(/指标：a/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/ProcessPanel.test.tsx`
Expected: FAIL — tests for mapping chain not yet implemented.

- [ ] **Step 3: Implement mappingChain display**

Add to `ProcessPanel.tsx` inside the expanded content area, after the context chain section (after line 93 in the current file). Insert before the closing `</>` of `hasContent` block:

```tsx
{/* Phase 5J: mappingChain */}
{process.mappingChain && process.mappingChain.length > 0 && (
  <div style={{ marginTop: 8 }}>
    <Text style={{ color: '#4E7BF5', fontSize: 12 }}>📋 分析链路：</Text>
    <div style={{
      padding: '8px 12px', background: '#f0f5ff', borderRadius: 6,
      marginTop: 4, border: '1px solid #d6e4ff',
    }}>
      {process.mappingChain.map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{
            width: 20, height: 20, borderRadius: '50%', background: '#4E7BF5',
            color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexShrink: 0, marginTop: 1,
          }}>
            {i + 1}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: '#333', fontSize: 12, fontWeight: 500 }}>{item.label}</div>
            {item.detail && (
              <div style={{ color: '#666', fontSize: 11 }}>{item.detail}</div>
            )}
            {item.fields && item.fields.length > 0 && (
              <div style={{ color: '#999', fontSize: 10, marginTop: 1 }}>
                {item.fields.join(', ')}
              </div>
            )}
          </div>
          {i < process.mappingChain!.length - 1 && (
            <div style={{
              position: 'absolute', left: 9, top: 22, bottom: -4,
              width: 1, background: '#d6e4ff',
            }} />
          )}
        </div>
      ))}
    </div>
  </div>
)}
```

Also update `hasContent` to account for `mappingChain`:
```typescript
const hasContent = process.understoodMetrics.length > 0
  || process.understoodDimensions.length > 0
  || process.semanticGaps.length > 0
  || process.analysisStrategy
  || (process.contextChain && process.contextChain.length > 0)
  || (process.mappingChain && process.mappingChain.length > 0)  // ← add this
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/ProcessPanel.test.tsx`
Expected: PASS — all existing AND new tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ProcessPanel.tsx frontend/src/components/ProcessPanel.test.tsx
git commit -m "feat(phase-5j): add mappingChain display to ProcessPanel"
```

---
## Task 5: Evidence Quality Benchmark

**Files:**
- Create: `frontend/scripts/benchmarks/evidenceQuality.bench.ts`
- Modify: `frontend/scripts/runQualityBenchmarks.ts`

**Interfaces:**
- Consumes: Phase 5I's `ModuleReport` type; scenario data from Task 2; `QualityBenchmarkReport` type
- Produces: Evidence quality benchmark module, registered in the benchmark runner

- [ ] **Step 1: Create the benchmark file**

Create `frontend/scripts/benchmarks/evidenceQuality.bench.ts`:

```typescript
import type { EvidenceItem, AiAskResponse } from '../../src/types/aiAsk'
import type { ModuleReport, BenchmarkFailure } from '../runQualityBenchmarks'
import { MOCK_SCENARIOS } from '../../src/api/aiAsk/scenarios/index'
import { FOLLOW_UP_SCENARIOS } from '../../src/api/aiAsk/scenarios/followUpScenarios'

function collectEvidence(): Array<{ claim: string; scenario: string; evidence: EvidenceItem }> {
  const items: Array<{ claim: string; scenario: string; evidence: EvidenceItem }> = []

  // Collect from main scenarios
  for (const scenario of MOCK_SCENARIOS) {
    for (const ev of scenario.response.narrative.evidence) {
      items.push({ claim: ev.claim, scenario: scenario.id, evidence: ev })
    }
  }

  // Collect from follow-up scenarios
  for (const scenario of FOLLOW_UP_SCENARIOS) {
    for (const ev of scenario.response.narrative.evidence) {
      items.push({ claim: ev.claim, scenario: scenario.parentScenarioId, evidence: ev })
    }
  }

  return items
}

export async function runEvidenceQualityBenchmark(): Promise<ModuleReport> {
  const allEvidence = collectEvidence()
  const failures: BenchmarkFailure[] = []

  // Check each evidence item from scenarios (strict completeness)
  for (const { claim, scenario, evidence } of allEvidence) {
    const issues: string[] = []

    // Field completeness (scenario evidence must have all Phase 5J fields)
    if (!evidence.claim) issues.push('missing claim')
    if (!evidence.fields || evidence.fields.length === 0) issues.push('missing fields')
    if (!evidence.sqlSnippet) issues.push('missing sqlSnippet')
    if (!evidence.calculation) issues.push('missing calculation')
    if (!evidence.confidence) issues.push('missing confidence')

    // Confidence reason for non-high confidence
    if (evidence.confidence && evidence.confidence !== 'high' && !evidence.confidenceReason) {
      issues.push('non-high confidence missing confidenceReason')
    }

    // Source fields alignment rules:
    // 1. sourceFields must exist and be non-empty
    if (!evidence.sourceFields || evidence.sourceFields.length === 0) {
      issues.push('missing sourceFields')
    } else {
      // 2. Each entry must be a string
      for (const sf of evidence.sourceFields) {
        if (typeof sf !== 'string') {
          issues.push(`sourceFields contains non-string: ${sf}`)
        }
      }
      // 3. At least one sourceFields last segment matches/contains a field in fields
      const fieldNames = evidence.fields.map(f => f.toLowerCase())
      const hasAlignment = evidence.sourceFields.some(sf => {
        const lastSegment = sf.split('.').pop()?.toLowerCase() ?? ''
        return fieldNames.some(f => lastSegment.includes(f) || f.includes(lastSegment))
      })
      if (!hasAlignment) {
        issues.push('sourceFields no last-segment alignment with fields')
      }
    }

    if (issues.length > 0) {
      failures.push({ label: `${scenario} / ${claim}`, expected: 'all checks pass', actual: issues.join('; '), detail: `issues: ${issues.join(', ')}` })
    }
  }

  // Backward compatibility: synthetic legacy evidence must not crash the benchmark tool
  const legacyCases = [
    { claim: '旧格式断言', fields: ['a'] },
    { claim: '旧格式含值', fields: ['x'], value: '100', significance: '测试' },
    { claim: '旧格式含SQL', fields: ['y'], sqlSnippet: 'SELECT * FROM t' },
  ]
  for (const legacy of legacyCases) {
    // Just check that accessing optional fields on legacy data doesn't crash
    const _claim = legacy.claim
    const _fields = legacy.fields
    const _sourceFields = (legacy as any).sourceFields
    const _calculation = (legacy as any).calculation
    const _confidence = (legacy as any).confidence
    // All access patterns used in the benchmark should be safe
    const sourceFieldsOk = !_sourceFields || (Array.isArray(_sourceFields) && _sourceFields.every(sf => typeof sf === 'string'))
    if (!sourceFieldsOk) {
      failures.push({ label: `legacy / ${legacy.claim}`, expected: 'no crash on legacy evidence', actual: 'sourceFields access caused issue' })
    }
  }

  return {
    total: allEvidence.length + legacyCases.length,
    passed: allEvidence.length + legacyCases.length - failures.length,
    failed: failures.length,
    failures,
  }
}
```

- [ ] **Step 2: Register benchmark in runQualityBenchmarks.ts**

Add import at top of `frontend/scripts/runQualityBenchmarks.ts` (after line 8):
```typescript
import { runEvidenceQualityBenchmark } from './benchmarks/evidenceQuality.bench'
```

Add the module to `QualityBenchmarkReport['modules']` type (lines 37-43):
```typescript
export interface QualityBenchmarkReport {
  timestamp: string
  duration: number
  summary: BenchmarkSummary
  modules: {
    inputGuard: ModuleReport
    contextPolicy: ModuleReport
    followUpDetector: ModuleReport
    adapter: ModuleReport
    evidenceQuality: ModuleReport  // ← add this
  }
}
```

Update the `main` function (around lines 59-66) to include the new benchmark:
```typescript
const [inputGuard, contextPolicy, followUpDetector, adapter, evidenceQuality] = await Promise.all([
  runInputGuardBenchmark(),
  runContextPolicyBenchmark(),
  runFollowUpBenchmark(),
  runAdapterBenchmark(),
  runEvidenceQualityBenchmark(),  // ← add this
])

const modules = { inputGuard, contextPolicy, followUpDetector, adapter, evidenceQuality }  // ← add here
```

- [ ] **Step 3: Run benchmark to verify**

Run: `cd frontend && npx tsx scripts/runQualityBenchmarks.ts`
Expected: All 5 modules pass. Check evidence quality section:
```
evidenceQuality:
  total: N  (number of evidence items across all scenarios)
  passed: N
  failed: 0
```

- [ ] **Step 4: Commit**

```bash
git add frontend/scripts/benchmarks/evidenceQuality.bench.ts frontend/scripts/runQualityBenchmarks.ts
git commit -m "feat(phase-5j): add evidence quality benchmark module"
```

---
## Task 6: Final Integration Verification and Constraint Check

- [ ] **Step 1: Run full test suite**

Run: `cd frontend && npm test`
Expected: PASS — all unit and component tests pass.

- [ ] **Step 2: TypeScript compilation check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Production build**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Benchmark runner**

Run: `cd frontend && npx tsx scripts/runQualityBenchmarks.ts`
Expected: All 5 benchmark modules pass, including evidenceQuality.

- [ ] **Step 5: Python backend tests (if applicable)**

Run: `python -m pytest tests/ -q`
Expected: All backend tests pass (if they exist) or command not found (acceptable).

- [ ] **Step 6: Constraint verification**

Check each line item:
- [ ] No new backend APIs, DB changes, or migrations — grep for `app.`, `router.`, `@api`, `knex`, `prisma`, `sequelize` in changed files → should be 0
- [ ] No real LLM integration — grep for `openai`, `anthropic`, `bedrock`, `llm` in changed files → should be 0
- [ ] No Playwright / Cypress — `playwright.config`, `cypress` in changed files → should be 0
- [ ] No Monaco DOM testing — grep for `monaco` or `editor` in test files → should be 0
- [ ] No store/adapter protocol changes — `adapter.ts`, `aiAskStore.ts`, `mockAdapter.ts` not modified
- [ ] No `dwhrpt` hardcoded in business logic — only in mock scenario files' `datasourceName` field
- [ ] All scenario evidence includes the Phase 5J fields added in Task 2
- [ ] All new fields are `optional` — verify `?` on each new field in `aiAsk.ts`
- [ ] Benchmark is a dev tool, not a CI gate — no `.github/` workflow changed

Run: `git status --short --branch`
Expected: Only the files listed in File Manifest have changes.

- [ ] **Step 7: Final commit**

```bash
# This is just a verification step — commit if needed, otherwise note results
```

---
## Self-Review Checklist

1. **Spec coverage:**
   - §3.1 EvidenceItem 扩展 → Task 1 ✅
   - §3.2 AiInsightNarrative evidenceSummary → Task 1 ✅
   - §3.3 ProcessInsight mappingChain → Task 1 ✅
   - §5.1 Mock 场景数据扩展 → Task 2 ✅
   - §4.2 AiNarrative 证据展开交互 → Task 3 ✅
   - §4.3 ProcessPanel 映射链升级 → Task 4 ✅
   - §5.2 Benchmark → Task 5 ✅
   - §5.3 Benchmark is dev tool, not CI → Task 5 ✅
   - §6.3 无变更文件 → verified in Task 6 ✅

2. **Placeholder scan:** No TBD, TODO, "implement later", `// ...` pseudo-code, or "similar to" patterns found in this plan. Every step has concrete code, file paths, and commands.

3. **Type consistency:**
   - `EvidenceItem` fields in Task 1 match mock scenario fills in Task 2.
   - `ProcessInsight.mappingChain` in Task 1 matches tests in Task 4.
   - `confidence` type `'high' | 'medium' | 'low'` used consistently across all tasks.
   - `relatedIntent` shape used consistently across Task 1 (type) and Task 2 (scenario data).
