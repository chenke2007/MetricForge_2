// frontend/src/api/aiAsk/realLlmAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RealLlmAdapter } from './realLlmAdapter'
import { AiAskError } from './errors'

const mockFetch = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  ;(globalThis as any).fetch = mockFetch
})

const validBody = {
  ok: true,
  data: {
    question: 'q',
    intent: { metrics: ['m'], dimensions: ['d'], filters: [] },
    sqlPlan: {
      datasourceId: 1,
      datasourceName: '示例数据源',
      sql: 'SELECT * FROM t',
      tables: ['t'],
      fields: ['f'],
      assumptions: [],
      safetyWarnings: [],
    },
    chartSuggestions: [
      { title: 't', chartType: 'bar', yFields: ['f'], rationale: '', limitations: [] },
    ],
    narrative: {
      summary: 's',
      keyFindings: [],
      evidence: [{ claim: 'c', fields: ['f'] }],
      risks: [],
      nextQuestions: [],
    },
    semanticGaps: [],
  },
}

describe('RealLlmAdapter', () => {
  it('calls /api/ai-ask/analyze and returns valid response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => validBody,
    })

    const adapter = RealLlmAdapter.create()
    const result = await adapter.analyze('q', {
      datasourceId: 1,
      datasourceName: '示例数据源',
      selectedTables: ['t'],
    })

    expect(result.question).toBe('q')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/ai-ask/analyze'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws INVALID_RESPONSE when backend returns invalid data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        data: { question: 'q' }, // missing required fields
      }),
    })

    const adapter = RealLlmAdapter.create()
    await expect(
      adapter.analyze('q', {
        datasourceId: 1,
        datasourceName: '示例数据源',
        selectedTables: [],
      }),
    ).rejects.toThrow(AiAskError)
  })

  it('returns isEmpty chart data with explanatory error', () => {
    const adapter = RealLlmAdapter.create()
    const result = adapter.getChartData({} as any, {} as any)
    expect(result.isEmpty).toBe(true)
    expect(result.error).toContain('真实 LLM MVP 暂不返回图表数据')
  })

  it('throws LLM_CONNECTION_ERROR on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const adapter = RealLlmAdapter.create()
    await expect(
      adapter.analyze('q', {
        datasourceId: 1,
        datasourceName: '示例数据源',
        selectedTables: [],
      }),
    ).rejects.toMatchObject({
      code: 'LLM_CONNECTION_ERROR',
    })
  })

  it('throws error from business error response body.errorCode / body.errorMessage', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: false,
        errorCode: 'LLM_AUTH_ERROR',
        errorMessage: '认证失败',
        details: { reason: 'invalid key' },
      }),
    })

    const adapter = RealLlmAdapter.create()
    await expect(
      adapter.analyze('q', {
        datasourceId: 1,
        datasourceName: '示例数据源',
        selectedTables: [],
      }),
    ).rejects.toMatchObject({
      code: 'LLM_AUTH_ERROR',
      message: '认证失败',
      details: { reason: 'invalid key' },
    })
  })

  it('throws INVALID_RESPONSE when JSON parse fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
      text: async () => '<html>error</html>',
    })

    const adapter = RealLlmAdapter.create()
    await expect(
      adapter.analyze('q', {
        datasourceId: 1,
        datasourceName: '示例数据源',
        selectedTables: [],
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })

  it('throws UNKNOWN for non-2xx status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    })

    const adapter = RealLlmAdapter.create()
    await expect(
      adapter.analyze('q', {
        datasourceId: 1,
        datasourceName: '示例数据源',
        selectedTables: [],
      }),
    ).rejects.toMatchObject({
      code: 'UNKNOWN',
    })
  })

  it('handles non-object body gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => 'just a string',
    })

    const adapter = RealLlmAdapter.create()
    await expect(
      adapter.analyze('q', {
        datasourceId: 1,
        datasourceName: '示例数据源',
        selectedTables: [],
      }),
    ).rejects.toMatchObject({
      code: 'UNKNOWN',
    })
  })

  it('isAvailable returns true', () => {
    const adapter = RealLlmAdapter.create()
    expect(adapter.isAvailable()).toBe(true)
  })
})
