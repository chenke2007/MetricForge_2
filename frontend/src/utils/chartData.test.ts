import { describe, it, expect } from 'vitest'
import { aggregateChartData, isNumericColumn, MAX_CHART_GROUPS } from './chartData'

describe('isNumericColumn', () => {
  it('returns true for numeric values', () => {
    expect(isNumericColumn(['1', '2', '3'])).toBe(true)
  })

  it('returns false for non-numeric values', () => {
    expect(isNumericColumn(['a', 'b', 'c'])).toBe(false)
  })

  it('returns false when all values are NULL', () => {
    expect(isNumericColumn([null, null, null])).toBe(false)
  })
})

describe('aggregateChartData', () => {
  it('aggregates bar data by summing Y values per X group', () => {
    const result = aggregateChartData({
      chartType: 'bar',
      xColumn: 'category',
      yColumn: 'amount',
      columns: ['category', 'amount'],
      rows: [
        ['A', '100'],
        ['B', '200'],
        ['A', '50'],
      ],
    })
    expect(result.categories).toEqual(['A', 'B'])
    expect(result.values).toEqual([150, 200])
  })

  it('aggregates pie data into name/value pairs', () => {
    const result = aggregateChartData({
      chartType: 'pie',
      xColumn: 'category',
      yColumn: 'amount',
      columns: ['category', 'amount'],
      rows: [
        ['A', '100'],
        ['B', '200'],
        ['A', '50'],
      ],
    })
    expect(result.pieData).toEqual([
      { name: 'A', value: 150 },
      { name: 'B', value: 200 },
    ])
  })

  it('skips NULL Y values in aggregation', () => {
    const result = aggregateChartData({
      chartType: 'bar',
      xColumn: 'category',
      yColumn: 'amount',
      columns: ['category', 'amount'],
      rows: [
        ['A', '100'],
        ['A', null],
        ['B', null],
      ],
    })
    expect(result.values).toEqual([100, 0])
  })

  it('returns empty when rows is empty', () => {
    const result = aggregateChartData({
      chartType: 'bar',
      xColumn: 'category',
      yColumn: 'amount',
      columns: ['category', 'amount'],
      rows: [],
    })
    expect(result.isEmpty).toBe(true)
  })

  it('returns error when Y column is not numeric', () => {
    const result = aggregateChartData({
      chartType: 'bar',
      xColumn: 'category',
      yColumn: 'name',
      columns: ['category', 'name'],
      rows: [
        ['A', 'Alice'],
        ['B', 'Bob'],
      ],
    })
    expect(result.error).toBe('y_not_numeric')
  })

  it('limits bar categories to MAX_CHART_GROUPS', () => {
    const rows = Array.from({ length: MAX_CHART_GROUPS + 10 }, (_, i) => [`item-${i}`, '1'])
    const result = aggregateChartData({
      chartType: 'bar',
      xColumn: 'category',
      yColumn: 'amount',
      columns: ['category', 'amount'],
      rows,
    })
    expect(result.categories?.length).toBe(MAX_CHART_GROUPS)
    expect(result.isTruncated).toBe(true)
  })
})
