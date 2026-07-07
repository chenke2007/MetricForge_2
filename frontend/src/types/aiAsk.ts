// frontend/src/types/aiAsk.ts

export type ChartType = 'bar' | 'line' | 'pie' | 'table' | 'metric-card' | 'combo'
export type Aggregation = 'sum' | 'avg' | 'count' | 'min' | 'max'
export type ChartTheme = 'business-light' | 'executive-blue' | 'soft-gradient'
export type GapReason = 'not_found' | 'ambiguous' | 'incomplete'

// --- Phase 5H: Follow-up & Context ---

export type FollowUpType =
  | 'why_down'
  | 'drill_down'
  | 'switch_metric'
  | 'top_n'
  | 'explain_anomaly'
  | 'time_shift'
  | 'general_followup'

export interface FollowUpQuestion {
  type: FollowUpType
  targetFields?: string[]
  targetDimension?: string
  targetValue?: string
  relatedMetrics?: string[]
  relatedDimensions?: string[]
  relatedFilter?: string
  timeRangeShift?: string
  confidence: 'high' | 'medium' | 'low'
  inferenceReason?: string
}

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

export interface RiskItem {
  risk: string
  impact?: string
  suggestion?: string
}

export interface NextQuestion {
  question: string
  followUpType?: FollowUpType
  contextHint?: string
}

export type MetricIcon = 'revenue' | 'orders' | 'customers' | 'profit' | 'rate'

export interface MetricCard {
  label: string
  value: string
  change?: string | null
  changeDirection?: 'up' | 'down' | 'flat'
  icon?: MetricIcon
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
  evidence: EvidenceItem[]
  risks: Array<string | RiskItem>
  nextQuestions: Array<string | NextQuestion>
  // Phase 5H additions:
  conclusion?: string

  // Phase 5J:
  evidenceSummary?: string
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
  // Phase 5H additions:
  followUp?: FollowUpQuestion
  contextSummary?: string
}
