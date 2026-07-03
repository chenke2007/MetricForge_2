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
import type { AiChartSpec } from '../types/aiAsk'
import { getTheme } from '../styles/chartThemes'
import { aggregateChartData } from '../utils/chartData'

echartsCore.use([
  BarChart, LineChart, PieChart,
  GridComponent, TooltipComponent, LegendComponent, TitleComponent,
  CanvasRenderer,
])

interface ChartCanvasProps {
  spec: AiChartSpec
  columns: string[]
  rows: any[][]
  width?: number
  height?: number
}

const ChartCanvas: React.FC<ChartCanvasProps> = ({
  spec,
  columns,
  rows,
  width,
  height = 300,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsType | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    chartRef.current = echartsCore.init(containerRef.current, undefined, { width, height })
    return () => {
      chartRef.current?.dispose()
      chartRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const theme = getTheme(spec.theme)

    if (spec.chartType === 'pie' && spec.xField) {
      const aggregated = aggregateChartData({
        chartType: 'pie',
        xColumn: spec.xField,
        yColumn: spec.yFields[0],
        columns,
        rows,
      })
      if (aggregated.isEmpty || !aggregated.pieData) {
        chart.clear()
        chart.setOption({
          title: { text: '暂无数据', left: 'center', top: 'center', textStyle: { color: '#999' } },
        })
        return
      }
      chart.setOption({
        color: theme.palette,
        tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: { bottom: 0, textStyle: { color: theme.textColor, fontFamily: theme.fontFamily } },
        series: [{
          type: 'pie',
          radius: ['35%', '60%'],
          center: ['50%', '45%'],
          avoidLabelOverlap: true,
          label: { show: true, formatter: '{b}: {d}%', fontFamily: theme.fontFamily },
          data: aggregated.pieData,
        }],
      })
      return
    }

    if (spec.chartType === 'bar' || spec.chartType === 'line') {
      const aggregated = aggregateChartData({
        chartType: spec.chartType === 'line' ? 'line' : 'bar',
        xColumn: spec.xField || columns[0],
        yColumn: spec.yFields[0],
        columns,
        rows,
      })
      if (aggregated.isEmpty || !aggregated.categories || !aggregated.values) {
        chart.clear()
        chart.setOption({
          title: { text: '暂无数据', left: 'center', top: 'center', textStyle: { color: '#999' } },
        })
        return
      }
      const categories = aggregated.categories
      chart.setOption({
        color: theme.palette,
        tooltip: { trigger: 'axis' },
        grid: { left: 60, right: 24, top: 16, bottom: 40 },
        xAxis: {
          type: 'category',
          data: categories,
          axisLabel: {
            color: theme.textColor,
            fontFamily: theme.fontFamily,
            rotate: categories.length > 6 ? 30 : 0,
          },
          axisLine: { lineStyle: { color: theme.axisColor } },
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: theme.textColor, fontFamily: theme.fontFamily },
          splitLine: { lineStyle: { color: theme.axisColor } },
        },
        series: [{
          type: spec.chartType,
          data: aggregated.values,
          itemStyle: {
            borderRadius: spec.chartType === 'bar' ? [4, 4, 0, 0] as any : undefined,
          },
          smooth: spec.chartType === 'line',
          showSymbol: spec.chartType === 'line',
          lineStyle: { width: 2.5 },
          areaStyle: spec.chartType === 'line' ? {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: theme.palette[0] + '40' },
                { offset: 1, color: theme.palette[0] + '05' },
              ],
            },
          } : undefined,
        }],
      })
      return
    }

    // fallback: unsupported chart type (e.g. metric-card, table, combo)
    chart.clear()
    chart.setOption({
      title: {
        text: `暂不支持 ${spec.chartType} 类型`,
        left: 'center',
        top: 'center',
        textStyle: { color: '#999' },
      },
    })
  }, [spec, columns, rows, width, height])

  return (
    <div
      ref={containerRef}
      data-testid="chart-canvas"
      style={{ width: width || '100%', height }}
    />
  )
}

export default ChartCanvas
