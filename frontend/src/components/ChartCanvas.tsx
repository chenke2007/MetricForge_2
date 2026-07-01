import React, { useEffect, useRef } from 'react'
import * as echartsCore from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsType } from 'echarts/core'
import { aggregateChartData, ChartType } from '../utils/chartData'

echartsCore.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
])

interface ChartCanvasProps {
  chartType: ChartType
  xColumn: string | null
  yColumn: string | null
  columns: string[]
  rows: any[][]
}

const ChartCanvas: React.FC<ChartCanvasProps> = ({
  chartType,
  xColumn,
  yColumn,
  columns,
  rows,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsType | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    chartRef.current = echartsCore.init(containerRef.current)

    return () => {
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!chartRef.current || !xColumn || !yColumn) return

    const aggregated = aggregateChartData({
      chartType,
      xColumn,
      yColumn,
      columns,
      rows,
    })

    if (aggregated.isEmpty || aggregated.error) {
      chartRef.current.clear()
      return
    }

    const option =
      chartType === 'pie'
        ? {
            tooltip: { trigger: 'item' },
            legend: { top: '5%' },
            series: [
              {
                type: 'pie',
                radius: '50%',
                data: aggregated.pieData,
              },
            ],
          }
        : {
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: aggregated.categories },
            yAxis: { type: 'value' },
            series: [
              {
                type: chartType,
                data: aggregated.values,
              },
            ],
          }

    chartRef.current.setOption(option, true)
  }, [chartType, xColumn, yColumn, columns, rows])

  return <div ref={containerRef} data-testid="chart-canvas" style={{ height: 400 }} />
}

export default ChartCanvas
