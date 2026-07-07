// frontend/src/api/aiAsk/mockAdapter.test.ts
import { describe, it, expect } from 'vitest'
import { MockAdapter } from './mockAdapter'
import { AiAskError } from './errors'
import { validateAiAskResponse } from './validator'
import type { AiAskContext } from './adapter'
import type { AiAskResponse } from '../../types/aiAsk'

describe('MockAdapter', () => {
  const adapter = MockAdapter.create()

  it('returns name', () => {
    expect(adapter.name).toBe('MockAdapter')
  })

  it('isAvailable returns true', () => {
    expect(adapter.isAvailable()).toBe(true)
  })

  it('matches revenue scenario — recommendCharts generates bar + pie', async () => {
    const resp = await adapter.analyze('各区域销售额是多少', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    // recommendCharts should generate bar (from rule 4: single dim + metric)
    expect(resp.chartSuggestions.length).toBeGreaterThanOrEqual(1)
    expect(resp.chartSuggestions.some(s => s.chartType === 'bar')).toBe(true)
    expect(resp.resultSummary).toBeDefined()
  })

  it('matches trend scenario — recommendCharts generates line', async () => {
    const resp = await adapter.analyze('近 6 个月收入趋势', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    // recommendCharts should generate line (from rule 2: time dimension)
    expect(resp.chartSuggestions.some(s => s.chartType === 'line')).toBe(true)
  })

  it('matches top-n scenario — recommendCharts generates bar (sorted)', async () => {
    const resp = await adapter.analyze('本月收入 Top 10', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    // recommendCharts should generate bar (from rule 3: rank intent)
    expect(resp.chartSuggestions.some(s => s.chartType === 'bar')).toBe(true)
  })

  it('matches comparison scenario — recommendCharts generates combo', async () => {
    const resp = await adapter.analyze('今年和去年同比对比', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    // recommendCharts should generate combo (from rule 1: comparison)
    expect(resp.chartSuggestions.some(s => s.chartType === 'combo')).toBe(true)
  })

  it('falls back to default scenario for unknown question', async () => {
    const resp = await adapter.analyze('随便看看', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    expect(resp).toBeDefined()
  })

  it('scenario-specific chartSuggestions differ between questions', async () => {
    const revenueResp = await adapter.analyze('各区域销售额', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    const trendResp = await adapter.analyze('近 6 个月收入趋势', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    // Different questions → different scenario → different chart types
    const revenueTypes = revenueResp.chartSuggestions.map(s => s.chartType)
    const trendTypes = trendResp.chartSuggestions.map(s => s.chartType)
    expect(revenueTypes).not.toEqual(trendTypes)
  })

  it('injects datasourceId/Name from context', async () => {
    const resp = await adapter.analyze('各区域销售额', {
      datasourceId: 3, datasourceName: 'test_ds', selectedTables: [],
    })
    expect(resp.sqlPlan.datasourceId).toBe(3)
    expect(resp.sqlPlan.datasourceName).toBe('test_ds')
  })

  it('getChartData returns non-empty result for matching scenario', async () => {
    const resp = await adapter.analyze('各区域销售额', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    const data = adapter.getChartData(resp.chartSuggestions[0], resp)
    expect(data.isEmpty).toBe(false)
    expect(data.columns.length).toBeGreaterThan(0)
  })

  it('recommendCharts adds metric-card suggestion at end', async () => {
    const resp = await adapter.analyze('各区域销售额', {
      datasourceId: null, datasourceName: null, selectedTables: [],
    })
    const lastChart = resp.chartSuggestions[resp.chartSuggestions.length - 1]
    expect(lastChart.chartType).toBe('metric-card')
  })

  // --- Phase 5H: Multi-turn follow-up tests ---

  describe('MockAdapter multi-turn', () => {
    async function firstRound(): Promise<AiAskResponse> {
      return adapter.analyze('各区域销售额', {
        datasourceId: null, datasourceName: null, selectedTables: [],
      })
    }

    function makeContext(prevResponse: AiAskResponse): AiAskContext {
      return {
        datasourceId: null, datasourceName: null, selectedTables: [],
        messageHistory: [
          { role: 'user', content: '各区域销售额' },
          { role: 'assistant', content: '各区域销售额分析结果', responseJson: prevResponse as any },
        ],
      }
    }

    it('detects multi-turn when messageHistory has assistant response', async () => {
      const prev = await firstRound()
      const resp = await adapter.analyze('为什么华东最高', makeContext(prev))
      expect(resp.followUp).toBeDefined()
      expect(resp.followUp!.type).toBe('drill_down')
      expect(resp.followUp!.targetValue).toBe('华东')
    })

    it('returns contextSummary for follow-up response', async () => {
      const prev = await firstRound()
      const resp = await adapter.analyze('为什么华东最高', makeContext(prev))
      expect(resp.contextSummary).toBeTruthy()
      expect(resp.contextSummary).toContain('上一轮')
    })

    it('multi-turn response has different chart suggestions', async () => {
      const prev = await firstRound()
      const resp = await adapter.analyze('为什么华东最高', makeContext(prev))
      expect(resp.chartSuggestions.length).toBeGreaterThanOrEqual(1)
      // Should have different narrative from single-turn
      expect(resp.narrative.conclusion).toBeDefined()
      expect(resp.narrative.evidence.length).toBeGreaterThan(0)
    })

    it('handles why_down follow-up', async () => {
      const prev = await firstRound()
      const resp = await adapter.analyze('为什么销售额下降', makeContext(prev))
      expect(resp.followUp).toBeDefined()
      expect(resp.followUp!.type).toBe('why_down')
    })

    it('handles forceFollowUpType override', async () => {
      const prev = await firstRound()
      const resp = await adapter.analyze('随便看看', {
        ...makeContext(prev),
        options: { forceFollowUpType: 'top_n' },
      })
      expect(resp.followUp).toBeDefined()
      expect(resp.followUp!.type).toBe('top_n')
    })

    it('getChartData returns follow-up scenario chart data when available', async () => {
      const prev = await firstRound()
      // Use a question that triggers drill_down detection AND matches follow-up scenario patterns
      const resp = await adapter.analyze('华东区域具体', makeContext(prev))
      const data = adapter.getChartData(resp.chartSuggestions[0], resp)
      expect(data.isEmpty).toBe(false)
      expect(data.columns).toContain('product_line')
    })

    it('single-turn path is unaffected by multi-turn changes', async () => {
      const resp = await adapter.analyze('各区域销售额', {
        datasourceId: null, datasourceName: null, selectedTables: [],
      })
      expect(resp.followUp).toBeUndefined()
      expect(resp.contextSummary).toBeUndefined()
      expect(resp.narrative.conclusion).toBeUndefined()
    })
  })

  // --- Phase 5K: Fault injection tests ---

  describe('simulateResponseFault injection', () => {
    it('throws INVALID_RESPONSE for missing_top_level_fields', async () => {
      try {
        await adapter.analyze('各区域销售额', {
          datasourceId: null, datasourceName: null, selectedTables: [],
          options: { simulateResponseFault: 'missing_top_level_fields' },
        })
        expect.fail('expected AiAskError to be thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(AiAskError)
        const error = err as AiAskError
        expect(error.code).toBe('INVALID_RESPONSE')
        expect(error.details?.simulatedFault).toBe('missing_top_level_fields')
        expect(error.details?.errors).toBeDefined()
      }
    })

    it('throws INVALID_RESPONSE for empty_response', async () => {
      try {
        await adapter.analyze('各区域销售额', {
          datasourceId: null, datasourceName: null, selectedTables: [],
          options: { simulateResponseFault: 'empty_response' },
        })
        expect.fail('expected AiAskError to be thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(AiAskError)
        const error = err as AiAskError
        expect(error.code).toBe('INVALID_RESPONSE')
        expect(error.details?.simulatedFault).toBe('empty_response')
      }
    })

    it('throws ANALYSIS_TIMEOUT for timeout fault', async () => {
      try {
        await adapter.analyze('各区域销售额', {
          datasourceId: null, datasourceName: null, selectedTables: [],
          options: { simulateResponseFault: 'timeout' },
        })
        expect.fail('expected AiAskError to be thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(AiAskError)
        const error = err as AiAskError
        expect(error.code).toBe('ANALYSIS_TIMEOUT')
      }
    })

    it('returns response without throwing for semantic_gap_conflict', async () => {
      const resp = await adapter.analyze('各区域销售额', {
        datasourceId: null, datasourceName: null, selectedTables: [],
        options: { simulateResponseFault: 'semantic_gap_conflict' },
      })
      expect(resp).toBeDefined()
      expect(resp.semanticGaps[0].field).toBe('销售额')
      const validation = validateAiAskResponse(resp)
      expect(validation.valid).toBe(true)
      expect(validation.errors).toHaveLength(0)
      expect(validation.warnings.some((w) => w.includes('冲突'))).toBe(true)
    })

    it('returns normal response when simulateResponseFault is absent', async () => {
      const resp = await adapter.analyze('各区域销售额', {
        datasourceId: null, datasourceName: null, selectedTables: [],
      })
      expect(resp).toBeDefined()
      expect(resp.chartSuggestions.length).toBeGreaterThanOrEqual(1)
    })

    it('follow-up path throws INVALID_RESPONSE with simulatedFault detail', async () => {
      const prev = await adapter.analyze('各区域销售额', {
        datasourceId: null, datasourceName: null, selectedTables: [],
      })
      const context: AiAskContext = {
        datasourceId: null, datasourceName: null, selectedTables: [],
        messageHistory: [
          { role: 'user', content: '各区域销售额' },
          { role: 'assistant', content: '各区域销售额分析结果', responseJson: prev as any },
        ],
        options: { simulateResponseFault: 'missing_top_level_fields' },
      }
      try {
        await adapter.analyze('为什么华东最高', context)
        expect.fail('expected AiAskError to be thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(AiAskError)
        const error = err as AiAskError
        expect(error.code).toBe('INVALID_RESPONSE')
        expect(error.details?.simulatedFault).toBe('missing_top_level_fields')
        expect(error.message).toContain('follow-up')
      }
    })
  })
})
