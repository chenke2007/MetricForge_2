// frontend/src/api/aiAsk/contextPolicy.test.ts
import { describe, it, expect } from 'vitest'
import {
  buildMessageHistory,
  compressResponse,
  compressHistory,
  truncateHistory,
  DEFAULT_CONTEXT_CONFIG,
} from './contextPolicy'
import type { AiAskResponse } from '../../types/aiAsk'

const baseResponse: AiAskResponse = {
  question: '各区域销售额',
  intent: { metrics: ['销售额'], dimensions: ['区域'], filters: [], timeRange: '近 30 天' },
  sqlPlan: {
    datasourceId: 2,
    datasourceName: 'dwhrpt',
    sql: 'SELECT region, SUM(revenue) FROM sales',
    tables: ['sales'],
    fields: ['region', 'revenue'],
    assumptions: [],
    safetyWarnings: [],
  },
  resultSummary: { rowCount: 6, durationMs: 120, truncated: false },
  chartSuggestions: [
    {
      title: '图',
      chartType: 'bar',
      xField: 'region',
      yFields: ['revenue'],
      rationale: 'r',
      limitations: [],
    },
  ],
  narrative: {
    summary: 'summary',
    keyFindings: ['k1'],
    evidence: [{ claim: 'c', fields: [] }],
    risks: ['r1'],
    nextQuestions: ['q1'],
    conclusion: 'conclusion',
  },
  semanticGaps: [{ field: 'x', reason: 'not_found' }],
}

describe('buildMessageHistory', () => {
  it('returns undefined when currentResponse is null', () => {
    expect(buildMessageHistory(null)).toBeUndefined()
  })

  it('returns undefined when maxHistoryLength is 0', () => {
    expect(buildMessageHistory(baseResponse, { maxHistoryLength: 0 })).toBeUndefined()
  })

  it('builds single-turn history from currentResponse', () => {
    const history = buildMessageHistory(baseResponse)
    expect(history).toHaveLength(2)
    expect(history?.[0]).toEqual({ role: 'user', content: '各区域销售额' })
    expect(history?.[1].role).toBe('assistant')
    expect(history?.[1].responseJson).toEqual(baseResponse as unknown as Record<string, unknown>)
  })

  it('uses DEFAULT_CONTEXT_CONFIG when config is omitted', () => {
    expect(DEFAULT_CONTEXT_CONFIG.maxHistoryLength).toBe(1)
    expect(DEFAULT_CONTEXT_CONFIG.compressionLevel).toBe('none')
    expect(DEFAULT_CONTEXT_CONFIG.retainFields).toEqual([])
  })
})

describe('compressResponse', () => {
  it('light compression removes chartSuggestions', () => {
    const compressed = compressResponse(baseResponse, 'light')
    expect(compressed.chartSuggestions).toHaveLength(0)
    expect(compressed.question).toBe(baseResponse.question)
    expect(compressed.intent).toEqual(baseResponse.intent)
  })

  it('light compression keeps narrative summary and conclusion', () => {
    const compressed = compressResponse(baseResponse, 'light')
    expect(compressed.narrative.summary).toBe('summary')
    expect(compressed.narrative.conclusion).toBe('conclusion')
    expect(compressed.narrative.keyFindings).toHaveLength(0)
    expect(compressed.narrative.evidence).toHaveLength(0)
  })

  it('light compression truncates sql text to 200 characters', () => {
    const longSql = 'SELECT '.repeat(50)
    const response = { ...baseResponse, sqlPlan: { ...baseResponse.sqlPlan, sql: longSql } }
    const compressed = compressResponse(response, 'light')
    expect(compressed.sqlPlan.sql.length).toBeLessThanOrEqual(200)
  })

  it('full compression keeps only core fields', () => {
    const compressed = compressResponse(baseResponse, 'full')
    expect(compressed.question).toBe('各区域销售额')
    expect(compressed.intent).toEqual(baseResponse.intent)
    expect(compressed.chartSuggestions).toHaveLength(0)
    expect(compressed.semanticGaps).toHaveLength(0)
    expect(compressed.narrative.summary).toBe('summary')
    expect(compressed.narrative.keyFindings).toHaveLength(0)
    expect(compressed.narrative.conclusion).toBe('conclusion')
  })

  it('full compression removes sql text', () => {
    const compressed = compressResponse(baseResponse, 'full')
    expect(compressed.sqlPlan.sql).toBe('')
    expect(compressed.sqlPlan.tables).toEqual(['sales'])
  })

  it('does not mutate original response', () => {
    const original: AiAskResponse = {
      ...baseResponse,
      chartSuggestions: [...baseResponse.chartSuggestions],
    }
    compressResponse(original, 'full')
    expect(original.chartSuggestions).toHaveLength(1)
    expect(original.narrative.keyFindings).toHaveLength(1)
  })
})

