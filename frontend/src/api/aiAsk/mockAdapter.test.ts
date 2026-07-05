// frontend/src/api/aiAsk/mockAdapter.test.ts
import { describe, it, expect } from 'vitest'
import { MockAdapter } from './mockAdapter'

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
})
