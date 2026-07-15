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

  it('rejects executed + empty evidence (executed contract preserved)', () => {
    const result = validateAiAskResponse({
      ...sqlPendingEmptyEvidence,
      narrativeLevel: 'executed',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'narrative.evidence')).toBe(true)
  })

  it('rejects legacy response (no narrativeLevel) + empty evidence (Phase 5K contract preserved)', () => {
    const { narrativeLevel: _drop, ...rest } = sqlPendingEmptyEvidence
    const result = validateAiAskResponse(rest as any)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.path === 'narrative.evidence')).toBe(true)
  })
})
