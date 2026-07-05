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
}

/**
 * Rule-based chart recommendation engine.
 * Called inside MockAdapter.analyze() — NOT a standalone tool.
 * Uses question keywords + intent + data shape to determine chart types.
 */
export function recommendCharts(input: ChartRecommendationInput): AiChartSpec[] {
  const { columns, sampleRows, question, intent } = input
  const combinedText = [question, ...intent.metrics, ...intent.dimensions, ...intent.filters, intent.timeRange || ''].join(' ')

  const hasTime = /趋势|走势|月度|季度|月变化|环比|逐月|近.*月|近.*年|时间|日期|week|month|trend/i.test(combinedText)
  const hasComparison = /对比|比较|同比|环比|vs|versus|去年|去年同期|comparison/i.test(combinedText)
  const hasRank = /top|排名|前.*名|排行|最高|最多|前十|前五|top/i.test(combinedText)
  const hasDetail = /明细|详细|清单|list|detail|全部数据/i.test(combinedText)
  const metricCount = intent.metrics.length
  const numericColumns = columns.filter((_col, ci) => {
    const samples = sampleRows.map(r => r[ci])
    return samples.some(v => typeof v === 'number')
  })

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
