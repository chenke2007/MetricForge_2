import React from 'react'
import { Card, Typography, Tag, Space } from 'antd'
import {
  InfoCircleOutlined, DollarOutlined, ShoppingCartOutlined,
  UserOutlined, RiseOutlined, PercentageOutlined,
} from '@ant-design/icons'
import ChartCanvas from './ChartCanvas'
import type { AiChartSpec, MetricIcon } from '../types/aiAsk'
import { NUMERIC_COLUMN_TYPES, hasUnsafeDecimalValues } from '../api/aiAsk/recommendation'

const { Text, Paragraph } = Typography

const METRIC_ICON_MAP: Record<MetricIcon, React.ReactNode> = {
  revenue: <DollarOutlined />,
  orders: <ShoppingCartOutlined />,
  customers: <UserOutlined />,
  profit: <RiseOutlined />,
  rate: <PercentageOutlined />,
}

interface ChartCardProps {
  spec: AiChartSpec
  columns: string[]
  rows: any[][]
  width?: number
  isActive?: boolean
  onSelect?: () => void
  /** Phase 5N Task 6.5D: 后端列类型标签，用于 unsafe Decimal / 不可图表化类型保护 */
  columnTypes?: string[]
}

// ── Phase 5N Task 6.5D: 字段类型安全检查 ──────────────────────────────

interface ChartFieldIssue {
  field: string
  reason: 'unsafe_decimal' | 'incompatible_type'
  columnType: string
}

/** 仅 bar/line/pie/combo 需要数值 yField 检查；table 不受限 */
const NUMERIC_YFIELD_CHART_TYPES = new Set(['bar', 'line', 'pie', 'combo'])

/**
 * 检测 spec 的 yFields 是否存在不适合绘图的字段（fail closed；无 columnTypes 时不干预）。
 * Phase 5N Task 6.5D follow-up: 改为 allowlist — bar/line/pie/combo 仅允许
 * int/float/decimal，其余类型（string/date/datetime/bytes/bool/null/mixed/unknown）
 * 全部降级为说明文本。table 不应用此限制。
 */
function detectChartFieldIssue(
  spec: AiChartSpec,
  columns: string[],
  rows: any[][],
  columnTypes?: string[],
): ChartFieldIssue | null {
  if (!columnTypes || columnTypes.length !== columns.length) return null
  if (!NUMERIC_YFIELD_CHART_TYPES.has(spec.chartType)) return null
  for (const field of spec.yFields) {
    const idx = columns.indexOf(field)
    if (idx === -1) continue
    const columnType = columnTypes[idx]
    if (!NUMERIC_COLUMN_TYPES.includes(columnType)) {
      return { field, reason: 'incompatible_type', columnType }
    }
    if (columnType === 'decimal' && hasUnsafeDecimalValues(rows, idx)) {
      return { field, reason: 'unsafe_decimal', columnType }
    }
  }
  return null
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
  columnTypes,
}) => {
  // Phase 5N Task 6.5D: unsafe Decimal / 不可图表化字段 → 展示说明而非图表
  const fieldIssue =
    spec.chartType !== 'metric-card'
      ? detectChartFieldIssue(spec, columns, rows, columnTypes)
      : null

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

      {/* 指标卡（metric-card）行内渲染 — 5G 增强：图标 + 渐变背景 + hover 动效 */}
      {spec.chartType === 'metric-card' && spec.metricCards && spec.metricCards.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(spec.metricCards.length, 3)}, 1fr)`,
            gap: 10,
            padding: '12px 0',
          }}
        >
          {spec.metricCards.map((mc, i) => (
            <div
              key={i}
              style={{
                textAlign: 'center',
                padding: '12px 8px 10px',
                background: i === 0
                  ? 'linear-gradient(135deg, #f0f5ff, #e6f7ff)'
                  : i === 1
                    ? 'linear-gradient(135deg, #f6fff0, #f0f5ff)'
                    : '#f9fafb',
                borderRadius: 10,
                transition: 'all 0.2s ease',
                cursor: 'default',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.02)'
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            >
              {/* Icon + Label */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 4 }}>
                {mc.icon && METRIC_ICON_MAP[mc.icon] && (
                  <span style={{ fontSize: 14, color: '#4E7BF5' }}>
                    {METRIC_ICON_MAP[mc.icon]}
                  </span>
                )}
                <Text style={{ fontSize: 11, color: '#8c8c8c' }}>{mc.label}</Text>
              </div>
              {/* Value */}
              <Text strong style={{ fontSize: 20, color: '#262626', display: 'block', lineHeight: 1.3 }}>
                {mc.value}
              </Text>
              {/* Change indicator */}
              {mc.change && (
                <span style={{
                  fontSize: 11,
                  color: mc.changeDirection === 'up' ? '#52c41a'
                    : mc.changeDirection === 'down' ? '#ff4d4f' : '#8c8c8c',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                  marginTop: 2,
                }}>
                  <span style={{ fontSize: 12, lineHeight: 1 }}>
                    {mc.changeDirection === 'up' ? '↑' : mc.changeDirection === 'down' ? '↓' : '→'}
                  </span>
                  {mc.change}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ECharts 图表 / 字段类型保护说明 */}
      {spec.chartType !== 'metric-card' && fieldIssue && (
        <div
          data-testid="chart-field-issue"
          style={{ padding: '24px 8px', textAlign: 'center', color: '#999', fontSize: 12 }}
        >
          <InfoCircleOutlined style={{ marginRight: 4 }} />
          {fieldIssue.reason === 'unsafe_decimal'
            ? `字段 ${fieldIssue.field} 为高精度 Decimal，超出图表安全精度，请查看查询结果表`
            : `字段 ${fieldIssue.field} 类型（${fieldIssue.columnType}）不适合图表展示，请查看查询结果表`}
        </div>
      )}
      {spec.chartType !== 'metric-card' && !fieldIssue && (
        <ChartCanvas
          spec={spec}
          columns={columns}
          rows={rows}
          height={200}
          width={width - 32}
          columnTypes={columnTypes}
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
