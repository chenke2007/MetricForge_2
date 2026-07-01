import React, { useMemo, useState } from 'react'
import { Empty, Alert, Button, Space } from 'antd'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'
import ChartControls from './ChartControls'
import ChartCanvas from './ChartCanvas'
import ChartDraftSaveModal from './ChartDraftSaveModal'
import { aggregateChartData } from '../utils/chartData'

const TRUNCATION_MESSAGE = '数据点过多，仅显示前 100 个分组'

const ChartPreview: React.FC = () => {
  const result = useSqlWorkbenchStore((s) => s.result)
  const sql = useSqlWorkbenchStore((s) => s.sql)
  const datasourceId = useSqlWorkbenchStore((s) => s.datasourceId)
  const chartConfig = useSqlWorkbenchStore((s) => s.chartConfig)
  const setChartConfig = useSqlWorkbenchStore((s) => s.setChartConfig)
  const [saveModalOpen, setSaveModalOpen] = useState(false)

  if (!result || result.columns.length === 0 || result.rows.length === 0) {
    return <Empty description="查询结果为空，无法生成图表" />
  }

  const hasSelection = chartConfig.xColumn && chartConfig.yColumn

  const aggregated = useMemo(() => {
    if (!hasSelection) return null
    return aggregateChartData({
      chartType: chartConfig.chartType,
      xColumn: chartConfig.xColumn!,
      yColumn: chartConfig.yColumn!,
      columns: result.columns,
      rows: result.rows,
    })
  }, [chartConfig.chartType, chartConfig.xColumn, chartConfig.yColumn, result.columns, result.rows])

  const errorMessage = aggregated?.error === 'y_not_numeric'
    ? '所选 Y 字段不是数值类型，无法生成图表'
    : null

  return (
    <div>
      <Space size="middle" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <ChartControls
          columns={result.columns}
          chartType={chartConfig.chartType}
          xColumn={chartConfig.xColumn}
          yColumn={chartConfig.yColumn}
          onChange={(patch) => setChartConfig({ ...chartConfig, ...patch })}
        />
        <Button type="primary" onClick={() => setSaveModalOpen(true)}>保存图表</Button>
      </Space>
      {aggregated?.isTruncated && (
        <Alert type="warning" message={TRUNCATION_MESSAGE} showIcon style={{ marginBottom: 16 }} />
      )}
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
      <ChartDraftSaveModal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        sql={sql}
        datasourceId={datasourceId}
        chartConfig={chartConfig}
      />
    </div>
  )
}

export default ChartPreview
