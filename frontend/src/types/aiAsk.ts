// frontend/src/types/aiAsk.ts

export type ChartType = 'bar' | 'line' | 'pie' | 'table' | 'metric-card' | 'combo'
export type Aggregation = 'sum' | 'avg' | 'count' | 'min' | 'max'
export type ChartTheme = 'business-light' | 'executive-blue' | 'soft-gradient'
export type GapReason = 'not_found' | 'ambiguous' | 'incomplete'

export interface MetricCard {
  label: string
  value: string
  change?: string
  changeDirection?: 'up' | 'down' | 'flat'
}

export interface AiChartSpec {
  title: string
  subtitle?: string
  chartType: ChartType
  xField?: string
  yFields: string[]
  seriesField?: string
  aggregation?: Aggregation
  sort?: { field: string; direction: 'asc' | 'desc' }
  metricCards?: MetricCard[]
  theme?: ChartTheme
  rationale: string
  limitations: string[]
}

export interface SemanticGap {
  field: string
  reason: GapReason
  candidates?: string[]
  suggestion?: string
}

export interface AiInsightNarrative {
  summary: string
  keyFindings: string[]
  evidence: Array<{
    claim: string
    fields: string[]
    sqlSnippet?: string
  }>
  risks: string[]
  nextQuestions: string[]
}

export interface AiAskResponse {
  question: string
  intent: {
    metrics: string[]
    dimensions: string[]
    filters: string[]
    timeRange?: string
  }
  sqlPlan: {
    datasourceId: number
    datasourceName: string
    sql: string
    tables: string[]
    fields: string[]
    assumptions: string[]
    safetyWarnings: string[]
  }
  resultSummary?: {
    rowCount: number
    durationMs: number
    truncated?: boolean
  }
  chartSuggestions: AiChartSpec[]
  narrative: AiInsightNarrative
  semanticGaps: SemanticGap[]
}
