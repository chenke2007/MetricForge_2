// frontend/src/api/aiAsk/executeApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeSql } from './executeApi'
import { AiAskError } from './errors'
import type { AiAskResponse } from '../../types/aiAsk'

const mockResponse: AiAskResponse = {
  question: 'Test question',
  intent: {
    metrics: ['revenue'],
    dimensions: ['date'],
    filters: [],
  },
  sqlPlan: {
    datasourceId: 1,
    datasourceName: 'dwhrpt',
    sql: 'SELECT 1',
    tables: ['orders'],
    fields: ['revenue'],
    assumptions: [],
    safetyWarnings: [],
  },
  chartSuggestions: [],
  narrative: {
    summary: 'Summary',
    keyFindings: [],
    evidence: [],
    risks: [],
    nextQuestions: [],
  },
  semanticGaps: [],
  narrativeLevel: 'sql_pending',
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// a) Request body only contains sessionId and assistantMessageId
describe('executeSql', () => {
  it('should send request body with only sessionId and assistantMessageId', async () => {
    let requestBody: unknown = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, opts) => {
      requestBody = JSON.parse((opts?.body as string) ?? '{}')
      return new Response(JSON.stringify({ ok: true, data: mockResponse }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    await executeSql(1, 2)

    expect(requestBody).toEqual({ sessionId: 1, assistantMessageId: 2 })
    // Should NOT contain sql, datasourceId, or selectedTables
    expect(requestBody).not.toHaveProperty('sql')
    expect(requestBody).not.toHaveProperty('datasourceId')
    expect(requestBody).not.toHaveProperty('selectedTables')
  })

  // b) Successful response returns data
  it('should return data on successful response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: mockResponse }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await executeSql(1, 2)
    expect(result.data).toEqual(mockResponse)
  })

  // c) Business error (ok:false)
  it('should throw AiAskError with EXECUTION_ERROR on business error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          errorCode: 'EXECUTION_ERROR',
          errorMessage: 'DB timeout',
          details: { sql: 'SELECT ...' },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    let err: unknown = null
    try {
      await executeSql(1, 2)
    } catch (e) {
      err = e
    }

    expect(err).toBeInstanceOf(AiAskError)
    if (err instanceof AiAskError) {
      expect(err.code).toBe('EXECUTION_ERROR')
      expect(err.message).toContain('DB timeout')
      expect(err.details).toEqual({ sql: 'SELECT ...' })
    }
  })

  // d) HTTP 409 — already executing
  it('should throw AiAskError with EXECUTION_ERROR on HTTP 409', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          errorCode: 'EXECUTION_ERROR',
          errorMessage: '正在执行中',
        }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    let err: unknown = null
    try {
      await executeSql(1, 2)
    } catch (e) {
      err = e
    }

    expect(err).toBeInstanceOf(AiAskError)
    if (err instanceof AiAskError) {
      expect(err.code).toBe('EXECUTION_ERROR')
      expect(err.message).toContain('正在执行中')
    }
  })

  // e) HTTP 422 — validation/state error
  it('should throw AiAskError with INVALID_RESPONSE on HTTP 422', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Invalid state transition' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    let err: unknown = null
    try {
      await executeSql(1, 2)
    } catch (e) {
      err = e
    }

    expect(err).toBeInstanceOf(AiAskError)
    if (err instanceof AiAskError) {
      expect(err.code).toBe('INVALID_RESPONSE')
      expect(err.message).toContain('Invalid state transition')
    }
  })

  // f) Network error
  it('should throw AiAskError with LLM_CONNECTION_ERROR on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

    let err: unknown = null
    try {
      await executeSql(1, 2)
    } catch (e) {
      err = e
    }

    expect(err).toBeInstanceOf(AiAskError)
    if (err instanceof AiAskError) {
      expect(err.code).toBe('LLM_CONNECTION_ERROR')
      expect(err.message).toContain('无法连接到 AI 问数服务')
    }
  })

  // g) Non-JSON response
  it('should throw AiAskError with INVALID_RESPONSE when response is not JSON', async () => {
    const invalidJson = new Response('not json', { status: 200 })
    vi.spyOn(invalidJson, 'json').mockRejectedValue(new Error('Invalid JSON'))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(invalidJson)

    let err: unknown = null
    try {
      await executeSql(1, 2)
    } catch (e) {
      err = e
    }

    expect(err).toBeInstanceOf(AiAskError)
    if (err instanceof AiAskError) {
      expect(err.code).toBe('INVALID_RESPONSE')
    }
  })

  // h) Null/undefined response — non-object body
  it('should throw AiAskError with UNKNOWN on null body response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(null), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    let err: unknown = null
    try {
      await executeSql(1, 2)
    } catch (e) {
      err = e
    }

    expect(err).toBeInstanceOf(AiAskError)
    if (err instanceof AiAskError) {
      expect(err.code).toBe('UNKNOWN')
    }
  })

  // i) Invalid executed response — missing queryResult throws INVALID_RESPONSE
  it('should throw INVALID_RESPONSE when executed response has no queryResult', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            ...mockResponse,
            narrativeLevel: 'executed',
            narrative: {
              ...mockResponse.narrative,
              evidence: [{ claim: 'test', fields: ['a'], sqlSnippet: 'SELECT', calculation: 'sum', sourceFields: ['a'] }],
              keyFindings: ['test'],
              conclusion: 'done',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    let err: unknown = null
    try {
      await executeSql(1, 2)
    } catch (e) {
      err = e
    }

    expect(err).toBeInstanceOf(AiAskError)
    if (err instanceof AiAskError) {
      expect(err.code).toBe('INVALID_RESPONSE')
      expect(err.message).toContain('未通过前端二次校验')
    }
  })

  // j) Invalid executed response — snake_case queryResult fields throws INVALID_RESPONSE
  it('should throw INVALID_RESPONSE when executed response has snake_case queryResult', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            ...mockResponse,
            narrativeLevel: 'executed',
            narrative: {
              ...mockResponse.narrative,
              evidence: [{ claim: 'test', fields: ['a'], sqlSnippet: 'SELECT', calculation: 'sum', sourceFields: ['a'] }],
              keyFindings: ['test'],
              conclusion: 'done',
            },
            queryResult: {
              columns: ['a', 'b'],
              rows: [['x', 1]],
              row_count: 1,
              truncated: false,
              elapsed_ms: 50,
              history_id: 1,
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    let err: unknown = null
    try {
      await executeSql(1, 2)
    } catch (e) {
      err = e
    }

    expect(err).toBeInstanceOf(AiAskError)
    if (err instanceof AiAskError) {
      expect(err.code).toBe('INVALID_RESPONSE')
      expect(err.message).toContain('未通过前端二次校验')
    }
  })


  // l) Invalid executed response — row width mismatch throws INVALID_RESPONSE
  it('should throw INVALID_RESPONSE when executed response has row width mismatch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            ...mockResponse,
            narrativeLevel: 'executed',
            narrative: {
              ...mockResponse.narrative,
              evidence: [{ claim: 'test', fields: ['a'], sqlSnippet: 'SELECT', calculation: 'sum', sourceFields: ['a'] }],
              keyFindings: ['test'],
              conclusion: 'done',
            },
            queryResult: {
              columns: ['region', 'sales'],
              rows: [['\u534e\u4e1c']],
              rowCount: 1,
              truncated: false,
              elapsedMs: 50,
              historyId: null,
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    let err: unknown = null
    try {
      await executeSql(1, 2)
    } catch (e) {
      err = e
    }

    expect(err).toBeInstanceOf(AiAskError)
    if (err instanceof AiAskError) {
      expect(err.code).toBe('INVALID_RESPONSE')
    }
  })


  // l) Invalid executed response — row width mismatch throws INVALID_RESPONSE
  it('should throw INVALID_RESPONSE when executed response has row width mismatch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            ...mockResponse,
            narrativeLevel: 'executed',
            narrative: {
              ...mockResponse.narrative,
              evidence: [{ claim: 'test', fields: ['a'], sqlSnippet: 'SELECT', calculation: 'sum', sourceFields: ['a'] }],
              keyFindings: ['test'],
              conclusion: 'done',
            },
            queryResult: {
              columns: ['region', 'sales'],
              rows: [['华东']],
              rowCount: 1,
              truncated: false,
              elapsedMs: 50,
              historyId: null,
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    let err: unknown = null
    try {
      await executeSql(1, 2)
    } catch (e) {
      err = e
    }

    expect(err).toBeInstanceOf(AiAskError)
    if (err instanceof AiAskError) {
      expect(err.code).toBe('INVALID_RESPONSE')
    }
  })

