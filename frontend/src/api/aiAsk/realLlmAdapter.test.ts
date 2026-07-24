// frontend/src/api/aiAsk/realLlmAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RealLlmAdapter } from './realLlmAdapter'
import { AiAskError } from './errors'
import { useAiAskService } from './index'

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

describe('useAiAskService (Task 5: production always real LLM)', () => {
  it('returns RealLlmAdapter with no arguments', () => {
    const service = useAiAskService()
    expect(service.name).toBe('RealLlmAdapter')
  })

  it('has no options parameter and never falls back to MockAdapter', () => {
    // Legacy callers may still pass an options object at runtime; it must be ignored.
    const service = (useAiAskService as any)({ useRealLlm: false })
    expect(service.name).toBe('RealLlmAdapter')
    expect(useAiAskService.length).toBe(0)
  })
})

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

  // ── Phase 5N: getChartData with real queryResult ────────────────────

  it('returns isEmpty for sql_pending response', () => {
    const adapter = RealLlmAdapter.create()
    const result = adapter.getChartData(
      { title: 't', chartType: 'bar', xField: 'x', yFields: ['y'], rationale: '', limitations: [] },
      {
        question: 'q',
        intent: { metrics: [], dimensions: [], filters: [] },
        sqlPlan: { datasourceId: 1, datasourceName: '', sql: '', tables: [], fields: [], assumptions: [], safetyWarnings: [] },
        chartSuggestions: [],
        narrative: { summary: '', keyFindings: [], evidence: [], risks: [], nextQuestions: [] },
        semanticGaps: [],
        narrativeLevel: 'sql_pending',
      },
    )
    expect(result.isEmpty).toBe(true)
    expect(result.error).toContain('sql_pending')
  })

  it('returns isEmpty when queryResult is missing', () => {
    const adapter = RealLlmAdapter.create()
    const result = adapter.getChartData(
      { title: 't', chartType: 'bar', xField: 'x', yFields: ['y'], rationale: '', limitations: [] },
      {
        question: 'q',
        intent: { metrics: [], dimensions: [], filters: [] },
        sqlPlan: { datasourceId: 1, datasourceName: '', sql: '', tables: [], fields: [], assumptions: [], safetyWarnings: [] },
        chartSuggestions: [],
        narrative: { summary: '', keyFindings: [], evidence: [], risks: [], nextQuestions: [] },
        semanticGaps: [],
        narrativeLevel: 'executed',
        queryResult: null,
      },
    )
    expect(result.isEmpty).toBe(true)
  })

  it('returns data when fields match queryResult columns', () => {
    const adapter = RealLlmAdapter.create()
    const result = adapter.getChartData(
      { title: 't', chartType: 'bar', xField: 'region', yFields: ['revenue'], rationale: '', limitations: [] },
      {
        question: 'q',
        intent: { metrics: [], dimensions: [], filters: [] },
        sqlPlan: { datasourceId: 1, datasourceName: '', sql: '', tables: [], fields: [], assumptions: [], safetyWarnings: [] },
        chartSuggestions: [],
        narrative: { summary: '', keyFindings: [], evidence: [], risks: [], nextQuestions: [] },
        semanticGaps: [],
        narrativeLevel: 'executed',
        queryResult: { columns: ['region', 'revenue'], rows: [['华东', 100], ['华南', 200]], rowCount: 2, truncated: false, elapsedMs: 50, historyId: null },
      },
    )
    expect(result.isEmpty).toBe(false)
    expect(result.error).toBeUndefined()
    expect(result.columns).toEqual(['region', 'revenue'])
    expect(result.rows).toEqual([['华东', 100], ['华南', 200]])
    expect(result.columns).not.toContain('nonExistent')
  })

  it('matches fields case-insensitively', () => {
    const adapter = RealLlmAdapter.create()
    const result = adapter.getChartData(
      { title: 't', chartType: 'bar', xField: 'Region', yFields: ['TOTAL_REVENUE'], rationale: '', limitations: [] },
      {
        question: 'q',
        intent: { metrics: [], dimensions: [], filters: [] },
        sqlPlan: { datasourceId: 1, datasourceName: '', sql: '', tables: [], fields: [], assumptions: [], safetyWarnings: [] },
        chartSuggestions: [],
        narrative: { summary: '', keyFindings: [], evidence: [], risks: [], nextQuestions: [] },
        semanticGaps: [],
        narrativeLevel: 'executed',
        queryResult: { columns: ['region', 'total_revenue'], rows: [['华东', 100]], rowCount: 1, truncated: false, elapsedMs: 50, historyId: null },
      },
    )
    expect(result.isEmpty).toBe(false)
    expect(result.error).toBeUndefined()
  })

  it('returns error when spec fields do not match queryResult columns', () => {
    const adapter = RealLlmAdapter.create()
    const result = adapter.getChartData(
      { title: 't', chartType: 'bar', xField: 'nonexistent', yFields: ['revenue'], rationale: '', limitations: [] },
      {
        question: 'q',
        intent: { metrics: [], dimensions: [], filters: [] },
        sqlPlan: { datasourceId: 1, datasourceName: '', sql: '', tables: [], fields: [], assumptions: [], safetyWarnings: [] },
        chartSuggestions: [],
        narrative: { summary: '', keyFindings: [], evidence: [], risks: [], nextQuestions: [] },
        semanticGaps: [],
        narrativeLevel: 'executed',
        queryResult: { columns: ['region', 'revenue'], rows: [['华东', 100]], rowCount: 1, truncated: false, elapsedMs: 50, historyId: null },
      },
    )
    expect(result.isEmpty).toBe(true)
    expect(result.error).toContain('不匹配')
  })

  it('returns only actual queryResult data, not fabricated data', () => {
    const adapter = RealLlmAdapter.create()
    const result = adapter.getChartData(
      { title: 't', chartType: 'bar', xField: 'a', yFields: ['b'], rationale: '', limitations: [] },
      {
        question: 'q',
        intent: { metrics: [], dimensions: [], filters: [] },
        sqlPlan: { datasourceId: 1, datasourceName: '', sql: '', tables: [], fields: [], assumptions: [], safetyWarnings: [] },
        chartSuggestions: [],
        narrative: { summary: '', keyFindings: [], evidence: [], risks: [], nextQuestions: [] },
        semanticGaps: [],
        narrativeLevel: 'executed',
        queryResult: { columns: ['a', 'b'], rows: [['x', 1], ['y', 2], ['z', 3]], rowCount: 3, truncated: false, elapsedMs: 50, historyId: null },
      },
    )
    expect(result.rows).toEqual([['x', 1], ['y', 2], ['z', 3]])
    expect(result.rows).not.toEqual([['华东', 100]])
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

  it('throws INVALID_RESPONSE for HTTP 422 with detail array', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        detail: [
          { msg: 'field required', loc: ['body', 'question'] },
        ],
      }),
    })

    const adapter = RealLlmAdapter.create()
    await expect(
      adapter.analyze('q', {
        datasourceId: null as any,
        datasourceName: null as any,
        selectedTables: [],
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: expect.stringContaining('请求参数校验失败'),
    })
  })

  it('throws INVALID_RESPONSE for HTTP 422 with string detail', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({
        detail: 'datasource_id is required',
      }),
    })

    const adapter = RealLlmAdapter.create()
    await expect(
      adapter.analyze('q', {
        datasourceId: undefined as any,
        datasourceName: undefined as any,
        selectedTables: [],
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: expect.stringContaining('请求参数校验失败'),
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

  // ── Phase 5M: METADATA_NOT_FOUND + sqlValidation ────────────────────

  it('throws METADATA_NOT_FOUND when backend returns that error code', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: false,
        errorCode: 'METADATA_NOT_FOUND',
        errorMessage: '未找到所选表的元数据',
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
      code: 'METADATA_NOT_FOUND',
      message: '未找到所选表的元数据',
    })
  })

  it('preserves details.sqlValidation in INVALID_RESPONSE error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: false,
        errorCode: 'INVALID_RESPONSE',
        errorMessage: 'SQL 校验未通过',
        details: {
          sqlValidation: {
            errors: [
              { rule: 'FIELD_NOT_FOUND', field: 'fake', message: '字段不存在' },
            ],
            warnings: [],
            sql: 'SELECT fake FROM t',
          },
        },
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
      code: 'INVALID_RESPONSE',
      message: 'SQL 校验未通过',
      details: {
        sqlValidation: {
          errors: [{ rule: 'FIELD_NOT_FOUND', field: 'fake', message: '字段不存在' }],
          warnings: [],
          sql: 'SELECT fake FROM t',
        },
      },
    })
  })

  // ── Phase 5M: sql_pending 真实响应回归（浏览器 blocker 复现结构）─────

  const sqlPendingBody = {
    ok: true,
    data: {
      question: '分析小微各区域投放金额情况',
      intent: {
        metrics: ['投放金额'],
        dimensions: ['区域'],
        filters: ['PT = 20260630'],
        timeRange: undefined,
      },
      sqlPlan: {
        datasourceId: 2,
        datasourceName: 'dwhrpt',
        sql: "SELECT VC_DIQYMC, SUM(DEC_XIAOSE) AS total_amount FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE PT = '20260630' GROUP BY VC_DIQYMC ORDER BY total_amount",
        tables: ['DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M'],
        fields: ['VC_DIQYMC', 'DEC_XIAOSE', 'PT'],
        assumptions: [],
        safetyWarnings: [],
      },
      chartSuggestions: [
        { title: '各区域投放金额', chartType: 'bar', xField: 'VC_DIQYMC', yFields: ['total_amount'], rationale: 'r', limitations: [] },
      ],
      narrative: {
        summary: '已生成待验证 SQL，请在 SQL Workbench 中验证后查看结论。',
        keyFindings: [],
        evidence: [],
        risks: [],
        nextQuestions: [],
        conclusion: undefined,
      },
      semanticGaps: [],
      narrativeLevel: 'sql_pending',
    },
  }

  it('accepts real sql_pending response (no INVALID_RESPONSE throw)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => sqlPendingBody,
    })

    const adapter = RealLlmAdapter.create()
    const result = await adapter.analyze('分析小微各区域投放金额情况', {
      datasourceId: 2,
      datasourceName: 'dwhrpt',
      selectedTables: ['DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M'],
    })

    expect(result.narrativeLevel).toBe('sql_pending')
    expect(result.narrative.evidence).toEqual([])
  })

  it('sends sessionId and assistantMessageId in request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => validBody,
    })

    const adapter = RealLlmAdapter.create()
    await adapter.analyze('q', {
      datasourceId: 1,
      datasourceName: '示例数据源',
      selectedTables: ['t'],
      sessionId: 42,
      assistantMessageId: 101,
    })

    const [, init] = mockFetch.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.sessionId).toBe(42)
    expect(body.assistantMessageId).toBe(101)
  })
})
