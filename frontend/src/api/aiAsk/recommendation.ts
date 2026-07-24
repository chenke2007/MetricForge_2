// frontend/src/api/aiAsk/recommendation.ts
import type { AiChartSpec } from '../../types/aiAsk'

export interface ChartRecommendationInput {
  columns: string[]
  sampleRows: any[][]
  question: string
  intent: {
    metrics: string[]
    dimensions: string[]
    filters: string[]
    timeRange?: string
  }
  /** Phase 5N Task 6.5D: 后端列类型标签；存在且与 columns 等长时优先于运行时推断 */
  columnTypes?: string[]
}

// ── Phase 5N Task 6.5D: columnTypes 类型判断与 Decimal 安全保护 ────────

/** 可作为数值轴（yField）参与绘图的列类型 */
export const NUMERIC_COLUMN_TYPES: readonly string[] = ['int', 'float', 'decimal']

/** 明确不可图表化的列类型（类型未知/混合/非数值语义） */
export const NON_CHARTABLE_COLUMN_TYPES: readonly string[] = [
  'mixed', 'unknown', 'bytes', 'bool', 'null',
]

export function isNumericColumnType(columnType: string | undefined): boolean {
  return columnType !== undefined && NUMERIC_COLUMN_TYPES.includes(columnType)
}

/**
 * JS Number 安全精度：最多 15 位有效数字可保证无精度损失。
 * 后端将 Decimal 序列化为精确字符串，超过安全精度直接 Number() 会静默丢精度。
 */
const MAX_SAFE_SIGNIFICANT_DIGITS = 15

/** 判断值是否为超出 JS Number 安全精度的 Decimal 字符串（fail closed） */
export function isUnsafeDecimalString(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const s = value.trim()
  const m = /^[+-]?(\d+)(\.\d+)?([eE][+-]?\d+)?$/.exec(s)
  if (!m) return false
  if (!Number.isFinite(Number(s))) return true
  const significantDigits = (m[1] + (m[2] ? m[2].slice(1) : '')).replace(/^0+/, '')
  return significantDigits.length > MAX_SAFE_SIGNIFICANT_DIGITS
}

/** 检查指定列在行数据中是否存在超出安全精度的 Decimal 值 */
export function hasUnsafeDecimalValues(rows: any[][], columnIndex: number): boolean {
  return rows.some((row) => isUnsafeDecimalString(row[columnIndex]))
}

/**
 * Rule-based chart recommendation engine.
 * Called inside MockAdapter.analyze() — NOT a standalone tool.
 * Uses question keywords + intent + data shape to determine chart types.
 */