// k) Valid executed response passes validation
  it('should return data when executed response has valid queryResult', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            ...mockResponse,
            narrativeLevel: 'executed',
            narrative: {
              ...mockResponse.narrative,
              evidence: [{ claim: 'test', fields: ['a'], sqlSnippet: 'SELECT', calculation: 'sum', sourceFields: ['a'] }],
              keyFindings: ['test'],
              conclusion: 'done',
            },
            queryResult: {
              columns: ['a', 'b'],
              rows: [['x', 1]],
              rowCount: 1,
              truncated: false,
              elapsedMs: 50,
              historyId: null,
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const result = await executeSql(1, 2)
    expect(result.data.narrativeLevel).toBe('executed')
    expect((result.data as any).queryResult.rowCount).toBe(1)
  })
  it('should return data when executed response has valid empty result', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            ...mockResponse,
            narrativeLevel: 'executed',
            narrative: {
              ...mockResponse.narrative,
              evidence: [{ claim: 'test', fields: ['a'], sqlSnippet: 'SELECT', calculation: 'sum', sourceFields: ['a'] }],
              keyFindings: ['test'],
              conclusion: 'done',
            },
            queryResult: {
              columns: ['a'],
              rows: [],
              rowCount: 0,
              truncated: false,
              elapsedMs: 10,
              historyId: null,
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const result = await executeSql(1, 2)
    expect(result.data.narrativeLevel).toBe('executed')
    expect((result.data as any).queryResult.rowCount).toBe(0)
  })

  it('should return data for dimension-only executed response with empty evidence', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            ...mockResponse,
            narrativeLevel: 'executed',
            narrative: {
              ...mockResponse.narrative,
              evidence: [],
              keyFindings: [],
              conclusion: 'done',
            },
            queryResult: {
              columns: ['区域'],
              rows: [['长三角'], ['京津冀']],
              rowCount: 2,
              truncated: false,
              elapsedMs: 150,
              historyId: null,
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const result = await executeSql(1, 2)
    expect(result.data.narrativeLevel).toBe('executed')
    expect((result.data as any).queryResult.rowCount).toBe(2)
  })

})
