import React from 'react'
import { Typography, Empty } from 'antd'
import { BarChartOutlined } from '@ant-design/icons'
import ChartCard from './ChartCard'
import type { AiChartSpec, QueryResult } from '../types/aiAsk'
import type { NarrativeLevel } from '../types/aiAsk'
import { filterMatchingCharts, canonicalizeSpec } from '../api/aiAsk/chartFieldMatch'

const { Text } = Typography

interface AiChartBoardProps {
  chartSuggestions: AiChartSpec[]
  columns: string[]
  rows: any[][]
  activeIndex: number
  onActiveChange: (index: number) => void
  /** Phase 5M: when sql_pending, show placeholder instead of factual charts */
  narrativeLevel?: NarrativeLevel
  /** Phase 5N: real queryResult data for post-execute empty-data display */
  queryResult?: QueryResult | null
  /** Phase 5N Task 6.5D: 列类型标签；缺省时回退到 queryResult.columnTypes */
  columnTypes?: string[]
}

const AiChartBoard: React.FC<AiChartBoardProps> = ({
  chartSuggestions,
  columns,
  rows,
  activeIndex,
  onActiveChange,
  narrativeLevel,
  queryResult,
  columnTypes,
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

  // Phase 5N follow-up: executed with empty queryResult — do not render
  // (page shows "查询成功但无数据" in the result table, avoid duplication)
  if (narrativeLevel === 'executed' && queryResult && queryResult.rows.length === 0) {
    return null
  }

  // Phase 5N follow-up: filter chartSuggestions by field matching, using
  // the same case-insensitive logic as RealLlmAdapter.getChartData()
  const matchingColumns = queryResult ? queryResult.columns : columns
  const matchingRows = queryResult ? queryResult.rows : rows
  let matchedCharts = filterMatchingCharts(chartSuggestions, matchingColumns)
  // Phase 5N Task 6.5D follow-up: executed + queryResult 时过滤 metric-card，
  // 其 value 是预执行虚构数字，不得渲染到 DOM
  if (narrativeLevel === 'executed' && queryResult) {
    matchedCharts = matchedCharts.filter((spec) => spec.chartType !== 'metric-card')
  }
  // Phase 5N Task 6.5D follow-up: 将 spec 字段映射为 queryResult.columns 的真实大小写，
  // 下游 ChartCard/ChartCanvas 不再需要自行做大小写不敏感匹配
  matchedCharts = matchedCharts.map((spec) => canonicalizeSpec(spec, matchingColumns))
  // Phase 5N Task 6.5D: 字段类型检测使用的列类型标签
  const effectiveColumnTypes = columnTypes ?? queryResult?.columnTypes

  if (!chartSuggestions || chartSuggestions.length === 0) {
    return (
      <Empty
        description="暂无图表建议"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        style={{ margin: '12px 0' }}
      />
    )
  }

  // All suggestions filtered out — show brief hint
  if (matchedCharts.length === 0) {
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
          图表字段与查询结果不匹配，请查看查询结果表
        </div>
      </div>
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
          — 共 {matchedCharts.length} 种视角，点击切换
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
        {matchedCharts.map((spec, index) => (
          <ChartCard
            key={`${spec.chartType}-${index}`}
            spec={spec}
            columns={matchingColumns}
            rows={matchingRows}
            isActive={index === activeIndex}
            onSelect={() => onActiveChange(index)}
            columnTypes={effectiveColumnTypes}
          />
        ))}
      </div>
    </div>
  )
}

export default AiChartBoard
