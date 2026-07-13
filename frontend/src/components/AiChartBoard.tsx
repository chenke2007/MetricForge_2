import React from 'react'
import { Typography, Empty } from 'antd'
import { BarChartOutlined } from '@ant-design/icons'
import ChartCard from './ChartCard'
import type { AiChartSpec } from '../types/aiAsk'
import type { NarrativeLevel } from '../types/aiAsk'

const { Text } = Typography

interface AiChartBoardProps {
  chartSuggestions: AiChartSpec[]
  columns: string[]
  rows: any[][]
  activeIndex: number
  onActiveChange: (index: number) => void
  /** Phase 5M: when sql_pending, show placeholder instead of factual charts */
  narrativeLevel?: NarrativeLevel
}

const AiChartBoard: React.FC<AiChartBoardProps> = ({
  chartSuggestions,
  columns,
  rows,
  activeIndex,
  onActiveChange,
  narrativeLevel,
}) => {
  // Phase 5M: sql_pending — show placeholder, not factual charts
  if (narrativeLevel === 'sql_pending') {
    return (
      <div style={{ marginTop: 12, background: '#fafafa', borderRadius: 12, padding: '16px 16px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <BarChartOutlined style={{ color: '#4E7BF5', fontSize: 16 }} />
          <Text strong style={{ fontSize: 13, color: '#262626' }}>
            AI 图表建议
          </Text>
        </div>
        <div
          style={{
            padding: '24px 0',
            textAlign: 'center',
            color: '#bbb',
            fontSize: 13,
          }}
        >
          ⏳ 待 SQL Workbench 验证后展示
        </div>
      </div>
    )
  }

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
    <div style={{ marginTop: 12, background: '#fafafa', borderRadius: 12, padding: '16px 16px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <BarChartOutlined style={{ color: '#4E7BF5', fontSize: 16 }} />
        <Text strong style={{ fontSize: 13, color: '#262626' }}>
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
          overflowY: 'hidden',
          paddingBottom: 10,
          scrollbarWidth: 'thin' as any,
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
