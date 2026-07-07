// frontend/src/api/aiAsk/promptSimulation.test.ts

import { describe, it, expect } from 'vitest'
import { simulateLlmFault, LlmResponseFaultType } from './promptSimulation'
import { validateAiAskResponse } from './validator'
import type { AiAskResponse } from '../../types/aiAsk'

const validResponse: AiAskResponse = {
  question: '各区域销售额',
  intent: { metrics: ['销售额'], dimensions: ['区域'], filters: [], timeRange: '近 30 天' },
  sqlPlan: {
    datasourceId: 2,
    datasourceName: 'dwhrpt',
    sql: 'SELECT * FROM t',
    tables: ['t'],
    fields: ['a'],
    assumptions: [],
    safetyWarnings: [],
  },
  resultSummary: { rowCount: 10, durationMs: 100 },
  chartSuggestions: [
    { title: '图', chartType: 'bar', xField: 'x', yFields: ['y'], rationale: 'r', limitations: [] },
  ],
  narrative: {
    summary: 's',
    keyFindings: ['finding'],
    evidence: [
      {
        claim: '华东销售额最高',
        fields: ['region', 'sales'],
        sqlSnippet: 'SELECT region, SUM(sales) FROM t GROUP BY region',
        calculation: 'SUM(sales)',
        sourceFields: ['region', 'sales'],
        confidence: 'high',
      },
    ],
    risks: [],
    nextQuestions: [],
    conclusion: '结论',
  },
  semanticGaps: [],
}

const NON_TIMEOUT_FAULTS: LlmResponseFaultType[] = [
  'missing_top_level_fields',
  'wrong_field_types',
  'incomplete_narrative',
  'incomplete_evidence',
  'invalid_followup_confidence',
  'missing_sql_plan_tables',
  'semantic_gap_conflict',
  'empty_response',
  'unparseable_response',
]

describe('simulateLlmFault', () => {
  it.each(NON_TIMEOUT_FAULTS)('%s: returns a different reference and does not mutate baseResponse', (fault) => {
    const snapshot = JSON.stringify(validResponse)
    const result = simulateLlmFault(validResponse, fault)
    expect(result).not.toBe(validResponse)
    expect(JSON.stringify(validResponse)).toBe(snapshot)
  })

  it('timeout: returns a deep copy and does not mutate baseResponse', () => {
    const snapshot = JSON.stringify(validResponse)
    const result = simulateLlmFault(validResponse, 'timeout')
    expect(result).not.toBe(validResponse)
    expect(result).toEqual(validResponse)
    expect(JSON.stringify(validResponse)).toBe(snapshot)
  })

  it('missing_top_level_fields: triggers validator errors for missing top-level fields', () => {
    const result = validateAiAskResponse(simulateLlmFault(validResponse, 'missing_top_level_fields'))
    expect(result.valid).toBe(false)
    const paths = result.errors.map((e) => e.path)
    expect(paths).toEqual(
      expect.arrayContaining(['question', 'intent', 'sqlPlan', 'narrative', 'semanticGaps'])
    )
  })

  it('wrong_field_types: triggers validator errors for wrong top-level types', () => {
    const result = validateAiAskResponse(simulateLlmFault(validResponse, 'wrong_field_types'))
    expect(result.valid).toBe(false)
    const paths = result.errors.map((e) => e.path)
    expect(paths).toEqual(
      expect.arrayContaining([
        'question',
        'intent',
        'sqlPlan',
        'chartSuggestions',
        'narrative',
        'semanticGaps',
      ])
    )
  })

  it('incomplete_narrative: triggers validator errors and warnings', () => {
    const result = validateAiAskResponse(simulateLlmFault(validResponse, 'incomplete_narrative'))
    expect(result.valid).toBe(false)
    const paths = result.errors.map((e) => e.path)
    expect(paths).toEqual(expect.arrayContaining(['narrative.summary', 'narrative.evidence']))
    expect(result.warnings.some((w) => w.includes('narrative.keyFindings'))).toBe(true)
  })

  it('incomplete_evidence: triggers validator errors and warnings', () => {
    const result = validateAiAskResponse(simulateLlmFault(validResponse, 'incomplete_evidence'))
    expect(result.valid).toBe(false)
    const paths = result.errors.map((e) => e.path)
    expect(paths).toEqual(
      expect.arrayContaining(['narrative.evidence[0].claim', 'narrative.evidence[0].fields'])
    )
    expect(result.warnings.some((w) => w.includes('sourceFields'))).toBe(true)
  })

  it('invalid_followup_confidence: triggers validator error for followUp.confidence', () => {
    const result = validateAiAskResponse(simulateLlmFault(validResponse, 'invalid_followup_confidence'))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'followUp.confidence')).toBe(true)
  })

  it('missing_sql_plan_tables: triggers validator error for sqlPlan.tables or sqlPlan.fields', () => {
    const result = validateAiAskResponse(simulateLlmFault(validResponse, 'missing_sql_plan_tables'))
    expect(result.valid).toBe(false)
    const paths = result.errors.map((e) => e.path)
    expect(paths.some((p) => p === 'sqlPlan.tables' || p === 'sqlPlan.fields')).toBe(true)
  })

  it('semantic_gap_conflict: triggers validator warning about conflict with intent.metrics', () => {
    const result = validateAiAskResponse(simulateLlmFault(validResponse, 'semantic_gap_conflict'))
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings.some((w) => w.includes('冲突'))).toBe(true)
  })

  it('empty_response: triggers validator error', () => {
    const result = validateAiAskResponse(simulateLlmFault(validResponse, 'empty_response'))
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('unparseable_response: triggers validator error', () => {
    const result = validateAiAskResponse(simulateLlmFault(validResponse, 'unparseable_response'))
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('timeout: produces a valid response', () => {
    const result = validateAiAskResponse(simulateLlmFault(validResponse, 'timeout'))
    expect(result.valid).toBe(true)
  })
})
