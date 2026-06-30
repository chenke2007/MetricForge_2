export const MAX_CHART_GROUPS = 100

export type ChartType = 'bar' | 'line' | 'pie'

export interface ChartDataInput {
  chartType: ChartType
  xColumn: string
  yColumn: string
  columns: string[]
  rows: any[][]
}

export interface AggregatedResult {
  categories?: string[]
  values?: number[]
  pieData?: { name: string; value: number }[]
  isEmpty: boolean
  isTruncated?: boolean
  error?: 'y_not_numeric' | 'x_not_found' | 'y_not_found'
}

export function isNumericColumn(sampleValues: any[]): boolean {
  const firstValid = sampleValues.find((v) => v !== null && v !== undefined && v !== '')
  if (firstValid === undefined) return false
  const str = String(firstValid)
  return str !== '' && !isNaN(Number(str))
}

function parseNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = Number(String(value))
  return isNaN(num) ? null : num
}

export function aggregateChartData(input: ChartDataInput): AggregatedResult {
  const { chartType, xColumn, yColumn, columns, rows } = input
  const xIndex = columns.indexOf(xColumn)
  const yIndex = columns.indexOf(yColumn)

  if (xIndex === -1) return { isEmpty: true, error: 'x_not_found' }
  if (yIndex === -1) return { isEmpty: true, error: 'y_not_found' }
  if (rows.length === 0) return { isEmpty: true }

  const ySamples = rows.map((row) => row[yIndex])
  if (!isNumericColumn(ySamples)) {
    return { isEmpty: true, error: 'y_not_numeric' }
  }

  const groups = new Map<string, number>()
  const seenX = new Set<string>()
  for (const row of rows) {
    const xValue = row[xIndex] == null ? '' : String(row[xIndex])
    const yValue = parseNumber(row[yIndex])
    seenX.add(xValue)
    if (yValue === null) continue
    groups.set(xValue, (groups.get(xValue) || 0) + yValue)
  }

  // Ensure all seen X values are in groups (even with 0 if no valid Y)
  for (const xValue of seenX) {
    if (!groups.has(xValue)) {
      groups.set(xValue, 0)
    }
  }

  const sortedEntries = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  const isTruncated = sortedEntries.length > MAX_CHART_GROUPS
  const limitedEntries = sortedEntries.slice(0, MAX_CHART_GROUPS)

  if (chartType === 'pie') {
    const otherSum = sortedEntries
      .slice(MAX_CHART_GROUPS)
      .reduce((sum, [, value]) => sum + value, 0)
    const pieData = limitedEntries.map(([name, value]) => ({ name, value }))
    if (otherSum > 0) {
      pieData.push({ name: '其他', value: otherSum })
    }
    return { pieData, isEmpty: false, isTruncated }
  }

  // bar / line
  const categories = limitedEntries.map(([name]) => name)
  const values = limitedEntries.map(([, value]) => value)

  return { categories, values, isEmpty: false, isTruncated }
}
