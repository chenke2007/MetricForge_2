// frontend/scripts/fixtures/multiRoundHistory.ts
import type { AiAskResponse } from '../../src/types/aiAsk'

export const REVENUE_BY_REGION_RESPONSE: AiAskResponse = {
  question: '各区域销售额表现如何？',
  intent: { metrics: ['销售额'], dimensions: ['区域'], filters: [], timeRange: '近 30 天' },
  sqlPlan: {
    datasourceId: 2,
    datasourceName: 'dwhrpt',
    sql: 'SELECT r.region, SUM(r.amount) AS total_revenue\nFROM REVENUE r\nWHERE r.transaction_date >= SYSDATE - 30\nGROUP BY r.region\nORDER BY total_revenue DESC',
    tables: ['REVENUE'],
    fields: ['region', 'total_revenue'],
    assumptions: ['使用 SYSDATE 作为当前日期边界'],
    safetyWarnings: [],
  },
  resultSummary: { rowCount: 6, durationMs: 230, truncated: false },
  chartSuggestions: [],
  narrative: {
    summary: '近 30 天各区域销售额呈梯度分布，华东以 ¥12.3M 领跑，占总销售额的 29.4%。',
    keyFindings: ['华东区域销售额 ¥12.3M，领先第二华南 25.5%', '西北+东北区域合计贡献仅 14%，提升空间大'],
    evidence: [{ claim: '华东领先', fields: ['region', 'total_revenue'], sqlSnippet: 'SUM(r.amount) GROUP BY region' }],
    risks: ['数据仅覆盖 30 天'],
    nextQuestions: ['华东区域近 6 个月趋势如何？', '各区域毛利率分布情况？'],
  },
  semanticGaps: [],
}

export function buildFixtureResponse(overrides?: Partial<AiAskResponse>): AiAskResponse {
  return { ...REVENUE_BY_REGION_RESPONSE, ...overrides }
}
