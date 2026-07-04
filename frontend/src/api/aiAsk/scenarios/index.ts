// frontend/src/api/aiAsk/scenarios/index.ts
import type { AiAskResponse } from '../../../types/aiAsk'
import type { MetricCard } from '../../../types/aiAsk'
import { RESPONSE as REV_RESP, CHART_DATA as REV_DATA, INTENT_INFO as REV_INTENT, METRIC_CARDS as REV_MC } from './revenueByRegion'
import { RESPONSE as TREND_RESP, CHART_DATA as TREND_DATA, INTENT_INFO as TREND_INTENT, METRIC_CARDS as TREND_MC } from './trend'
import { RESPONSE as TOPN_RESP, CHART_DATA as TOPN_DATA, INTENT_INFO as TOPN_INTENT, METRIC_CARDS as TOPN_MC } from './topN'
import { RESPONSE as COMP_RESP, CHART_DATA as COMP_DATA, INTENT_INFO as COMP_INTENT, METRIC_CARDS as COMP_MC } from './comparison'
import { RESPONSE as DEF_RESP, CHART_DATA as DEF_DATA, INTENT_INFO as DEF_INTENT, METRIC_CARDS as DEF_MC } from './default'

export interface MockScenario {
  id: string
  match: RegExp
  response: AiAskResponse
  chartData: { columns: string[]; rows: any[][] }
  intentInfo: { metrics: string[]; dimensions: string[]; filters: string[]; timeRange?: string }
  metricCards: MetricCard[]
  description: string
}

export const MOCK_SCENARIOS: MockScenario[] = [
  {
    id: 'revenue-by-region',
    match: /(区域|地区|各省|区域).*(销售|收入|营收)/i,
    response: REV_RESP,
    chartData: REV_DATA,
    intentInfo: REV_INTENT,
    metricCards: REV_MC,
    description: '各区域销售额',
  },
  {
    id: 'trend-over-time',
    match: /(趋势|走势|月度|季度|月度变化|环比|逐月)/i,
    response: TREND_RESP,
    chartData: TREND_DATA,
    intentInfo: TREND_INTENT,
    metricCards: TREND_MC,
    description: '时间趋势分析',
  },
  {
    id: 'top-n',
    match: /(top|排名|前|排行|最高|最多|前十|前五)/i,
    response: TOPN_RESP,
    chartData: TOPN_DATA,
    intentInfo: TOPN_INTENT,
    metricCards: TOPN_MC,
    description: 'Top-N 排名',
  },
  {
    id: 'comparison',
    match: /(对比|比较|同比|vs|versus|去年|去年同期)/i,
    response: COMP_RESP,
    chartData: COMP_DATA,
    intentInfo: COMP_INTENT,
    metricCards: COMP_MC,
    description: '对比分析',
  },
  {
    id: 'default',
    match: /.*/,
    response: DEF_RESP,
    chartData: DEF_DATA,
    intentInfo: DEF_INTENT,
    metricCards: DEF_MC,
    description: '通用分析',
  },
]
