// frontend/src/api/aiAsk/scenarios/default.ts
import type { AiAskResponse } from '../../../types/aiAsk'

export const INTENT_INFO = { metrics: ['销售额', '订单数'], dimensions: ['区域'], filters: [] }

export const RESPONSE: AiAskResponse = {
  question: '各区域销售额和订单数？',
  intent: INTENT_INFO,
  sqlPlan: {
    datasourceId: 2, datasourceName: 'dwhrpt',
    sql: 'SELECT r.region, SUM(r.amount) AS total_sales, COUNT(t.id) AS order_count\nFROM REVENUE r JOIN TRANSACTIONS t ON ...\nGROUP BY r.region\nORDER BY total_sales DESC',
    tables: ['REVENUE', 'TRANSACTIONS'], fields: ['region', 'total_sales', 'order_count'],
    assumptions: ['各区域口径一致'],
    safetyWarnings: [],
  },
  resultSummary: { rowCount: 6, durationMs: 200, truncated: false },
  chartSuggestions: [],
  narrative: {
    summary: '各区域销售数据分布不均，华东领先优势明显。',
    keyFindings: ['华东销售额领先', '订单数与销售额呈正相关'],
    evidence: [
      { claim: '华东领先', fields: ['region', 'total_sales'] },
    ],
    risks: ['数据口径需确认'],
    nextQuestions: ['各区域毛利率如何？', '各区域同比趋势？'],
  },
  semanticGaps: [],
}

export const CHART_DATA = {
  columns: ['region', 'total_sales', 'order_count'],
  rows: [
    ['华东', 12300000, 4500], ['华南', 9800000, 3800],
    ['华北', 8200000, 3200], ['西南', 5600000, 2200],
    ['西北', 3100000, 1200], ['东北', 2800000, 1100],
  ],
}

export const METRIC_CARDS = [
  { label: '总销售额', value: '¥41.8M', icon: 'revenue' as const },
  { label: '总订单', value: '15,387', icon: 'orders' as const },
]
