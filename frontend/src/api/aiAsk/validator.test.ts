// frontend/src/api/aiAsk/validator.test.ts
import { describe, it, expect } from 'vitest'
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
    expect(result.errors.some((e) => e.path === 'question')).toBe(true)
  })

  it('warns on empty metrics and dimensions', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      intent: { metrics: [], dimensions: [], filters: [], timeRange: undefined },
    })
    expect(result.warnings.some((w) => w.includes('无 metrics'))).toBe(true)
  })

  it('warns on empty chartSuggestions', () => {
    const result = validateAiAskResponse({ ...validResponse, chartSuggestions: [] })
    expect(result.warnings.some((w) => w.includes('chartSuggestions 为空'))).toBe(true)
  })

  it('warns on invalid chartType', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      chartSuggestions: [
        { title: '图', chartType: 'invalid', xField: 'x', yFields: ['y'], rationale: 'r', limitations: [] },
      ],
    })
    expect(result.warnings.some((w) => w.includes('不合法'))).toBe(true)
  })

  // ── intent ──────────────────────────────────────────────────────────

  it('errors when intent is missing', () => {
    const { intent: _, ...rest } = validResponse
    const result = validateAiAskResponse(rest)
    expect(result.errors.some((e) => e.path === 'intent')).toBe(true)
  })

  it('errors when intent.metrics is not an array', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      intent: { ...validResponse.intent, metrics: 'sales' as any },
    })
    expect(result.errors.some((e) => e.path === 'intent.metrics')).toBe(true)
  })

  it('errors when intent.dimensions is not an array', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      intent: { ...validResponse.intent, dimensions: 123 as any },
    })
    expect(result.errors.some((e) => e.path === 'intent.dimensions')).toBe(true)
  })

  it('errors when intent.filters is not an array', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      intent: { ...validResponse.intent, filters: null as any },
    })
    expect(result.errors.some((e) => e.path === 'intent.filters')).toBe(true)
  })

  // ── sqlPlan ─────────────────────────────────────────────────────────

  it('errors when sqlPlan is missing', () => {
    const { sqlPlan: _, ...rest } = validResponse
    const result = validateAiAskResponse(rest)
    expect(result.errors.some((e) => e.path === 'sqlPlan')).toBe(true)
  })

  it('errors when sqlPlan.datasourceId is not a number', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      sqlPlan: { ...validResponse.sqlPlan, datasourceId: '2' as any },
    })
    expect(result.errors.some((e) => e.path === 'sqlPlan.datasourceId')).toBe(true)
  })

  it('errors when sqlPlan.datasourceName is missing', () => {
    const { datasourceName: _, ...plan } = validResponse.sqlPlan
    const result = validateAiAskResponse({ ...validResponse, sqlPlan: plan })
    expect(result.errors.some((e) => e.path === 'sqlPlan.datasourceName')).toBe(true)
  })

  it('warns when sqlPlan.datasourceName is empty string', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      sqlPlan: { ...validResponse.sqlPlan, datasourceName: '' },
    })
    expect(result.warnings.some((w) => w.includes('datasourceName'))).toBe(true)
  })

  it('errors when sqlPlan.sql is empty', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      sqlPlan: { ...validResponse.sqlPlan, sql: '' },
    })
    expect(result.errors.some((e) => e.path === 'sqlPlan.sql')).toBe(true)
  })

  it('errors when sqlPlan.tables is missing', () => {
    const { tables: _, ...plan } = validResponse.sqlPlan
    const result = validateAiAskResponse({ ...validResponse, sqlPlan: plan })
    expect(result.errors.some((e) => e.path === 'sqlPlan.tables')).toBe(true)
  })

  it('errors when sqlPlan.tables is not an array', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      sqlPlan: { ...validResponse.sqlPlan, tables: 't' as any },
    })
    expect(result.errors.some((e) => e.path === 'sqlPlan.tables')).toBe(true)
  })

  it('warns when sqlPlan.tables is empty', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      sqlPlan: { ...validResponse.sqlPlan, tables: [] },
    })
    expect(result.warnings.some((w) => w.includes('sqlPlan.tables'))).toBe(true)
  })

  it('errors when sqlPlan.fields is missing', () => {
    const { fields: _, ...plan } = validResponse.sqlPlan
    const result = validateAiAskResponse({ ...validResponse, sqlPlan: plan })
    expect(result.errors.some((e) => e.path === 'sqlPlan.fields')).toBe(true)
  })

  it('errors when sqlPlan.fields is not an array', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      sqlPlan: { ...validResponse.sqlPlan, fields: 'a' as any },
    })
    expect(result.errors.some((e) => e.path === 'sqlPlan.fields')).toBe(true)
  })

  it('warns when sqlPlan.fields is empty', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      sqlPlan: { ...validResponse.sqlPlan, fields: [] },
    })
    expect(result.warnings.some((w) => w.includes('sqlPlan.fields'))).toBe(true)
  })

  it('errors when sqlPlan.assumptions is missing', () => {
    const { assumptions: _, ...plan } = validResponse.sqlPlan
    const result = validateAiAskResponse({ ...validResponse, sqlPlan: plan })
    expect(result.errors.some((e) => e.path === 'sqlPlan.assumptions')).toBe(true)
  })

  it('errors when sqlPlan.safetyWarnings is not an array', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      sqlPlan: { ...validResponse.sqlPlan, safetyWarnings: 'safe' as any },
    })
    expect(result.errors.some((e) => e.path === 'sqlPlan.safetyWarnings')).toBe(true)
  })

  // ── chartSuggestions ────────────────────────────────────────────────

  it('errors when chartSuggestions is missing', () => {
    const { chartSuggestions: _, ...rest } = validResponse
    const result = validateAiAskResponse(rest)
    expect(result.errors.some((e) => e.path === 'chartSuggestions')).toBe(true)
  })

  it('errors when chartSuggestions is not an array', () => {
    const result = validateAiAskResponse({ ...validResponse, chartSuggestions: 'chart' as any })
    expect(result.errors.some((e) => e.path === 'chartSuggestions')).toBe(true)
  })

  // ── narrative ───────────────────────────────────────────────────────

  it('errors when narrative is missing', () => {
    const { narrative: _, ...rest } = validResponse
    const result = validateAiAskResponse(rest)
    expect(result.errors.some((e) => e.path === 'narrative')).toBe(true)
  })

  it('errors when narrative.summary is empty', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrative: { ...validResponse.narrative, summary: '' },
    })
    expect(result.errors.some((e) => e.path === 'narrative.summary')).toBe(true)
  })

  it('errors when narrative.keyFindings is missing', () => {
    const { keyFindings: _, ...narrative } = validResponse.narrative
    const result = validateAiAskResponse({ ...validResponse, narrative })
    expect(result.errors.some((e) => e.path === 'narrative.keyFindings')).toBe(true)
  })

  it('warns when narrative.keyFindings is empty', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrative: { ...validResponse.narrative, keyFindings: [] },
    })
    expect(result.warnings.some((w) => w.includes('narrative.keyFindings'))).toBe(true)
  })

  it('errors when narrative.evidence is missing', () => {
    const { evidence: _, ...narrative } = validResponse.narrative
    const result = validateAiAskResponse({ ...validResponse, narrative })
    expect(result.errors.some((e) => e.path === 'narrative.evidence')).toBe(true)
  })

  it('errors when narrative.evidence is empty', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrative: { ...validResponse.narrative, evidence: [] },
    })
    expect(result.errors.some((e) => e.path === 'narrative.evidence')).toBe(true)
  })

  it('errors when evidence.claim is empty', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrative: {
        ...validResponse.narrative,
        evidence: [{ ...validResponse.narrative.evidence[0], claim: '' }],
      },
    })
    expect(result.errors.some((e) => e.path === 'narrative.evidence[0].claim')).toBe(true)
  })

  it('errors when evidence.fields is empty', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrative: {
        ...validResponse.narrative,
        evidence: [{ ...validResponse.narrative.evidence[0], fields: [] }],
      },
    })
    expect(result.errors.some((e) => e.path === 'narrative.evidence[0].fields')).toBe(true)
  })

  it('errors when evidence.fields is not a string array', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrative: {
        ...validResponse.narrative,
        evidence: [{ ...validResponse.narrative.evidence[0], fields: [1, 2] as any }],
      },
    })
    expect(result.errors.some((e) => e.path === 'narrative.evidence[0].fields')).toBe(true)
  })

  it('errors when evidence.fields contains only empty string', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrative: {
        ...validResponse.narrative,
        evidence: [{ ...validResponse.narrative.evidence[0], fields: [''] }],
      },
    })
    expect(result.errors.some((e) => e.path === 'narrative.evidence[0].fields')).toBe(true)
  })

  it('warns when evidence.sourceFields contains only empty string', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrative: {
        ...validResponse.narrative,
        evidence: [{ ...validResponse.narrative.evidence[0], sourceFields: [''] }],
      },
    })
    expect(result.warnings.some((w) => w.includes('sourceFields'))).toBe(true)
  })

  it('warns when evidence.sqlSnippet is missing', () => {
    const { sqlSnippet: _, ...item } = validResponse.narrative.evidence[0]
    const result = validateAiAskResponse({
      ...validResponse,
      narrative: { ...validResponse.narrative, evidence: [item] },
    })
    expect(result.warnings.some((w) => w.includes('sqlSnippet'))).toBe(true)
  })

  it('warns when evidence.calculation is missing', () => {
    const { calculation: _, ...item } = validResponse.narrative.evidence[0]
    const result = validateAiAskResponse({
      ...validResponse,
      narrative: { ...validResponse.narrative, evidence: [item] },
    })
    expect(result.warnings.some((w) => w.includes('calculation'))).toBe(true)
  })

  it('warns when evidence.sourceFields is missing', () => {
    const { sourceFields: _, ...item } = validResponse.narrative.evidence[0]
    const result = validateAiAskResponse({
      ...validResponse,
      narrative: { ...validResponse.narrative, evidence: [item] },
    })
    expect(result.warnings.some((w) => w.includes('sourceFields'))).toBe(true)
  })

  it('warns when evidence.confidence is invalid', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrative: {
        ...validResponse.narrative,
        evidence: [{ ...validResponse.narrative.evidence[0], confidence: 'unknown' as any }],
      },
    })
    expect(result.warnings.some((w) => w.includes('confidence'))).toBe(true)
  })

  it('warns when evidence.confidenceReason is missing for non-high confidence', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrative: {
        ...validResponse.narrative,
        evidence: [{ ...validResponse.narrative.evidence[0], confidence: 'low' }],
      },
    })
    expect(result.warnings.some((w) => w.includes('confidenceReason'))).toBe(true)
  })

  it('warns when evidence.relatedIntent lacks metrics or dimensions', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrative: {
        ...validResponse.narrative,
        evidence: [
          {
            ...validResponse.narrative.evidence[0],
            relatedIntent: { metrics: [] } as any,
          },
        ],
      },
    })
    expect(result.warnings.some((w) => w.includes('relatedIntent'))).toBe(true)
  })

  it('errors when narrative.risks is not an array', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrative: { ...validResponse.narrative, risks: 'risk' as any },
    })
    expect(result.errors.some((e) => e.path === 'narrative.risks')).toBe(true)
  })

  it('errors when narrative.nextQuestions is not an array', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrative: { ...validResponse.narrative, nextQuestions: 'q' as any },
    })
    expect(result.errors.some((e) => e.path === 'narrative.nextQuestions')).toBe(true)
  })

  it('warns when narrative.conclusion is missing', () => {
    const { conclusion: _, ...narrative } = validResponse.narrative
    const result = validateAiAskResponse({ ...validResponse, narrative })
    expect(result.warnings.some((w) => w.includes('conclusion'))).toBe(true)
  })

  // ── semanticGaps ────────────────────────────────────────────────────

  it('errors when semanticGaps is missing', () => {
    const { semanticGaps: _, ...rest } = validResponse
    const result = validateAiAskResponse(rest)
    expect(result.errors.some((e) => e.path === 'semanticGaps')).toBe(true)
  })

  it('errors when semanticGaps is not an array', () => {
    const result = validateAiAskResponse({ ...validResponse, semanticGaps: 'gap' as any })
    expect(result.errors.some((e) => e.path === 'semanticGaps')).toBe(true)
  })

  it('warns when semanticGap.field is empty', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      semanticGaps: [{ field: '', reason: 'not_found' }],
    })
    expect(result.warnings.some((w) => w.includes('semanticGaps[0].field'))).toBe(true)
  })

  it('warns when semanticGap.reason is invalid', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      semanticGaps: [{ field: 'x', reason: 'wrong' as any }],
    })
    expect(result.warnings.some((w) => w.includes('semanticGaps[0].reason'))).toBe(true)
  })

  it('warns when semanticGap.field conflicts with intent.metrics', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      intent: { ...validResponse.intent, metrics: ['销售额'] },
      semanticGaps: [{ field: '销售额', reason: 'not_found' }],
    })
    expect(result.warnings.some((w) => w.includes('冲突'))).toBe(true)
  })

  // ── followUp ────────────────────────────────────────────────────────

  it('errors when followUp.type is invalid', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      followUp: { type: 'invalid' as any, confidence: 'high' },
    })
    expect(result.errors.some((e) => e.path === 'followUp.type')).toBe(true)
  })

  it('errors when followUp.confidence is invalid', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      followUp: { type: 'drill_down', confidence: 'invalid' as any },
    })
    expect(result.errors.some((e) => e.path === 'followUp.confidence')).toBe(true)
  })

  // ── Phase 5M: narrativeLevel / sqlValidation compatibility ───────────

  it('accepts narrativeLevel sql_pending', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrativeLevel: 'sql_pending',
    })
    expect(result.valid).toBe(true)
  })

  it('accepts narrativeLevel executed', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrativeLevel: 'executed',
      queryResult: {
        columns: ['region', 'sales'],
        rows: [['华东', 100]],
        rowCount: 1,
        truncated: false,
        elapsedMs: 150,
        historyId: 42,
      },
    })
    expect(result.valid).toBe(true)
  })

  it('rejects invalid narrativeLevel', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrativeLevel: 'invalid_level' as any,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'narrativeLevel')).toBe(true)
  })

  it('accepts response without narrativeLevel (backward compat)', () => {
    const result = validateAiAskResponse(validResponse)
    expect(result.valid).toBe(true)
    // ensure no narrativeLevel-related errors
    expect(result.errors.some((e) => e.path === 'narrativeLevel')).toBe(false)
  })

  it('accepts sqlValidation as optional field', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      sqlValidation: {
        errors: [{ rule: 'FIELD_NOT_FOUND', message: '字段不存在' }],
        warnings: [],
        sql: 'SELECT *',
      },
    })
    expect(result.valid).toBe(true)
  })

  it('rejects non-object sqlValidation', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      sqlValidation: 'bad' as any,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'sqlValidation')).toBe(true)
  })

  // ── Phase 5M: sql_pending 允许 evidence 为空 ─────────────────────────

  const sqlPendingEmptyEvidence: AiAskResponse = {
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
      summary: '已生成待验证 SQL，请在 SQL Workbench 中验证后查看结论。',
      keyFindings: [],
      evidence: [],
      risks: [],
      nextQuestions: [],
    },
    semanticGaps: [],
    narrativeLevel: 'sql_pending',
  }

  it('accepts sql_pending + empty evidence (valid=true)', () => {
    const result = validateAiAskResponse(sqlPendingEmptyEvidence)
    expect(result.valid).toBe(true)
    expect(result.errors.some((e) => e.path === 'narrative.evidence')).toBe(false)
  })

  it('rejects sql_pending with missing evidence field (legacy structure broken)', () => {
    const { evidence: _drop, ...narrative } = sqlPendingEmptyEvidence.narrative
    const result = validateAiAskResponse({
      ...sqlPendingEmptyEvidence,
      narrative: narrative as any,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'narrative.evidence')).toBe(true)
  })

  it('rejects sql_pending with non-array evidence', () => {
    const result = validateAiAskResponse({
      ...sqlPendingEmptyEvidence,
      narrative: { ...sqlPendingEmptyEvidence.narrative, evidence: null as any },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'narrative.evidence')).toBe(true)
  })

  it('rejects executed + empty evidence + missing queryResult', () => {
    const result = validateAiAskResponse({
      ...sqlPendingEmptyEvidence,
      narrativeLevel: 'executed',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult')).toBe(true)
  })

  it('rejects legacy response (no narrativeLevel) + empty evidence (Phase 5K contract preserved)', () => {
    const { narrativeLevel: _drop, ...rest } = sqlPendingEmptyEvidence
    const result = validateAiAskResponse(rest as any)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'narrative.evidence')).toBe(true)
  })

  // ── Phase 5N: queryResult validation ─────────────────────────────────

  const makeExecutedWithQueryResult = (overrides: Record<string, unknown> = {}) => ({
    ...validResponse,
    narrativeLevel: 'executed' as const,
    queryResult: {
      columns: ['region', 'sales'],
      rows: [['华东', 100], ['华北', 200]],
      rowCount: 2,
      truncated: false,
      elapsedMs: 150,
      historyId: 42,
      ...overrides,
    },
  })

  const makeSqlPending = (queryResultOverride?: unknown) => ({
    ...validResponse,
    narrativeLevel: 'sql_pending' as const,
    ...(queryResultOverride !== undefined ? { queryResult: queryResultOverride } : {}),
  })

  it('accepts sql_pending with no queryResult field', () => {
    const result = validateAiAskResponse(makeSqlPending())
    expect(result.valid).toBe(true)
    expect(result.errors.some((e) => e.path === 'queryResult')).toBe(false)
  })

  it('accepts sql_pending with queryResult null', () => {
    const result = validateAiAskResponse(makeSqlPending(null))
    expect(result.valid).toBe(true)
    expect(result.errors.some((e) => e.path === 'queryResult')).toBe(false)
  })

  it('accepts executed with valid queryResult', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult())
    expect(result.valid).toBe(true)
    expect(result.errors.some((e) => e.path.startsWith('queryResult'))).toBe(false)
  })

  it('rejects executed without queryResult', () => {
    const { queryResult: _, ...rest } = makeExecutedWithQueryResult()
    const result = validateAiAskResponse(rest)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult')).toBe(true)
  })

  it('rejects executed with queryResult null', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrativeLevel: 'executed' as const,
      queryResult: null as any,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult')).toBe(true)
  })

  it('rejects executed with non-object queryResult', () => {
    const result = validateAiAskResponse({
      ...validResponse,
      narrativeLevel: 'executed' as const,
      queryResult: 'string',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult' && e.message.includes('对象'))).toBe(true)
  })

  it('rejects executed when columns is not string[]', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ columns: [1, 2, 3] as any }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.columns')).toBe(true)
  })

  it('rejects executed when columns is a string (not array)', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ columns: 'region' as any }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.columns')).toBe(true)
  })

  it('rejects executed when rows is not an array', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ rows: 'data' as any }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.rows')).toBe(true)
  })

  it('rejects executed when rows is not a 2D array (row is not array)', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ rows: ['not_array'] as any }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.rows')).toBe(true)
  })

  it('accepts executed with empty rows array', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ rows: [], rowCount: 0 }))
    expect(result.valid).toBe(true)
  })
  // -- Phase 5N follow-up: executed empty evidence exception ---

  const makeExecutedEmptyEvidence = (overrides = {}) => ({
    question: 'test',
    intent: { metrics: [], dimensions: [], filters: [] },
    sqlPlan: { datasourceId: 1, datasourceName: 'd', sql: 'SELECT 1', tables: ['t'], fields: ['a'], assumptions: [], safetyWarnings: [] },
    chartSuggestions: [],
    narrative: { summary: 's', keyFindings: [], evidence: [], risks: [], nextQuestions: [] },
    semanticGaps: [],
    narrativeLevel: 'executed' as const,
    queryResult: { columns: ['a'], rows: [], rowCount: 0, truncated: false, elapsedMs: 10, historyId: null, ...overrides },
  })

  it('accepts executed + rows=[] + evidence=[]', () => {
    const r = validateAiAskResponse(makeExecutedEmptyEvidence())
    expect(r.valid).toBe(true)
  })

  it('accepts executed + string-only rows + evidence=[] (dimension-only result)', () => {
    const r = validateAiAskResponse(makeExecutedEmptyEvidence({ rows: [['x']], rowCount: 1 }))
    expect(r.valid).toBe(true)
    expect(r.errors.some((e) => e.path === 'narrative.evidence')).toBe(false)
  })

  it('still rejects executed + evidence that is not an array', () => {
    const r = validateAiAskResponse({
      ...makeExecutedEmptyEvidence({ rows: [['x']], rowCount: 1 }),
      narrative: { summary: 's', keyFindings: [], evidence: 'bad' as any, risks: [], nextQuestions: [] },
    })
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.path === 'narrative.evidence')).toBe(true)
  })

  it('rejects executed + missing queryResult + evidence=[]', () => {
    const { queryResult: _, ...rest } = makeExecutedEmptyEvidence()
    const r = validateAiAskResponse(rest)
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.path === 'queryResult')).toBe(true)
  })


  it('rejects executed with negative rowCount', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ rowCount: -1 }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.rowCount')).toBe(true)
  })

  it('rejects executed with NaN rowCount', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ rowCount: NaN }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.rowCount')).toBe(true)
  })

  it('rejects executed with Infinity rowCount', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ rowCount: Infinity }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.rowCount')).toBe(true)
  })

  it('rejects executed with string rowCount', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ rowCount: '2' as any }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.rowCount')).toBe(true)
  })

  it('accepts executed with zero rowCount (empty result)', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ rows: [], rowCount: 0 }))
    expect(result.valid).toBe(true)
  })

  it('rejects executed with negative elapsedMs', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ elapsedMs: -1 }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.elapsedMs')).toBe(true)
  })

  it('rejects executed with NaN elapsedMs', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ elapsedMs: NaN }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.elapsedMs')).toBe(true)
  })

  it('rejects executed with Infinity elapsedMs', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ elapsedMs: Infinity }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.elapsedMs')).toBe(true)
  })

  it('rejects executed with string elapsedMs', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ elapsedMs: '150' as any }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.elapsedMs')).toBe(true)
  })

  it('rejects executed when truncated is not boolean (string)', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ truncated: 'false' as any }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.truncated')).toBe(true)
  })

  it('rejects executed when truncated is undefined', () => {
    const { truncated: _, ...qr } = makeExecutedWithQueryResult().queryResult!
    const result = validateAiAskResponse({
      ...makeExecutedWithQueryResult(),
      queryResult: qr,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.truncated')).toBe(true)
  })

  it('rejects executed when historyId is string', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ historyId: '42' as any }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.historyId')).toBe(true)
  })

  it('accepts executed when historyId is null', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ historyId: null }))
    expect(result.valid).toBe(true)
  })

  it('accepts executed when historyId is number', () => {
    const result = validateAiAskResponse(makeExecutedWithQueryResult({ historyId: 123 }))
    expect(result.valid).toBe(true)
  })

  it('rejects snake_case fields in queryResult (e.g. row_count)', () => {
    const snakeCaseQr = {
      columns: ['region', 'sales'],
      rows: [['华东', 100]],
      row_count: 1,
      truncated: false,
      elapsed_ms: 100,
      history_id: 1,
    }
    // snake_case fields won't match camelCase validation — rowCount/elapsedMs/historyId are undefined
    const result = validateAiAskResponse({
      ...validResponse,
      narrativeLevel: 'executed',
      queryResult: snakeCaseQr as any,
    })
    // Must have errors because rowCount, elapsedMs, historyId are missing/undefined
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.rowCount')).toBe(true)
    expect(result.errors.some((e) => e.path === 'queryResult.elapsedMs')).toBe(true)
  })

  it('rejects executed with missing rowCount field', () => {
    const { rowCount: _, ...qr } = makeExecutedWithQueryResult().queryResult!
    const result = validateAiAskResponse({
      ...makeExecutedWithQueryResult(),
      queryResult: qr,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.rowCount')).toBe(true)
  })

  it('rejects executed with missing columns field', () => {
    const { columns: _, ...qr } = makeExecutedWithQueryResult().queryResult!
    const result = validateAiAskResponse({
      ...makeExecutedWithQueryResult(),
      queryResult: qr,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'queryResult.columns')).toBe(true)
  })

  // -- Phase 5N follow-up: queryResult row structure validation ---

  describe('queryResult row length validation', () => {
    it('rejects row with fewer cells than columns', () => {
      const result = validateAiAskResponse(makeExecutedWithQueryResult({
        columns: ['region', 'sales'],
        rows: [['华东']],
      }))
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.path === 'queryResult.rows[0]')).toBe(true)
    })

    it('rejects row with more cells than columns', () => {
      const result = validateAiAskResponse(makeExecutedWithQueryResult({
        columns: ['region'],
        rows: [['华东', 100]],
      }))
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.path === 'queryResult.rows[0]')).toBe(true)
    })

    it('points to correct row index when only row[1] has wrong width', () => {
      const result = validateAiAskResponse(makeExecutedWithQueryResult({
        columns: ['region', 'sales'],
        rows: [
          ['华东', 100],
          ['华南'],
        ],
      }))
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.path === 'queryResult.rows[1]')).toBe(true)
      expect(result.errors.some((e) => e.path === 'queryResult.rows[0]')).toBe(false)
    })

    it('allows columns=[] rows=[] as structurally valid', () => {
      const result = validateAiAskResponse(makeExecutedWithQueryResult({
        columns: [],
        rows: [],
        rowCount: 0,
      }))
      expect(result.errors.some((e) => e.path && e.path.startsWith('queryResult.rows'))).toBe(false)
    })
  })

  // ── Phase 5N follow-up 5: executed evidence 收紧 ───────────────────────

  const makeExecutedEvidenceCheck = (overrides = {}) => ({
    question: 'test',
    intent: { metrics: [], dimensions: [], filters: [] },
    sqlPlan: { datasourceId: 1, datasourceName: 'd', sql: 'SELECT 1', tables: ['t'], fields: ['a'], assumptions: [], safetyWarnings: [] },
    chartSuggestions: [],
    narrative: { summary: 's', keyFindings: [] as string[], evidence: [] as any[], risks: [], nextQuestions: [] },
    semanticGaps: [],
    narrativeLevel: 'executed' as const,
    queryResult: { columns: ['a'], rows: [] as any[][], rowCount: 0, truncated: false, elapsedMs: 10, historyId: null, ...overrides },
    ...overrides,
  })

  it('accepts executed + dimension-only rows + keyFindings=[] + evidence=[]', () => {
    const result = validateAiAskResponse(makeExecutedEvidenceCheck({
      queryResult: { columns: ['region'], rows: [['长三角'], ['京津冀']], rowCount: 2, truncated: false, elapsedMs: 10, historyId: null },
    }))
    expect(result.valid).toBe(true)
    expect(result.errors.some((e) => e.path === 'narrative.evidence')).toBe(false)
  })

  it('accepts executed + empty rows + keyFindings=[] + evidence=[]', () => {
    const result = validateAiAskResponse(makeExecutedEvidenceCheck())
    expect(result.valid).toBe(true)
    expect(result.errors.some((e) => e.path === 'narrative.evidence')).toBe(false)
  })

  it('rejects executed + numeric rows + keyFindings non-empty + evidence=[]', () => {
    const result = validateAiAskResponse(makeExecutedEvidenceCheck({
      queryResult: { columns: ['region', 'sales'], rows: [['华东', 100]], rowCount: 1, truncated: false, elapsedMs: 10, historyId: null },
      narrative: { summary: 's', keyFindings: ['sales 最高'], evidence: [], risks: [], nextQuestions: [] },
    }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'narrative.evidence')).toBe(true)
  })

  it('rejects executed + fabricated finding + evidence=[]', () => {
    const result = validateAiAskResponse(makeExecutedEvidenceCheck({
      narrative: { summary: 's', keyFindings: ['任意结论'], evidence: [], risks: [], nextQuestions: [] },
    }))
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'narrative.evidence')).toBe(true)
  })

  it('rejects executed + missing evidence', () => {
    const base = makeExecutedEvidenceCheck()
    const { evidence: _, ...narrative } = base.narrative
    const result = validateAiAskResponse({ ...base, narrative })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'narrative.evidence')).toBe(true)
  })

  it('rejects executed + null evidence', () => {
    const base = makeExecutedEvidenceCheck()
    const result = validateAiAskResponse({ ...base, narrative: { ...base.narrative, evidence: null } })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'narrative.evidence')).toBe(true)
  })

  it('accepts executed + non-empty evidence', () => {
    const base = makeExecutedEvidenceCheck({
      queryResult: { columns: ['region', 'sales'], rows: [['华东', 100]], rowCount: 1, truncated: false, elapsedMs: 10, historyId: null },
      narrative: {
        summary: 's',
        keyFindings: ['华东 sales 最高'],
        evidence: [{
          claim: '华东 sales 最高',
          fields: ['region', 'sales'],
          sqlSnippet: 'SELECT region, SUM(sales) FROM t GROUP BY region',
          calculation: 'SUM(sales)',
          sourceFields: ['region', 'sales'],
          confidence: 'high',
        }],
        risks: [],
        nextQuestions: [],
      },
    })
    const result = validateAiAskResponse(base)
    expect(result.valid).toBe(true)
    expect(result.errors.some((e) => e.path === 'narrative.evidence')).toBe(false)
  })
})

  // ── Phase 5N Task 6.5D: columnTypes validation ──

  // 构造 narrativeLevel=executed 且带 queryResult 的合法响应
  function makeValidExecutedResponse(): AiAskResponse {
    return {
      ...validResponse,
      narrativeLevel: 'executed',
      queryResult: {
        columns: ['region', 'sales'],
        rows: [['华东', 100]],
        rowCount: 1,
        truncated: false,
        elapsedMs: 10,
        historyId: null,
      },
    }
  }

  it('accepts valid columnTypes matching columns length', () => {
    const base = makeValidExecutedResponse()
    base.queryResult!.columnTypes = ['string', 'decimal']
    const result = validateAiAskResponse(base)
    expect(result.valid).toBe(true)
  })

  it('rejects columnTypes with wrong length', () => {
    const base = makeValidExecutedResponse()
    base.queryResult!.columnTypes = ['string']
    const result = validateAiAskResponse(base)
    expect(result.errors.some(e => e.path === 'queryResult.columnTypes')).toBe(true)
  })

  it('rejects columnTypes with invalid type values', () => {
    const base = makeValidExecutedResponse()
    base.queryResult!.columnTypes = ['string', 'integer']
    const result = validateAiAskResponse(base)
    expect(result.errors.some(e => e.path === 'queryResult.columnTypes')).toBe(true)
  })

  it('accepts all valid columnType values', () => {
    const base = makeValidExecutedResponse()
    base.queryResult = {
      columns: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
      rows: [[]],
      rowCount: 1,
      truncated: false,
      elapsedMs: 10,
      historyId: null,
      columnTypes: ['unknown', 'null', 'bool', 'int', 'float', 'decimal', 'date', 'datetime', 'bytes', 'string', 'mixed'],
    }
    const result = validateAiAskResponse(base)
    expect(result.errors.some(e => e.path === 'queryResult.columnTypes')).toBe(false)
  })

  it('allows missing columnTypes (backward compat)', () => {
    const base = makeValidExecutedResponse()
    delete base.queryResult!.columnTypes
    const result = validateAiAskResponse(base)
    expect(result.valid).toBe(true)
  })
