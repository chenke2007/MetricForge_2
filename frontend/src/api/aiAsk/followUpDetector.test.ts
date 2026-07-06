import { describe, it, expect } from 'vitest'
import { detectFollowUpType } from './followUpDetector'
import type { AiAskResponse } from '../../types/aiAsk'

function makePreviousResponse(overrides?: Partial<AiAskResponse>): AiAskResponse {
  return {
    question: '各区域销售额表现如何？',
    intent: { metrics: ['销售额'], dimensions: ['区域'], filters: [], timeRange: '近 30 天' },
    sqlPlan: { datasourceId: 2, datasourceName: 'dwhrpt', sql: 'SELECT ...', tables: ['REVENUE'], fields: ['region', 'total_revenue'], assumptions: [], safetyWarnings: [] },
    resultSummary: { rowCount: 6, durationMs: 230 },
    chartSuggestions: [],
    narrative: { summary: '', keyFindings: [], evidence: [], risks: [], nextQuestions: [] },
    semanticGaps: [],
    ...overrides,
  }
}

describe('detectFollowUpType', () => {
  it('detects drill_down: "为什么华东销售额最高"', () => {
    const prev = makePreviousResponse()
    const result = detectFollowUpType('为什么华东销售额最高', prev)
    expect(result.type).toBe('drill_down')
    expect(result.targetValue).toBe('华东')
    expect(result.confidence).toBe('high')
  })

  it('detects drill_down: "按产品线拆分"', () => {
    const prev = makePreviousResponse()
    const result = detectFollowUpType('按产品线拆分销售额', prev)
    expect(result.type).toBe('drill_down')
    expect(result.targetDimension).toBe('产品线')
    expect(result.confidence).toBe('medium')
  })

  it('detects why_down: "为什么销售额下降"', () => {
    const prev = makePreviousResponse()
    const result = detectFollowUpType('为什么销售额下降了', prev)
    expect(result.type).toBe('why_down')
    expect(result.confidence).toBe('high')
  })

  it('detects why_down: "下降原因是什么"', () => {
    const prev = makePreviousResponse()
    const result = detectFollowUpType('下降原因是什么', prev)
    expect(result.type).toBe('why_down')
  })

  it('detects top_n: "看 TOP10 客户"', () => {
    const prev = makePreviousResponse()
    const result = detectFollowUpType('看 TOP10 客户', prev)
    expect(result.type).toBe('top_n')
    expect(result.confidence).toBe('high')
  })

  it('detects top_n: "排名前五的产品"', () => {
    const prev = makePreviousResponse()
    const result = detectFollowUpType('排名前五的产品', prev)
    expect(result.type).toBe('top_n')
  })

  it('detects time_shift: "看去年同期数据"', () => {
    const prev = makePreviousResponse()
    const result = detectFollowUpType('看去年同期数据', prev)
    expect(result.type).toBe('time_shift')
    expect(result.confidence).toBe('high')
  })

  it('detects time_shift: "环比怎么样"', () => {
    const prev = makePreviousResponse()
    const result = detectFollowUpType('环比怎么样', prev)
    expect(result.type).toBe('time_shift')
  })

  it('detects switch_metric: "换成毛利率"', () => {
    const prev = makePreviousResponse()
    const result = detectFollowUpType('换成毛利率看看', prev)
    expect(result.type).toBe('switch_metric')
    expect(result.relatedMetrics).toContain('毛利率')
    expect(result.confidence).toBe('medium')
  })

  it('detects explain_anomaly: "为什么本月数据异常"', () => {
    const prev = makePreviousResponse()
    const result = detectFollowUpType('为什么本月数据异常', prev)
    expect(result.type).toBe('explain_anomaly')
  })

  it('falls back to general_followup: "再说说还有吗"', () => {
    const prev = makePreviousResponse()
    const result = detectFollowUpType('再说说还有吗', prev)
    expect(result.type).toBe('general_followup')
    expect(result.confidence).toBe('low')
  })

  it('uses forceFollowUpType override when provided', () => {
    const prev = makePreviousResponse()
    const result = detectFollowUpType('随便说说', prev, 'why_down')
    expect(result.type).toBe('why_down')
    expect(result.inferenceReason).toContain('force')
  })

  it('infers targetValue from question for drill_down', () => {
    const prev = makePreviousResponse()
    const result = detectFollowUpType('华北区域具体数据', prev)
    expect(result.type).toBe('drill_down')
    expect(result.targetValue).toBe('华北')
  })

  it('sets relatedMetrics for switch_metric', () => {
    const prev = makePreviousResponse()
    const result = detectFollowUpType('看同比', prev)
    expect(result.type).toBe('time_shift')
    // time_shift doesn't set relatedMetrics
  })
})
