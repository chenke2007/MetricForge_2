import { describe, it, expect } from 'vitest'
import { matchChartFields, filterMatchingCharts, resolveCanonicalField, canonicalizeSpec } from './chartFieldMatch'
import type { AiChartSpec } from '../../types/aiAsk'

describe('matchChartFields', () => {
  it('returns match=true when xField and yFields all exist', () => {
    const result = matchChartFields(
      { xField: 'region', yFields: ['revenue'] },
      ['region', 'revenue'],
    )
    expect(result.match).toBe(true)
    expect(result.missingFields).toEqual([])
  })

  it('returns match=true when xField is undefined (charts without x-axis)', () => {
    const result = matchChartFields(
      { yFields: ['revenue'] },
      ['region', 'revenue'],
    )
    expect(result.match).toBe(true)
    expect(result.missingFields).toEqual([])
  })

  it('handles case-insensitive matching', () => {
    const result = matchChartFields(
      { xField: 'Region', yFields: ['TOTAL_REVENUE'] },
      ['region', 'total_revenue'],
    )
    expect(result.match).toBe(true)
  })

  it('returns match=false with missing xField', () => {
    const result = matchChartFields(
      { xField: 'nonexistent', yFields: ['revenue'] },
      ['region', 'revenue'],
    )
    expect(result.match).toBe(false)
    expect(result.missingFields).toContain('nonexistent')
  })

  it('returns match=false with missing yField', () => {
    const result = matchChartFields(
      { xField: 'region', yFields: ['missing_col'] },
      ['region', 'revenue'],
    )
    expect(result.match).toBe(false)
    expect(result.missingFields).toContain('missing_col')
  })

  it('reports all missing fields', () => {
    const result = matchChartFields(
      { xField: 'a', yFields: ['b', 'c'] },
      ['region', 'revenue'],
    )
    expect(result.match).toBe(false)
    expect(result.missingFields).toEqual(['a', 'b', 'c'])
  })
})

describe('filterMatchingCharts', () => {
  const charts: AiChartSpec[] = [
    { title: 'A', chartType: 'bar', xField: 'region', yFields: ['sales'], rationale: '', limitations: [] },
    { title: 'B', chartType: 'line', xField: 'region', yFields: ['missing_col'], rationale: '', limitations: [] },
    { title: 'C', chartType: 'pie', yFields: ['sales'], rationale: '', limitations: [] },
  ]

  it('filters out charts with missing fields', () => {
    const result = filterMatchingCharts(charts, ['region', 'sales'])
    expect(result).toHaveLength(2)
    expect(result[0].title).toBe('A')
    expect(result[1].title).toBe('C')
  })

  it('returns empty when no charts match', () => {
    const result = filterMatchingCharts(charts, ['a', 'b'])
    expect(result).toHaveLength(0)
  })

  it('matches case-insensitively when filtering', () => {
    const result = filterMatchingCharts(charts, ['REGION', 'SALES'])
    expect(result).toHaveLength(2)
  })
})

// ── Phase 5N Task 6.5D follow-up: canonical field resolver ──────────────

describe('resolveCanonicalField', () => {
  it('returns the actual column name matching case-insensitively', () => {
    const result = resolveCanonicalField('region', ['REGION', 'TOTAL_AMOUNT'])
    expect(result).toBe('REGION')
  })

  it('returns the actual column name for yField case mismatch', () => {
    const result = resolveCanonicalField('total_amount', ['REGION', 'TOTAL_AMOUNT'])
    expect(result).toBe('TOTAL_AMOUNT')
  })

  it('returns the column as-is when exact match exists', () => {
    const result = resolveCanonicalField('REGION', ['REGION', 'TOTAL_AMOUNT'])
    expect(result).toBe('REGION')
  })

  it('returns undefined when no column matches', () => {
    const result = resolveCanonicalField('nonexistent', ['REGION', 'TOTAL_AMOUNT'])
    expect(result).toBeUndefined()
  })
})

describe('canonicalizeSpec', () => {
  it('maps xField, yFields, and sort.field to canonical column names', () => {
    const spec: AiChartSpec = {
      title: 'Test',
      chartType: 'bar',
      xField: 'region',
      yFields: ['total_amount'],
      sort: { field: 'total_amount', direction: 'desc' },
      rationale: '',
      limitations: [],
    }
    const result = canonicalizeSpec(spec, ['REGION', 'TOTAL_AMOUNT'])
    expect(result.xField).toBe('REGION')
    expect(result.yFields).toEqual(['TOTAL_AMOUNT'])
    expect(result.sort?.field).toBe('TOTAL_AMOUNT')
  })

  it('preserves other spec fields unchanged', () => {
    const spec: AiChartSpec = {
      title: 'My Chart',
      chartType: 'bar',
      xField: 'region',
      yFields: ['total_amount'],
      aggregation: 'sum',
      rationale: 'rationale text',
      limitations: ['limit1'],
    }
    const result = canonicalizeSpec(spec, ['REGION', 'TOTAL_AMOUNT'])
    expect(result.title).toBe('My Chart')
    expect(result.chartType).toBe('bar')
    expect(result.aggregation).toBe('sum')
    expect(result.rationale).toBe('rationale text')
    expect(result.limitations).toEqual(['limit1'])
  })

  it('leaves unmatched field names as-is (filter handles exclusion)', () => {
    const spec: AiChartSpec = {
      title: 'Test',
      chartType: 'bar',
      xField: 'nonexistent',
      yFields: ['total_amount'],
      rationale: '',
      limitations: [],
    }
    const result = canonicalizeSpec(spec, ['REGION', 'TOTAL_AMOUNT'])
    expect(result.xField).toBe('nonexistent')
    expect(result.yFields).toEqual(['TOTAL_AMOUNT'])
  })

  it('handles spec without sort field', () => {
    const spec: AiChartSpec = {
      title: 'Test',
      chartType: 'bar',
      xField: 'region',
      yFields: ['total_amount'],
      rationale: '',
      limitations: [],
    }
    const result = canonicalizeSpec(spec, ['REGION', 'TOTAL_AMOUNT'])
    expect(result.sort).toBeUndefined()
    expect(result.xField).toBe('REGION')
  })

  it('handles spec without xField (e.g. pie without x-axis)', () => {
    const spec: AiChartSpec = {
      title: 'Test',
      chartType: 'pie',
      yFields: ['total_amount'],
      rationale: '',
      limitations: [],
    }
    const result = canonicalizeSpec(spec, ['REGION', 'TOTAL_AMOUNT'])
    expect(result.xField).toBeUndefined()
    expect(result.yFields).toEqual(['TOTAL_AMOUNT'])
  })

  it('returns a new object, does not mutate the original', () => {
    const spec: AiChartSpec = {
      title: 'Test',
      chartType: 'bar',
      xField: 'region',
      yFields: ['total_amount'],
      rationale: '',
      limitations: [],
    }
    const result = canonicalizeSpec(spec, ['REGION', 'TOTAL_AMOUNT'])
    expect(result).not.toBe(spec)
    expect(spec.xField).toBe('region')
    expect(spec.yFields).toEqual(['total_amount'])
  })
})
