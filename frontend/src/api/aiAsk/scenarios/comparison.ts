// frontend/src/api/aiAsk/scenarios/comparison.ts
import type { AiAskResponse } from '../../../types/aiAsk'

export const INTENT_INFO = { metrics: ['收入'], dimensions: ['区域', '年份'], filters: ['同比对比'], timeRange: '今年 vs 去年' }

export const RESPONSE: AiAskResponse = {
  question: '今年和去年各区域收入同比对比？',
  intent: INTENT_INFO,
  sqlPlan: {
    datasourceId: 2, datasourceName: 'dwhrpt',
    sql: "SELECT r.region,\n  SUM(CASE WHEN EXTRACT(YEAR FROM t.transaction_date) = EXTRACT(YEAR FROM SYSDATE) THEN t.amount ELSE 0 END) AS revenue_this,\n  SUM(CASE WHEN EXTRACT(YEAR FROM t.transaction_date) = EXTRACT(YEAR FROM SYSDATE) - 1 THEN t.amount ELSE 0 END) AS revenue_last,\n  ROUND((SUM(CASE WHEN EXTRACT(YEAR FROM t.transaction_date) = EXTRACT(YEAR FROM SYSDATE) THEN t.amount ELSE 0 END) - SUM(CASE WHEN EXTRACT(YEAR FROM t.transaction_date) = EXTRACT(YEAR FROM SYSDATE) - 1 THEN t.amount ELSE 0 END)) / NULLIF(SUM(CASE WHEN EXTRACT(YEAR FROM t.transaction_date) = EXTRACT(YEAR FROM SYSDATE) - 1 THEN t.amount ELSE 0 END), 0) * 100, 1) AS yoy_pct\nFROM REVENUE r JOIN TRANSACTIONS t ON ...\nGROUP BY r.region\nORDER BY yoy_pct DESC",
    tables: ['REVENUE', 'TRANSACTIONS'], fields: ['region', 'revenue_this', 'revenue_last', 'yoy_pct'],
    assumptions: ['使用完整日历年对比'],
    safetyWarnings: ['SQL 使用了 JOIN 语法'],
  },
  resultSummary: { rowCount: 6, durationMs: 420, truncated: false },
  chartSuggestions: [],
  narrative: {
    summary: '今年整体收入同比增长 15.3%，其中西南区域增长最快达 22%，所有区域均实现正增长。',
    keyFindings: ['整体同比增长 15.3%', '西南区域同比增长 22%，增速领跑全区域'],
    evidence: [
      { claim: '西南增长最快', fields: ['region', 'yoy_pct'], sqlSnippet: 'GROUP BY region ORDER BY yoy_pct DESC' },
    ],
    risks: ['增长包含通胀因素'],
    nextQuestions: ['各区域季度同比趋势如何？', '增长主要来自哪些产品线？'],
  },
  semanticGaps: [],
}

export const CHART_DATA = {
  columns: ['region', 'revenue_this', 'revenue_last', 'yoy_pct'],
  rows: [
    ['华东', 12300000, 10800000, 13.9], ['华南', 9800000, 8600000, 14.0],
    ['华北', 8200000, 7200000, 13.9], ['西南', 5600000, 4600000, 21.7],
    ['西北', 3100000, 2700000, 14.8], ['东北', 2800000, 2400000, 16.7],
  ],
}

export const METRIC_CARDS = [
  { label: '今年总收入', value: '¥41.8M', change: '+15.3%', changeDirection: 'up' as const, icon: 'revenue' as const },
  { label: '去年同期', value: '¥36.2M', change: null, changeDirection: 'flat' as const },
  { label: '增长最快区域', value: '西南 +22%', change: '+22%', changeDirection: 'up' as const, icon: 'profit' as const },
]
