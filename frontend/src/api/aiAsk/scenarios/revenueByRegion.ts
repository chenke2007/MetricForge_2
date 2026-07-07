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
      {
        claim: '华东领先',
        fields: ['region', 'total_revenue'],
        sqlSnippet: 'SUM(r.amount) GROUP BY region',
        sourceFields: ['r.region', 'r.amount'],
        calculation: 'SUM(r.amount) GROUP BY r.region ORDER BY total_revenue DESC',
        confidence: 'high',
        confidenceReason: '数据基于完整 30 天交易记录，无缺失分区',
        relatedIntent: { metrics: ['销售额'], dimensions: ['区域'], filters: [], timeRange: '近 30 天' },
        displayValue: '¥12.3M',
      },
    ],
    evidenceSummary: '共 1 项证据：华东区域销售额 ¥12.3M 领先所有区域。',
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
