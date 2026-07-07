import type { FollowUpType, AiAskResponse, AiInsightNarrative, AiChartSpec } from '../../../types/aiAsk'

export interface FollowUpScenarioData {
  parentScenarioId: string
  followUpType: FollowUpType
  matchPatterns: RegExp[]
  response: {
    intent: AiAskResponse['intent']
    sqlPlan: AiAskResponse['sqlPlan']
    resultSummary?: AiAskResponse['resultSummary']
    chartSuggestions: AiChartSpec[]
    narrative: AiInsightNarrative
  }
  chartData?: { columns: string[]; rows: any[][] }
  contextSummary: string
}

export const FOLLOW_UP_SCENARIOS: FollowUpScenarioData[] = [
  // Scenario 1: revenue-by-region → drill_down → "为什么华东最高" / "华东具体"
  {
    parentScenarioId: 'revenue-by-region',
    followUpType: 'drill_down',
    matchPatterns: [/华东/, /为什么.*华东/, /华东.*具体/, /华东.*拆/, /华东.*细分/],
    response: {
      intent: { metrics: ['销售额'], dimensions: ['区域', '产品线'], filters: ['区域=华东'], timeRange: '近 30 天' },
      sqlPlan: {
        datasourceId: 2, datasourceName: 'dwhrpt',
        sql: "SELECT p.product_line, SUM(r.amount) AS revenue\nFROM REVENUE r\nJOIN PRODUCTS p ON r.product_id = p.id\nWHERE r.region = '华东'\n  AND r.transaction_date >= SYSDATE - 30\nGROUP BY p.product_line\nORDER BY revenue DESC",
        tables: ['REVENUE', 'PRODUCTS'], fields: ['product_line', 'revenue'],
        assumptions: ['使用 SYSDATE 作为当前日期边界'], safetyWarnings: [],
      },
      resultSummary: { rowCount: 4, durationMs: 185, truncated: false },
      chartSuggestions: [],
      narrative: {
        summary: '华东区域各产品线销售额分布中，电子产品以 ¥5.2M 领先，占华东总销售额的 42.3%。',
        keyFindings: ['电子产品贡献华东 42.3% 销售额', '服装线销售额 ¥3.1M，毛利率 43.2% 为最高'],
        evidence: [
          {
            claim: '电子产品领先',
            fields: ['product_line', 'revenue'],
            value: '¥5.2M',
            significance: '占华东 42.3%',
            sourceFields: ['p.product_line', 'r.amount'],
            calculation: 'SUM(r.amount) GROUP BY p.product_line ORDER BY revenue DESC',
            confidence: 'high',
            confidenceReason: '基于华东区域完整 30 天产品线销售数据',
            relatedIntent: { metrics: ['销售额'], dimensions: ['区域', '产品线'], filters: ['区域=华东'], timeRange: '近 30 天' },
            displayValue: '¥5.2M',
            sqlSnippet: 'SUM(r.amount) GROUP BY product_line ORDER BY revenue DESC',
          },
          {
            claim: '服装线高毛利',
            fields: ['product_line', 'revenue', 'margin'],
            value: '¥3.1M',
            significance: '毛利率 43.2%',
            sourceFields: ['p.product_line', 'r.amount', 'p.margin'],
            calculation: 'SUM(r.amount) GROUP BY p.product_line; margin from product master',
            confidence: 'medium',
            confidenceReason: '毛利率数据来源于产品主数据，可能存在延迟更新',
            relatedIntent: { metrics: ['销售额'], dimensions: ['区域', '产品线'], filters: ['区域=华东'], timeRange: '近 30 天' },
            displayValue: '¥3.1M / 毛利率 43.2%',
            sqlSnippet: 'SUM(r.amount) GROUP BY product_line',
          },
        ],
        risks: ['数据仅覆盖 30 天', '部分产品线数据可能不完整'],
        evidenceSummary: '共 2 项证据：电子产品 ¥5.2M 领先华东；服装线毛利率 43.2% 为最高。',
        nextQuestions: ['电子产品近 6 个月趋势如何？', '华东各渠道销售额分布？'],
        conclusion: '华东区域应重点关注电子产品线，同时提升服装线的销售额以发挥其高毛利优势。',
      },
    },
    chartData: {
      columns: ['product_line', 'revenue'],
      rows: [['电子产品', 5200000], ['服装', 3100000], ['食品', 2500000], ['家居', 1500000]],
    },
    contextSummary: '上一轮：各区域销售额 → 本轮追问：华东各产品线销售额',
  },

  // Scenario 2: revenue-by-region → why_down → "为什么下降"
  {
    parentScenarioId: 'revenue-by-region',
    followUpType: 'why_down',
    matchPatterns: [/为什么.*下/, /下降.*原因/, /减少.*原因/, /why.*down/i],
    response: {
      intent: { metrics: ['销售额'], dimensions: ['月份'], filters: ['下降归因'], timeRange: '近 30 天' },
      sqlPlan: {
        datasourceId: 2, datasourceName: 'dwhrpt',
        sql: "SELECT TRUNC(r.transaction_date, 'MM') AS month, SUM(r.amount) AS revenue\nFROM REVENUE r\nWHERE r.transaction_date >= SYSDATE - 30\nGROUP BY TRUNC(r.transaction_date, 'MM')\nORDER BY month",
        tables: ['REVENUE'], fields: ['month', 'revenue'],
        assumptions: ['使用 SYSDATE 作为当前日期边界'], safetyWarnings: ['数据仅覆盖 30 天，趋势可能不具代表性'],
      },
      resultSummary: { rowCount: 3, durationMs: 210, truncated: false },
      chartSuggestions: [],
      narrative: {
        summary: '近 30 天销售额呈前高后低趋势，最后一周销售额较首周下降 18.5%，主要受华东区域订单量减少影响。',
        keyFindings: ['最后一周环比下降 18.5%', '华东区域贡献了整体下降的 42%'],
        evidence: [
          {
            claim: '整体下降',
            fields: ['month', 'revenue'],
            value: '18.5%',
            significance: '最后一周 vs 首周',
            sourceFields: ['r.month', 'r.revenue'],
            calculation: "SUM(r.amount) GROUP BY TRUNC(transaction_date, 'MM') ORDER BY month",
            confidence: 'high',
            confidenceReason: '基于 30 天完整交易数据，下降趋势明显',
            relatedIntent: { metrics: ['销售额'], dimensions: ['月份'], filters: ['下降归因'], timeRange: '近 30 天' },
            displayValue: '-18.5%',
            sqlSnippet: "SUM(r.amount) GROUP BY TRUNC(transaction_date, 'MM') ORDER BY month",
          },
          {
            claim: '华东区域主因',
            fields: ['region', 'revenue'],
            value: '42%',
            significance: '贡献下降的主要部分',
            sourceFields: ['r.region', 'r.amount'],
            calculation: 'SUM(r.amount) GROUP BY r.region; decline attribution analysis',
            confidence: 'medium',
            confidenceReason: '归因分析基于有限 30 天数据，季节波动可能放大影响',
            relatedIntent: { metrics: ['销售额'], dimensions: ['月份'], filters: ['下降归因'], timeRange: '近 30 天' },
            displayValue: '42%（贡献下降占比）',
            sqlSnippet: 'SUM(r.amount) GROUP BY region',
          },
        ],
        risks: ['30 天数据周期短，季节波动可能被放大'],
        evidenceSummary: '共 2 项证据：整体下降 18.5%；华东区域贡献下降的 42%。',
        nextQuestions: ['华东区域下降的具体原因是什么？', '其他区域是否也有下降趋势？'],
        conclusion: '建议重点关注华东区域订单量变化，排查是否有市场竞争或运营问题。',
      },
    },
    chartData: {
      columns: ['month', 'revenue'],
      rows: [['第1周', 9500000], ['第2周', 8700000], ['第3周', 8100000], ['第4周', 7750000]],
    },
    contextSummary: '上一轮：各区域销售额 → 本轮追问：下降原因分析',
  },

  // Scenario 3: trend-over-time → time_shift → "看去年同期"
  {
    parentScenarioId: 'trend-over-time',
    followUpType: 'time_shift',
    matchPatterns: [/去年/, /同比/, /去年同期/, /去年同/],
    response: {
      intent: { metrics: ['收入'], dimensions: ['月份'], filters: [], timeRange: '同比对比' },
      sqlPlan: {
        datasourceId: 2, datasourceName: 'dwhrpt',
        sql: "SELECT TO_CHAR(t.transaction_date, 'MM') AS month,\n       SUM(CASE WHEN EXTRACT(YEAR FROM t.transaction_date) = EXTRACT(YEAR FROM SYSDATE) THEN t.amount ELSE 0 END) AS this_year,\n       SUM(CASE WHEN EXTRACT(YEAR FROM t.transaction_date) = EXTRACT(YEAR FROM SYSDATE) - 1 THEN t.amount ELSE 0 END) AS last_year\nFROM TRANSACTIONS t\nWHERE t.transaction_date >= ADD_MONTHS(SYSDATE, -12)\nGROUP BY TO_CHAR(t.transaction_date, 'MM')\nORDER BY month",
        tables: ['TRANSACTIONS'], fields: ['month', 'this_year', 'last_year'],
        assumptions: ['使用 SYSDATE 作为当前日期边界'], safetyWarnings: [],
      },
      resultSummary: { rowCount: 12, durationMs: 350, truncated: false },
      chartSuggestions: [],
      narrative: {
        summary: '同比分析显示，今年上半年收入同比增长 15.6%，6 月同比增幅最大达 22.4%。',
        keyFindings: ['6 月同比 +22.4% 为最大增幅', 'Q1 同比 +12.1%，Q2 同比 +18.9%，增长加速'],
        evidence: [
          {
            claim: '6 月同比增幅最大',
            fields: ['month', 'this_year', 'last_year'],
            value: '+22.4%',
            significance: '去年同期为基数',
            sourceFields: ['t.month', 't.amount'],
            calculation: 'CASE WHEN EXTRACT(YEAR FROM ...) = this year THEN amount ELSE 0 END AS this_year / last_year',
            confidence: 'high',
            confidenceReason: '12 个月完整同比数据，计算口径一致',
            relatedIntent: { metrics: ['收入'], dimensions: ['月份'], filters: [], timeRange: '同比对比' },
            displayValue: '+22.4%',
            sqlSnippet: 'SUM(CASE WHEN ... = this year THEN amount ELSE 0 END) AS this_year, SUM(CASE WHEN ... = last year THEN amount ELSE 0 END) AS last_year GROUP BY month',
          },
          {
            claim: '增长加速',
            fields: ['month', 'this_year'],
            value: 'Q2 +18.9%',
            significance: '高于 Q1 的 +12.1%',
            sourceFields: ['t.month', 't.amount'],
            calculation: 'SUM(amount) GROUP BY quarter; Q2 vs Q1 growth comparison',
            confidence: 'high',
            confidenceReason: '季度汇总数据，趋势一致性强',
            relatedIntent: { metrics: ['收入'], dimensions: ['月份'], filters: [], timeRange: '同比对比' },
            displayValue: 'Q2 +18.9%（Q1 +12.1%）',
            sqlSnippet: 'SUM(amount) GROUP BY quarter',
          },
        ],
        risks: ['同比数据受去年基数影响，如去年有特殊事件可能扭曲对比'],
        evidenceSummary: '共 2 项证据：6 月同比增幅最大达 +22.4%；增长从 Q1 的 12.1% 加速至 Q2 的 18.9%。',
        nextQuestions: ['各产品线同比增长情况？', '哪些客户贡献了增长？'],
        conclusion: '整体增长势头良好，建议维持当前市场策略同时关注增长加速的驱动因素。',
      },
    },
    chartData: {
      columns: ['month', 'this_year', 'last_year'],
      rows: [
        ['01', 11800000, 10200000], ['02', 12500000, 10800000],
        ['03', 13200000, 12000000], ['04', 13800000, 11800000],
        ['05', 15100000, 12600000], ['06', 16400000, 13400000],
      ],
    },
    contextSummary: '上一轮：近 6 个月收入趋势 → 本轮追问：去年同期同比对比',
  },

  // Scenario 4: any → top_n → "看 TOP5"
  {
    parentScenarioId: '*',
    followUpType: 'top_n',
    matchPatterns: [/TOP\s*\d+/i, /前\d/, /排名前/],
    response: {
      intent: { metrics: ['销售额'], dimensions: ['排名'], filters: ['TOP N'], timeRange: '近 30 天' },
      sqlPlan: {
        datasourceId: 2, datasourceName: 'dwhrpt',
        sql: "SELECT * FROM (SELECT region, SUM(amount) AS revenue\nFROM REVENUE\nWHERE transaction_date >= SYSDATE - 30\nGROUP BY region\nORDER BY revenue DESC) WHERE ROWNUM <= 5",
        tables: ['REVENUE'], fields: ['region', 'revenue'],
        assumptions: ['基于上一轮数据截取 TOP N'], safetyWarnings: [],
      },
      resultSummary: { rowCount: 5, durationMs: 150, truncated: false },
      chartSuggestions: [],
      narrative: {
        summary: 'TOP5 区域贡献了超过 85% 的销售额，头部效应明显。',
        keyFindings: ['TOP3 区域贡献 72.3% 销售额', '华东以 ¥12.3M 位居榜首'],
        evidence: [
          {
            claim: '头部集中',
            fields: ['region', 'revenue'],
            value: '85%',
            significance: 'TOP5 占总销售额',
            sourceFields: ['region', 'amount'],
            calculation: 'SUM(amount) GROUP BY region ORDER BY revenue DESC; TOP5 aggregation',
            confidence: 'high',
            confidenceReason: '基于近 30 天完整销售数据',
            relatedIntent: { metrics: ['销售额'], dimensions: ['排名'], filters: ['TOP N'], timeRange: '近 30 天' },
            displayValue: '85%（TOP5 占比）',
            sqlSnippet: 'SUM(amount) GROUP BY region ORDER BY revenue DESC',
          },
          {
            claim: '华东领先',
            fields: ['region', 'revenue'],
            value: '¥12.3M',
            significance: '占比 29.4%',
            sourceFields: ['region', 'amount'],
            calculation: 'SUM(amount) GROUP BY region ORDER BY revenue DESC',
            confidence: 'high',
            confidenceReason: '华东数据完整，排名稳定',
            relatedIntent: { metrics: ['销售额'], dimensions: ['排名'], filters: ['TOP N'], timeRange: '近 30 天' },
            displayValue: '¥12.3M（占比 29.4%）',
            sqlSnippet: 'SUM(amount) GROUP BY region ORDER BY revenue DESC',
          },
        ],
        risks: ['数据仅基于近 30 天，排名可能随时间变化'],
        evidenceSummary: '共 2 项证据：TOP5 占销售额 85%；华东以 ¥12.3M 居首占比 29.4%。',
        nextQuestions: ['TOP5 客户明细？', '低贡献区域如何提升？'],
        conclusion: '应重点关注华东和华南两大区域，同时制定低贡献区域的提升计划。',
      },
    },
    chartData: {
      columns: ['region', 'revenue'],
      rows: [['华东', 12300000], ['华南', 9800000], ['华北', 8200000], ['西南', 5600000], ['西北', 3100000]],
    },
    contextSummary: '基于上一轮结果查看 TOP 排名',
  },
]

export function matchFollowUpScenario(
  parentScenarioId: string,
  followUpType: FollowUpType,
  question: string
): FollowUpScenarioData | null {
  for (const s of FOLLOW_UP_SCENARIOS) {
    if (s.followUpType !== followUpType) continue
    if (s.parentScenarioId !== '*' && s.parentScenarioId !== parentScenarioId) continue
    for (const pattern of s.matchPatterns) {
      if (pattern.test(question)) {
        return s
      }
    }
  }
  return null
}
