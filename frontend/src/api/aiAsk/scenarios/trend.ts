// frontend/src/api/aiAsk/scenarios/trend.ts
import type { AiAskResponse } from '../../../types/aiAsk'

export const INTENT_INFO = { metrics: ['收入'], dimensions: ['月份'], filters: [], timeRange: '近 6 个月' }

export const RESPONSE: AiAskResponse = {
  question: '近 6 个月收入趋势如何？',
  intent: INTENT_INFO,
  sqlPlan: {
    datasourceId: 2, datasourceName: 'dwhrpt',
    sql: "SELECT TO_CHAR(t.transaction_date, 'YYYY-MM') AS month, SUM(t.amount) AS total_revenue\nFROM TRANSACTIONS t\nWHERE t.transaction_date >= ADD_MONTHS(SYSDATE, -6)\nGROUP BY TO_CHAR(t.transaction_date, 'YYYY-MM')\nORDER BY month",
    tables: ['TRANSACTIONS'], fields: ['month', 'total_revenue'],
    assumptions: ['使用 SYSDATE 作为当前日期边界'],
    safetyWarnings: [],
  },
  resultSummary: { rowCount: 6, durationMs: 180, truncated: false },
  chartSuggestions: [],
  narrative: {
    summary: '近 6 个月收入呈稳步上升趋势，本月收入 ¥16.4M 创近 6 月新高，环比增长 8.2%。',
    keyFindings: ['6 月收入 ¥16.4M，环比增长 8.2%', '连续 4 个月保持正增长，Q2 整体表现强劲'],
    evidence: [
      { claim: '持续增长', fields: ['month', 'total_revenue'] },
    ],
    risks: ['历史数据仅 6 个月，无法反映年度周期'],
    nextQuestions: ['各产品线收入趋势如何？', '同比增长率是多少？'],
  },
  semanticGaps: [],
}

export const CHART_DATA = {
  columns: ['month', 'total_revenue'],
  rows: [
    ['2026-01', 11800000], ['2026-02', 12500000], ['2026-03', 13200000],
    ['2026-04', 13800000], ['2026-05', 15100000], ['2026-06', 16400000],
  ],
}

export const METRIC_CARDS = [
  { label: '近 6 月总收入', value: '¥78.2M', change: '+15.6%', changeDirection: 'up' as const, icon: 'revenue' as const },
  { label: '月均收入', value: '¥13.0M', change: null, changeDirection: 'flat' as const },
  { label: '最新月收入', value: '¥16.4M', change: '+8.2%', changeDirection: 'up' as const, icon: 'profit' as const },
]
