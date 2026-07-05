import React, { useEffect, useRef, useMemo } from 'react'
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
import { getTheme, getSeriesColor } from '../styles/chartThemes'
import { aggregateChartData, aggregateMultiYField } from '../utils/chartData'
import { formatMetricValue } from '../utils/numberFormat'

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
  const theme = useMemo(() => getTheme(spec.theme), [spec.theme])

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

    // --- NOP for non-chart types ---
    if (spec.chartType === 'metric-card' || spec.chartType === 'table') {
      chart.clear()
      return
    }

    // --- PIE ---
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
        tooltip: {
          trigger: 'item',
          formatter: (params: any) => {
            const idx = aggregated.pieData!.findIndex((d: any) => d.name === params.name)
            return `<b>${params.seriesName}</b><br/>${params.name}: ${formatMetricValue(params.value, 'compact')} (${params.percent}%)<br/><small>排名 ${idx + 1}/${aggregated.pieData!.length}</small>`
          },
        },
        legend: { bottom: 0, textStyle: { color: theme.textColor, fontFamily: theme.fontFamily } },
        series: [{
          type: 'pie',
          radius: ['35%', '60%'],
          center: ['50%', '45%'],
          avoidLabelOverlap: true,
          label: { show: true, formatter: '{b}: {d}%', fontFamily: theme.fontFamily },
          emphasis: { label: { show: true, fontSize: 13, fontWeight: 'bold' } },
          data: aggregated.pieData,
          animationDuration: 800,
          animationEasing: 'cubicOut' as any,
        }],
      })
      return
    }

    // --- COMBO (bar + line) ---
    if (spec.chartType === 'combo') {
      const multi = aggregateMultiYField({
        xColumn: spec.xField || columns[0],
        yFields: spec.yFields.length >= 2 ? spec.yFields.slice(0, 2) : [...spec.yFields, spec.yFields[0]],
        columns,
        rows,
      })
      if (multi.isEmpty) {
        chart.clear()
        chart.setOption({
          title: { text: '暂无数据', left: 'center', top: 'center', textStyle: { color: '#999' } },
        })
        return
      }

      const values0 = multi.series[0]?.values ?? []
      const values1 = multi.series[1]?.values ?? []
      const max0 = Math.max(...values0, 1)
      const max1 = Math.max(...values1, 1)
      const needDualAxis = max0 / max1 > 5 || max1 / max0 > 5

      const yAxis: any[] = [{
        type: 'value',
        axisLabel: { color: theme.textColor, fontFamily: theme.fontFamily },
        splitLine: { lineStyle: { color: theme.axisColor } },
      }]
      if (needDualAxis) {
        yAxis.push({
          type: 'value',
          axisLabel: { color: theme.textColor, fontFamily: theme.fontFamily },
          splitLine: { show: false },
        })
      }

      const series: any[] = []
      multi.series.forEach((s, i) => {
        if (i === 0) {
          series.push({
            name: s.name,
            type: 'bar',
            data: s.values,
            itemStyle: { color: theme.palette[0], borderRadius: [4, 4, 0, 0] as any },
            label: {
              show: true,
              position: 'top',
              fontFamily: theme.fontFamily,
              formatter: (p: any) => formatMetricValue(p.value, 'compact'),
            },
          })
        } else {
          series.push({
            name: s.name,
            type: 'line',
            yAxisIndex: needDualAxis ? 1 : 0,
            data: s.values,
            smooth: true,
            showSymbol: true,
            lineStyle: { width: 2.5, color: theme.palette[1] },
            itemStyle: { color: theme.palette[1] },
            label: {
              show: true,
              position: 'top',
              fontFamily: theme.fontFamily,
              formatter: (p: any) => formatMetricValue(p.value, 'compact'),
            },
            areaStyle: {
              color: {
                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: theme.palette[1] + '40' },
                  { offset: 1, color: theme.palette[1] + '05' },
                ],
              },
            },
          })
        }
      })

      chart.setOption({
        color: theme.palette,
        tooltip: {
          trigger: 'axis',
          formatter: (params: any[]) => {
            if (!params || !params.length) return ''
            let html = `<b>${params[0].axisValue}</b><br/>`
            params.forEach((p: any) => {
              html += `${p.marker} ${p.seriesName}: ${formatMetricValue(p.value, 'compact')}<br/>`
            })
            return html
          },
        },
        legend: { bottom: 0, textStyle: { color: theme.textColor, fontFamily: theme.fontFamily } },
        grid: { left: 60, right: needDualAxis ? 60 : 24, top: 16, bottom: 40 },
        xAxis: {
          type: 'category',
          data: multi.categories,
          axisLabel: {
            color: theme.textColor,
            fontFamily: theme.fontFamily,
            rotate: multi.categories.length > 6 ? 30 : 0,
          },
          axisLine: { lineStyle: { color: theme.axisColor } },
        },
        yAxis,
        series,
        animationDuration: 800,
        animationEasing: 'cubicOut' as any,
      })
      return
    }

    // --- BAR / LINE (with multi yField support) ---
    if (spec.chartType === 'bar' || spec.chartType === 'line') {
      const useMultiY = spec.yFields.length > 1

      if (useMultiY) {
        // Multi yField: grouped bar or multi line
        const multi = aggregateMultiYField({
          xColumn: spec.xField || columns[0],
          yFields: spec.yFields,
          columns,
          rows,
        })
        if (multi.isEmpty) {
          chart.clear()
          chart.setOption({
            title: { text: '暂无数据', left: 'center', top: 'center', textStyle: { color: '#999' } },
          })
          return
        }

        const series = multi.series.map((s, i) => {
          const color = getSeriesColor(i, theme.palette)
          const isBarType = spec.chartType === 'bar'
          return {
            name: s.name,
            type: spec.chartType,
            data: s.values,
            smooth: !isBarType,
            showSymbol: !isBarType,
            lineStyle: { width: 2.5, color, type: i === 1 ? ('dashed' as any) : ('solid' as any) },
            itemStyle: {
              color,
              borderRadius: isBarType ? ([4, 4, 0, 0] as any) : undefined,
            },
            label: {
              show: true,
              position: 'top' as any,
              fontFamily: theme.fontFamily,
              formatter: (p: any) => formatMetricValue(p.value, 'compact'),
            },
            areaStyle: !isBarType
              ? {
                  color: {
                    type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                      { offset: 0, color: color + '40' },
                      { offset: 1, color: color + '05' },
                    ],
                  },
                }
              : undefined,
          }
        })

        chart.setOption({
          color: theme.palette,
          tooltip: {
            trigger: 'axis',
            formatter: (params: any[]) => {
              if (!params || !params.length) return ''
              let html = `<b>${params[0].axisValue}</b><br/>`
              params.forEach((p: any) => {
                html += `${p.marker} ${p.seriesName}: ${formatMetricValue(p.value, 'compact')}<br/>`
              })
              return html
            },
          },
          legend: { bottom: 0, textStyle: { color: theme.textColor, fontFamily: theme.fontFamily } },
          grid: { left: 60, right: 24, top: 16, bottom: 40 },
          xAxis: {
            type: 'category',
            data: multi.categories,
            axisLabel: {
              color: theme.textColor,
              fontFamily: theme.fontFamily,
              rotate: multi.categories.length > 6 ? 30 : 0,
            },
            axisLine: { lineStyle: { color: theme.axisColor } },
          },
          yAxis: {
            type: 'value',
            axisLabel: { color: theme.textColor, fontFamily: theme.fontFamily },
            splitLine: { lineStyle: { color: theme.axisColor } },
          },
          series,
          animationDuration: 800,
          animationEasing: 'cubicOut' as any,
        })
        return
      }

      // Single yField (original behavior with enhanced labels + tooltip)
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
        tooltip: {
          trigger: 'axis',
          formatter: (params: any[]) => {
            if (!params || !params.length) return ''
            return `<b>${params[0].axisValue}</b><br/>${params.map((p: any) =>
              `${p.marker} ${p.seriesName}: ${formatMetricValue(p.value, 'compact')}`
            ).join('<br/>')}`
          },
        },
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
            borderRadius: spec.chartType === 'bar' ? ([4, 4, 0, 0] as any) : undefined,
          },
          smooth: spec.chartType === 'line',
          showSymbol: spec.chartType === 'line',
          lineStyle: { width: 2.5 },
          label: {
            show: true,
            position: spec.chartType === 'bar' ? 'top' : ('top' as any),
            fontFamily: theme.fontFamily,
            formatter: (p: any) => formatMetricValue(p.value, 'compact'),
          },
          areaStyle: spec.chartType === 'line'
            ? {
                color: {
                  type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                  colorStops: [
                    { offset: 0, color: theme.palette[0] + '40' },
                    { offset: 1, color: theme.palette[0] + '05' },
                  ],
                },
              }
            : undefined,
          animationDuration: 800,
          animationEasing: 'cubicOut' as any,
        }],
      })
      return
    }

    // Unsupported type fallback
    chart.clear()
    chart.setOption({
      title: {
        text: `暂不支持 ${spec.chartType} 类型`,
        left: 'center',
        top: 'center',
        textStyle: { color: '#999' },
      },
    })
  }, [spec, columns, rows, width, height, theme])

  return (
    <div
      ref={containerRef}
      data-testid="chart-canvas"
      style={{ width: width || '100%', height }}
    />
  )
}

export default ChartCanvas
