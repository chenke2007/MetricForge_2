import React from 'react'
import { Card, Typography, Tag, Space } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import ChartCanvas from './ChartCanvas'
import type { AiChartSpec } from '../types/aiAsk'

const { Text, Paragraph } = Typography

interface ChartCardProps {
  spec: AiChartSpec
  columns: string[]
  rows: any[][]
  width?: number
  isActive?: boolean
  onSelect?: () => void
}

const CHART_TYPE_LABELS: Record<string, string> = {
  bar: '柱状图',
  line: '折线图',
  pie: '饼图',
  'metric-card': '指标卡',
  table: '表格',
  combo: '组合图',
}

const ChartCard: React.FC<ChartCardProps> = ({
  spec,
  columns,
  rows,
  width = 320,
  isActive,
  onSelect,
}) => {
  return (
    <Card
      size="small"
      hoverable
      onClick={onSelect}
      style={{
        borderRadius: 10,
        boxShadow: isActive
          ? '0 2px 8px rgba(78, 123, 245, 0.2)'
          : '0 1px 4px rgba(0,0,0,0.06)',
        border: isActive ? '1.5px solid #4E7BF5' : '1px solid #f0f0f0',
        minWidth: width,
        flexShrink: 0,
        cursor: onSelect ? 'pointer' : 'default',
        transition: 'all 0.2s',
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: 4 }}>
        <Text strong style={{ fontSize: 13, color: '#333' }}>
          {spec.title}
        </Text>
        {spec.subtitle && (
          <Text style={{ fontSize: 11, color: '#999', display: 'block', marginTop: 2 }}>
            {spec.subtitle}
          </Text>
        )}
      </div>

      {/* 指标卡（metric-card）行内渲染 */}
      {spec.chartType === 'metric-card' && spec.metricCards && spec.metricCards.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(spec.metricCards.length, 3)}, 1fr)`,
            gap: 8,
            padding: '8px 0',
          }}
        >
          {spec.metricCards.map((mc, i) => (
            <div
              key={i}
              style={{
                textAlign: 'center',
                padding: '8px 4px',
                background: '#f9fafb',
                borderRadius: 8,
              }}
            >
              <Text style={{ fontSize: 11, color: '#999', display: 'block' }}>{mc.label}</Text>
              <Text strong style={{ fontSize: 18, color: '#333', display: 'block', marginTop: 2 }}>
                {mc.value}
              </Text>
              {mc.change && (
                <span
                  style={{
                    fontSize: 11,
                    color:
                      mc.changeDirection === 'up'
                        ? '#52c41a'
                        : mc.changeDirection === 'down'
                          ? '#ff4d4f'
                          : '#999',
                  }}
                >
                  {mc.changeDirection === 'up' ? '↑' : mc.changeDirection === 'down' ? '↓' : '→'}{' '}
                  {mc.change}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ECharts 图表 */}
      {spec.chartType !== 'metric-card' && (
        <ChartCanvas
          spec={spec}
          columns={columns}
          rows={rows}
          height={200}
          width={width - 32}
        />
      )}

      {/* 底部信息区 */}
      <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #f5f5f5' }}>
        <Space size={4}>
          <Tag color="blue" style={{ fontSize: 10, lineHeight: '16px' }}>
            {CHART_TYPE_LABELS[spec.chartType] || '图表'}
          </Tag>
          {spec.aggregation && (
            <Tag
              style={{
                fontSize: 10,
                lineHeight: '16px',
                background: '#f0f5ff',
                border: 'none',
                color: '#4E7BF5',
              }}
            >
              {spec.aggregation}
            </Tag>
          )}
        </Space>
        <Paragraph
          type="secondary"
          style={{ fontSize: 11, marginTop: 4, marginBottom: 0, color: '#999' }}
          ellipsis={{ rows: 2 }}
        >
          <InfoCircleOutlined style={{ marginRight: 4 }} />
          {spec.rationale}
        </Paragraph>
        {spec.limitations.length > 0 && (
          <Text style={{ fontSize: 10, color: '#d9d9d9', display: 'block', marginTop: 2 }}>
            局限性: {spec.limitations.join('; ')}
          </Text>
        )}
      </div>
    </Card>
  )
}

export default ChartCard
