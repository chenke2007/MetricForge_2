// frontend/src/api/aiAsk/validator.test.ts
import { describe, it, expect } from 'vitest'
import { validateAiAskResponse } from './validator'
import type { AiAskResponse } from '../../types/aiAsk'

const validResponse: AiAskResponse = {
  question: '各区域销售额',
  intent: { metrics: ['销售额'], dimensions: ['区域'], filters: [], timeRange: '近 30 天' },
  sqlPlan: { datasourceId: 2, datasourceName: 'dwhrpt', sql: 'SELECT * FROM t', tables: ['t'], fields: ['a'], assumptions: [], safetyWarnings: [] },
  chartSuggestions: [{ title: '图', chartType: 'bar', xField: 'x', yFields: ['y'], rationale: 'r', limitations: [] }],
  narrative: { summary: 's', keyFindings: [], evidence: [], risks: [], nextQuestions: [] },
  semanticGaps: [],
}

describe('validateAiAskResponse', () => {
  it('passes valid response', () => {
    const result = validateAiAskResponse(validResponse)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('fails on null', () => {
    const result = validateAiAskResponse(null)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('fails on empty question', () => {
    const result = validateAiAskResponse({ ...validResponse, question: '' })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.path === 'question')).toBe(true)
  })

  it('warns on empty metrics and dimensions', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      intent: { metrics: [], dimensions: [], filters: [], timeRange: undefined },
    })
    expect(result.warnings.some(w => w.includes('无 metrics'))).toBe(true)
  })

  it('warns on empty chartSuggestions', () => {
    const result = validateAiAskResponse({ ...validResponse, chartSuggestions: [] })
    expect(result.warnings.some(w => w.includes('chartSuggestions 为空'))).toBe(true)
  })

  it('warns on invalid chartType', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      chartSuggestions: [{ title: '图', chartType: 'invalid', xField: 'x', yFields: ['y'], rationale: 'r', limitations: [] }],
    })
    expect(result.warnings.some(w => w.includes('不合法'))).toBe(true)
  })
})