describe('compressHistory', () => {
  it('returns undefined when history is empty or undefined', () => {
    expect(compressHistory(undefined)).toBeUndefined()
    expect(compressHistory([])).toBeUndefined()
  })

  it('applies compression to assistant responseJson only', () => {
    const history = buildMessageHistory(baseResponse)
    const compressed = compressHistory(history, { level: 'full' })
    expect(compressed).toHaveLength(2)
    expect(compressed?.[0]).toEqual({ role: 'user', content: '各区域销售额' })
    const assistantJson = compressed?.[1].responseJson as AiAskResponse | undefined
    expect(assistantJson?.chartSuggestions).toHaveLength(0)
    expect(assistantJson?.sqlPlan.sql).toBe('')
    expect(assistantJson?.narrative.summary).toBe('summary')
  })

  it('does not mutate original history or responseJson', () => {
    const history = buildMessageHistory(baseResponse)
    const originalAssistantJson = history?.[1].responseJson as unknown as AiAskResponse
    compressHistory(history, { level: 'full' })
    expect(originalAssistantJson.chartSuggestions).toHaveLength(1)
    expect(originalAssistantJson.narrative.keyFindings).toHaveLength(1)
  })
})

describe('truncateHistory', () => {
  it('returns undefined when history is empty or maxTurns is less than 1', () => {
    expect(truncateHistory(undefined, 1)).toBeUndefined()
    expect(truncateHistory([], 1)).toBeUndefined()
    expect(truncateHistory(buildMessageHistory(baseResponse), 0)).toBeUndefined()
  })

  it('keeps all history when it fits within maxTurns', () => {
    const history = buildMessageHistory(baseResponse)
    expect(truncateHistory(history, 1)).toHaveLength(2)
    expect(truncateHistory(history, 2)).toHaveLength(2)
  })

  it('returns a new array reference when no truncation is needed', () => {
    const history = buildMessageHistory(baseResponse)!
    const result = truncateHistory(history, 2)
    expect(result).toHaveLength(2)
    expect(result).toEqual(history)
    expect(result).not.toBe(history)
  })

  it('returns a new array reference for multi-turn history that fits', () => {
    const history = [
      { role: 'user' as const, content: 'q1' },
      { role: 'assistant' as const, content: '', responseJson: { question: 'q1' } as Record<string, unknown> },
      { role: 'user' as const, content: 'q2' },
      { role: 'assistant' as const, content: '', responseJson: { question: 'q2' } as Record<string, unknown> },
    ]
    const result = truncateHistory(history, 2)
    expect(result).toHaveLength(4)
    expect(result).toEqual(history)
    expect(result).not.toBe(history)
    // Verify original is not mutated
    expect(history).toHaveLength(4)
  })

  it('truncates to the most recent user-assistant turns', () => {
    const history = [
      { role: 'user' as const, content: 'q1' },
      { role: 'assistant' as const, content: '', responseJson: { question: 'q1' } as Record<string, unknown> },
      { role: 'user' as const, content: 'q2' },
      { role: 'assistant' as const, content: '', responseJson: { question: 'q2' } as Record<string, unknown> },
      { role: 'user' as const, content: 'q3' },
      { role: 'assistant' as const, content: '', responseJson: { question: 'q3' } as Record<string, unknown> },
    ]
    const truncated = truncateHistory(history, 2)
    expect(truncated).toHaveLength(4)
    expect(truncated?.[0].content).toBe('q2')
    expect(truncated?.[truncated.length - 1].responseJson).toEqual({ question: 'q3' })
  })

  it('drops an unmatched trailing user message before truncating', () => {
    const history = [
      { role: 'user' as const, content: 'q1' },
      { role: 'assistant' as const, content: '', responseJson: { question: 'q1' } as Record<string, unknown> },
      { role: 'user' as const, content: 'q2' },
      { role: 'assistant' as const, content: '', responseJson: { question: 'q2' } as Record<string, unknown> },
      { role: 'user' as const, content: 'q3' },
    ]
    const truncated = truncateHistory(history, 2)
    expect(truncated).toHaveLength(4)
    expect(truncated?.[0].content).toBe('q1')
    expect(truncated?.[truncated.length - 1].responseJson).toEqual({ question: 'q2' })
  })

  it('does not mutate original history', () => {
    const history = buildMessageHistory(baseResponse)
    truncateHistory(history, 1)
    expect(history).toHaveLength(2)
  })
})
