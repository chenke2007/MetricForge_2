import React from 'react'
import { Typography, Empty } from 'antd'
import { BarChartOutlined } from '@ant-design/icons'
import ChartCard from './ChartCard'
import type { AiChartSpec } from '../types/aiAsk'

const { Text } = Typography

interface AiChartBoardProps {
  chartSuggestions: AiChartSpec[]
  columns: string[]
  rows: any[][]
  activeIndex: number
  onActiveChange: (index: number) => void
}

const AiChartBoard: React.FC<AiChartBoardProps> = ({
  chartSuggestions,
  columns,
  rows,
  activeIndex,
  onActiveChange,
}) => {
  if (!chartSuggestions || chartSuggestions.length === 0) {
    return (
      <Empty
        description="暂无图表建议"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        style={{ margin: '12px 0' }}
      />
    )
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <BarChartOutlined style={{ color: '#4E7BF5', fontSize: 16 }} />
        <Text strong style={{ fontSize: 13 }}>
          AI 图表建议
        </Text>
        <Text style={{ fontSize: 11, color: '#999' }}>
          — 共 {chartSuggestions.length} 种视角，点击切换
        </Text>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          overflowX: 'auto',
          paddingBottom: 8,
        }}
      >
        {chartSuggestions.map((spec, index) => (
          <ChartCard
            key={`${spec.chartType}-${index}`}
            spec={spec}
            columns={columns}
            rows={rows}
            isActive={index === activeIndex}
            onSelect={() => onActiveChange(index)}
          />
        ))}
      </div>
    </div>
  )
}

export default AiChartBoard
