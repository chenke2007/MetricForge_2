// frontend/src/api/aiAsk/scenarios/topN.ts
import type { AiAskResponse } from '../../../types/aiAsk'

export const INTENT_INFO = { metrics: ['收入'], dimensions: ['客户'], filters: ['Top 10'], timeRange: '本月' }

export const RESPONSE: AiAskResponse = {
  question: '本月收入 Top 10 客户？',
  intent: INTENT_INFO,
  sqlPlan: {
    datasourceId: 2, datasourceName: 'dwhrpt',
    sql: "SELECT c.customer_name, SUM(t.amount) AS total_revenue\nFROM TRANSACTIONS t JOIN CUSTOMERS c ON t.customer_id = c.id\nWHERE t.transaction_date >= TRUNC(SYSDATE, 'MM')\nGROUP BY c.customer_name\nORDER BY total_revenue DESC\nFETCH FIRST 10 ROWS ONLY",
    tables: ['TRANSACTIONS', 'CUSTOMERS'], fields: ['customer_name', 'total_revenue'],
    assumptions: ['本月从月初开始计算'],
    safetyWarnings: [],
  },
  resultSummary: { rowCount: 10, durationMs: 350, truncated: false },
  chartSuggestions: [],
  narrative: {
    summary: '本月 Top 10 客户贡献总收入 ¥12.5M，占全月营收的 76.2%，客户集中度较高。',
    keyFindings: ['Top 1 客户贡献 ¥2.3M，占 18.3%', 'Top 10 门槛客户收入 ¥0.8M'],
    evidence: [
      {
        claim: '客户集中度高',
        fields: ['customer_name', 'total_revenue'],
        sourceFields: ['c.customer_name', 't.amount'],
        calculation: 'SUM(t.amount) GROUP BY c.customer_name ORDER BY total_revenue DESC FETCH FIRST 10 ROWS ONLY',
        confidence: 'high',
        confidenceReason: '本月完整交易数据，TOP 10 排名稳定',
        relatedIntent: { metrics: ['收入'], dimensions: ['客户'], filters: ['Top 10'], timeRange: '本月' },
        displayValue: '¥12.5M (Top 10 合计)',
        sqlSnippet: 'SUM(t.amount) GROUP BY customer_name ORDER BY total_revenue DESC FETCH FIRST 10 ROWS ONLY',
      },
    ],
    evidenceSummary: '共 1 项证据：Top 10 客户集中度 76.2%，Top 1 客户贡献 ¥2.3M。',
    risks: ['Top 10 客户集中度高，客户流失风险较大'],
    nextQuestions: ['Top 10 客户去年同期表现如何？', '哪些客户最近 3 个月下滑明显？'],
  },
  semanticGaps: [],
}

export const CHART_DATA = {
  columns: ['customer_name', 'total_revenue'],
  rows: [
    ['华为技术', 2300000], ['阿里集团', 1950000], ['腾讯科技', 1680000],
    ['字节跳动', 1420000], ['中国移动', 1210000], ['中国电信', 1050000],
    ['比亚迪', 950000], ['京东集团', 880000], ['美团', 820000], ['网易', 780000],
  ],
}

export const METRIC_CARDS = [
  { label: 'Top 10 总收入', value: '¥12.5M', change: '+5.4%', changeDirection: 'up' as const, icon: 'revenue' as const },
  { label: '门槛收入', value: '¥0.8M', change: null, changeDirection: 'flat' as const, icon: 'profit' as const },
  { label: 'Top1 占比', value: '18.3%', change: '+2.1%', changeDirection: 'up' as const, icon: 'rate' as const },
]
