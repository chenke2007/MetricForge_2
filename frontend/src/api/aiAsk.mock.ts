// frontend/src/api/aiAsk.mock.ts
import type { AiAskResponse } from '../types/aiAsk'

export const MOCK_CHART_DATA = {
  columns: ['region', 'total_revenue', 'gross_margin', 'order_count'],
  rows: [
    ['华东', 12300000, 32.5, 4201],
    ['华南', 9800000, 28.7, 3549],
    ['华北', 8200000, 35.1, 2983],
    ['西南', 5600000, 30.2, 2102],
    ['西北', 3100000, 33.8, 1387],
    ['东北', 2800000, 29.4, 1165],
  ],
}

export const MOCK_ASK_RESPONSE: AiAskResponse = {
  question: '近 30 天各区域的销售额和毛利率是多少？',
  intent: {
    metrics: ['销售额', '毛利率'],
    dimensions: ['区域'],
    filters: [],
    timeRange: '近 30 天',
  },
  sqlPlan: {
    datasourceId: 2,
    datasourceName: 'dwhrpt',
    sql: `SELECT r.region,\n       SUM(r.amount) AS total_revenue,\n       AVG(r.gross_margin_rate) AS gross_margin,\n       COUNT(DISTINCT r.order_id) AS order_count\nFROM REVENUE r\nWHERE r.transaction_date >= SYSDATE - 30\nGROUP BY r.region\nORDER BY total_revenue DESC`,
    tables: ['REVENUE'],
    fields: ['region', 'total_revenue', 'gross_margin', 'order_count'],
    assumptions: ['使用 SYSDATE 作为当前日期边界', 'AMOUNT 字段为数值类型'],
    safetyWarnings: [],
  },
  resultSummary: { rowCount: 6, durationMs: 230, truncated: false },
  chartSuggestions: [
    {
      title: '各区域销售额排行',
      subtitle: '近 30 天数据',
      chartType: 'bar',
      xField: 'region',
      yFields: ['total_revenue'],
      aggregation: 'sum',
      sort: { field: 'total_revenue', direction: 'desc' },
      rationale: '柱状图直观对比各区域销售额高低，按降序排列可快速识别头部区域',
      limitations: ['仅展示近 30 天数据，未包含历史趋势'],
    },
    {
      title: '各区域毛利率对比',
      subtitle: '近 30 天',
      chartType: 'bar',
      xField: 'region',
      yFields: ['gross_margin'],
      aggregation: 'avg',
      rationale: '各区域毛利率横向对比，帮助识别盈利能力差异',
      limitations: ['毛利率为简单平均值，未加权计算'],
    },
    {
      title: '销售额与毛利率分布',
      subtitle: '气泡图视角',
      chartType: 'pie',
      xField: 'region',
      yFields: ['total_revenue'],
      rationale: '饼图展示各区域销售额占比结构',
      limitations: ['饼图仅展示占比，不反映绝对数值差异'],
    },
  ],
  narrative: {
    summary: '近 30 天各区域销售额呈梯度分布，华东地区以 1,230 万领跑，占总销售额的 30%；华北地区毛利率最高达 35.1%，盈利能力突出。',
    keyFindings: [
      '华东区域销售额 1,230 万，领先第二名华南 25.5%',
      '华北区域毛利率 35.1%，为所有区域最高',
      '西北和东北区域销售额均低于 400 万，贡献度较低',
    ],
    evidence: [
      { claim: '华东销售额领先', fields: ['region', 'total_revenue'], sqlSnippet: 'SUM(r.amount) ... GROUP BY r.region ORDER BY 2 DESC' },
      { claim: '华北毛利率最高', fields: ['region', 'gross_margin'], sqlSnippet: 'AVG(r.gross_margin_rate) ... GROUP BY r.region' },
    ],
    risks: ['毛利率计算为简单平均值，未加权', '数据仅覆盖 30 天，不反映长期趋势'],
    nextQuestions: [
      '为什么华东区域订单数下降？',
      '近 6 个月各区域毛利率趋势如何？',
      '按客户等级拆分销售额分布',
    ],
  },
  semanticGaps: [],
}