export function recommendCharts(input: ChartRecommendationInput): AiChartSpec[] {
  const { columns, sampleRows, question, intent, columnTypes } = input
  const combinedText = [question, ...intent.metrics, ...intent.dimensions, ...intent.filters, intent.timeRange || ''].join(' ')

  const hasTime = /趋势|走势|月度|季度|月变化|环比|逐月|近.*月|近.*年|时间|日期|week|month|trend/i.test(combinedText)
  const hasComparison = /对比|比较|同比|环比|vs|versus|去年|去年同期|comparison/i.test(combinedText)
  const hasRank = /top|排名|前.*名|排行|最高|最多|前十|前五|top/i.test(combinedText)
  const hasDetail = /明细|详细|清单|list|detail|全部数据/i.test(combinedText)
  const metricCount = intent.metrics.length
  // Phase 5N Task 6.5D: columnTypes 存在且等长时以其为准（decimal 视为数值），
  // 否则回退到原有的运行时推断
  const hasColumnTypes = Array.isArray(columnTypes) && columnTypes.length === columns.length
  const numericColumns = columns.filter((_col, ci) => {
    if (hasColumnTypes) return isNumericColumnType(columnTypes[ci])
    const samples = sampleRows.map(r => r[ci])
    return samples.some(v => typeof v === 'number')
  })

  // Phase 5N Task 6.5D: columnTypes 明确且没有任何数值列（mixed/unknown 等），
  // 不产出可能误导的图表，直接降级为表格
  if (hasColumnTypes && numericColumns.length === 0) {
    return [{
      title: '数据明细', chartType: 'table',
      yFields: columns,
      rationale: '字段类型为 mixed/unknown 等非数值类型，不适合图表展示，已降级为表格',
      limitations: ['字段类型不适合图表展示'],
    }]
  }

  const charts: AiChartSpec[] = []

  // Rule 1: comparison → combo
  if (hasComparison && metricCount >= 1) {
    charts.push({
      title: '对比分析', chartType: 'combo',
      xField: intent.dimensions[0] || columns[0],
      yFields: numericColumns.slice(0, 2),
      rationale: '组合图同时展示绝对值与变化趋势，直观呈现对比关系',
      limitations: ['仅展示两系列数据'],
    })
  }

  // Rule 2: time dimension → line
  if (hasTime && metricCount >= 1) {
    charts.push({
      title: intent.metrics.length > 1 ? '多指标趋势' : '趋势分析',
      subtitle: intent.timeRange, chartType: 'line',
      xField: intent.dimensions.find(d => /时间|日期|月|年|day|month/i.test(d)) || intent.dimensions[0] || columns[0],
      yFields: numericColumns.slice(0, 3),
      rationale: '折线图清晰展示随时间的变化趋势',
      limitations: ['趋势基于样本数据'],
    })
  }

  // Rule 3: rank intent → bar (sorted)
  if (hasRank && metricCount >= 1) {
    charts.push({
      title: intent.metrics[0] + '排行', chartType: 'bar',
      xField: intent.dimensions[0] || columns[0],
      yFields: [numericColumns[0] || intent.metrics[0]],
      sort: { field: numericColumns[0] || intent.metrics[0], direction: 'desc' },
      rationale: '柱状图直观展示排名分布',
      limitations: ['数据按单指标降序排列'],
    })
  }

  // Rule 4: single dimension + single metric → bar + pie
  if (intent.dimensions.length <= 1 && metricCount >= 1 && !hasTime) {
    if (!charts.some(c => c.chartType === 'bar')) {
      charts.push({
        title: intent.metrics[0] + '分布', chartType: 'bar',
        xField: intent.dimensions[0] || columns[0],
        yFields: [numericColumns[0] || intent.metrics[0]],
        rationale: '柱状图对比各维度的数值差异',
        limitations: ['不含趋势信息'],
      })
    }
    charts.push({
      title: intent.metrics[0] + '占比', chartType: 'pie',
      xField: intent.dimensions[0] || columns[0],
      yFields: [numericColumns[0] || intent.metrics[0]],
      rationale: '饼图展示占比结构',
      limitations: ['不超过 6 个扇区'],
    })
  }

  // Rule 5: multiple metrics → grouped bar
  if (metricCount >= 2 && !charts.some(c => c.chartType === 'combo')) {
    charts.push({
      title: '多指标对比', chartType: 'bar',
      xField: intent.dimensions[0] || columns[0],
      yFields: numericColumns.slice(0, Math.min(metricCount, 4)),
      rationale: '分组柱状图对比多个指标',
      limitations: ['各指标量级差异大时建议分开查看'],
    })
  }

  // Rule 6: detail request → table
  if (hasDetail) {
    charts.push({
      title: '数据明细', chartType: 'table',
      yFields: columns,
      rationale: '表格展示完整数据明细',
      limitations: ['大数据量时仅展示前 100 行'],
    })
  }

  // Ensure at least 1 chart
  if (charts.length === 0) {
    charts.push({
      title: '数据概览', chartType: 'bar',
      xField: columns[0], yFields: numericColumns.slice(0, 1),
      rationale: '柱状图展示数据分布',
      limitations: [],
    })
  }

  return charts.slice(0, 4)
}
