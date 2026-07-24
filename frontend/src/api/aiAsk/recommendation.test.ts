// frontend/src/api/aiAsk/recommendation.test.ts
import { describe, it, expect } from 'vitest'
import { recommendCharts } from './recommendation'

describe('recommendCharts', () => {
  const baseColumns = ['region', 'month', 'revenue', 'count', 'rate']
  const sampleRows = [
    ['华东', '2026-06', 100000, 500, 0.32],
    ['华南', '2026-06', 80000, 400, 0.28],
  ]

  it('recommends line for time-related question', () => {
    const result = recommendCharts({
      columns: baseColumns, sampleRows,
      question: '近 6 个月收入趋势',
      intent: { metrics: ['revenue'], dimensions: ['month'], filters: [], timeRange: '近 6 月' },
    })
    expect(result.some(c => c.chartType === 'line')).toBe(true)
  })

  it('recommends bar + pie for single dimension+metric', () => {
    const result = recommendCharts({
      columns: baseColumns, sampleRows,
      question: '各区域销售额',
      intent: { metrics: ['revenue'], dimensions: ['region'], filters: [] },
    })
    expect(result.some(c => c.chartType === 'bar')).toBe(true)
    expect(result.some(c => c.chartType === 'pie')).toBe(true)
  })

  it('recommends combo for comparison question', () => {
    const result = recommendCharts({
      columns: baseColumns, sampleRows,
      question: '今年和去年同期对比',
      intent: { metrics: ['revenue'], dimensions: ['region'], filters: ['同比对比'] },
    })
    expect(result.some(c => c.chartType === 'combo')).toBe(true)
  })

  it('recommends bar for top-n question', () => {
    const result = recommendCharts({
      columns: baseColumns, sampleRows,
      question: '本月 Top 10 客户',
      intent: { metrics: ['revenue'], dimensions: ['region'], filters: ['Top 10'] },
    })
    expect(result.some(c => c.chartType === 'bar')).toBe(true)
  })

  it('recommends table for detail request', () => {
    const result = recommendCharts({
      columns: baseColumns, sampleRows,
      question: '查看明细数据',
      intent: { metrics: ['revenue'], dimensions: ['region'], filters: ['明细'] },
    })
    expect(result.some(c => c.chartType === 'table')).toBe(true)
  })

  it('returns at most 4 charts', () => {
    const result = recommendCharts({
      columns: baseColumns, sampleRows,
      question: '今年同比对比 Top 10 明细',
      intent: { metrics: ['revenue', 'count'], dimensions: ['region', 'month'], filters: ['同比对比', 'Top 10', '明细'], timeRange: '同比' },
    })
    expect(result.length).toBeLessThanOrEqual(4)
  })

  it('always returns at least 1 chart', () => {
    const result = recommendCharts({
      columns: ['x'], sampleRows: [['a']],
      question: '随便看看',
      intent: { metrics: [], dimensions: [], filters: [] },
    })
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  // ── Phase 5N Task 6.5D: columnTypes-aware recommendation ──

  it('treats decimal columnType as numeric even when values are strings', () => {
    // 后端将 Decimal 序列化为精确字符串，运行时推断会漏掉它
    const result = recommendCharts({
      columns: ['region', 'amount'],
      sampleRows: [['华东', '123.45'], ['华南', '678.90']],
      columnTypes: ['string', 'decimal'],
      question: '各区域金额',
      intent: { metrics: ['amount'], dimensions: ['region'], filters: [] },
    })
    expect(result.some(c => c.chartType === 'bar' && c.yFields.includes('amount'))).toBe(true)
  })

  it('degrades to table when all value columns are mixed/unknown', () => {
    const result = recommendCharts({
      columns: ['region', 'amount'],
      sampleRows: [['华东', 'N/A']],
      columnTypes: ['string', 'mixed'],
      question: '各区域金额',
      intent: { metrics: ['amount'], dimensions: ['region'], filters: [] },
    })
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.every(c => c.chartType === 'table')).toBe(true)
  })

  it('degrades to table when value column type is unknown', () => {
    const result = recommendCharts({
      columns: ['region', 'amount'],
      sampleRows: [['华东', null]],
      columnTypes: ['string', 'unknown'],
      question: '各区域金额',
      intent: { metrics: ['amount'], dimensions: ['region'], filters: [] },
    })
    expect(result.every(c => c.chartType === 'table')).toBe(true)
  })

  it('falls back to runtime inference when columnTypes is absent', () => {
    const result = recommendCharts({
      columns: ['region', 'revenue'],
      sampleRows: [['华东', 100000]],
      question: '各区域销售额',
      intent: { metrics: ['revenue'], dimensions: ['region'], filters: [] },
    })
    expect(result.some(c => c.chartType === 'bar' && c.yFields.includes('revenue'))).toBe(true)
  })

  it('falls back to runtime inference when columnTypes length mismatches', () => {
    const result = recommendCharts({
      columns: ['region', 'revenue'],
      sampleRows: [['华东', 100000]],
      columnTypes: ['string'],
      question: '各区域销售额',
      intent: { metrics: ['revenue'], dimensions: ['region'], filters: [] },
    })
    expect(result.some(c => c.chartType === 'bar' && c.yFields.includes('revenue'))).toBe(true)
  })
})
