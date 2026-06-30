import React from 'react'
import { Empty, Alert } from 'antd'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'
import ChartControls from './ChartControls'
import ChartCanvas from './ChartCanvas'
import { aggregateChartData } from '../utils/chartData'

const ChartPreview: React.FC = () => {
  const result = useSqlWorkbenchStore((s) => s.result)
  const chartConfig = useSqlWorkbenchStore((s: any) => s.chartConfig)
  const setChartConfig = useSqlWorkbenchStore((s: any) => s.setChartConfig)

  if (!result || result.columns.length === 0 || result.row_count === 0) {
    return <Empty description="查询结果为空，无法生成图表" />
  }

  const hasSelection = chartConfig.xColumn && chartConfig.yColumn
  let errorMessage: string | null = null

  if (hasSelection) {
    const aggregated = aggregateChartData({
      chartType: chartConfig.chartType,
      xColumn: chartConfig.xColumn,
      yColumn: chartConfig.yColumn,
      columns: result.columns,
      rows: result.rows,
    })
    if (aggregated.error === 'y_not_numeric') {
      errorMessage = '所选 Y 字段不是数值类型，无法生成图表'
    }
  }

  return (
    <div>
      <ChartControls
        columns={result.columns}
        chartType={chartConfig.chartType}
        xColumn={chartConfig.xColumn}
        yColumn={chartConfig.yColumn}
        onChange={(patch) => setChartConfig({ ...chartConfig, ...patch })}
      />
      {errorMessage && <Alert type="warning" message={errorMessage} showIcon style={{ marginBottom: 16 }} />}
      {!hasSelection && <Empty description="请选择 X 轴字段和 Y 轴字段" />}
      {hasSelection && !errorMessage && (
        <ChartCanvas
          chartType={chartConfig.chartType}
          xColumn={chartConfig.xColumn}
          yColumn={chartConfig.yColumn}
          columns={result.columns}
          rows={result.rows}
        />
      )}
    </div>
  )
}

export default ChartPreview
