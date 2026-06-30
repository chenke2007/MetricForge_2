import React from 'react'
import { Select, Segmented, Space } from 'antd'
import type { ChartType } from '../utils/chartData'

interface ChartControlsProps {
  columns: string[]
  chartType: ChartType
  xColumn: string | null
  yColumn: string | null
  onChange: (config: { chartType?: ChartType; xColumn?: string | null; yColumn?: string | null }) => void
}

const ChartControls: React.FC<ChartControlsProps> = ({
  columns,
  chartType,
  xColumn,
  yColumn,
  onChange,
}) => {
  return (
    <Space size="middle" style={{ marginBottom: 16 }}>
      <Segmented
        value={chartType}
        onChange={(value) => onChange({ chartType: value as ChartType })}
        options={[
          { label: '柱状图', value: 'bar' },
          { label: '折线图', value: 'line' },
          { label: '饼图', value: 'pie' },
        ]}
      />
      <Select
        placeholder="选择 X 轴字段"
        value={xColumn}
        onChange={(value) => onChange({ xColumn: value })}
        options={columns.map((col) => ({ label: col, value: col }))}
        style={{ minWidth: 160 }}
      />
      <Select
        placeholder="选择 Y 轴字段"
        value={yColumn}
        onChange={(value) => onChange({ yColumn: value })}
        options={columns.map((col) => ({ label: col, value: col }))}
        style={{ minWidth: 160 }}
      />
    </Space>
  )
}

export default ChartControls
