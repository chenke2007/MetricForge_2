import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AiChartBoard from './AiChartBoard'
import type { AiChartSpec } from '../types/aiAsk'

// Mock ChartCard to simplify test rendering
vi.mock('./ChartCard', () => ({
  default: ({ spec, isActive, onSelect }: any) => (
    <div
      data-testid={`chart-card-${spec.title}`}
      data-active={isActive ? 'true' : 'false'}
      onClick={onSelect}
    >
      {spec.title}
    </div>
  ),
}))

const suggestions: AiChartSpec[] = [
  {
    title: '各区域销售额排行',
    chartType: 'bar',
    xField: 'region',
    yFields: ['total_revenue'],
    rationale: '柱状图直观对比各区域销售额',
    limitations: [],
  },
  {
    title: '各区域毛利率对比',
    chartType: 'bar',
    xField: 'region',
    yFields: ['gross_margin'],
    rationale: '毛利率横向对比',
    limitations: [],
  },
  {
    title: '销售额占比分布',
    chartType: 'pie',
    xField: 'region',
    yFields: ['total_revenue'],
    rationale: '饼图展示占比结构',
    limitations: [],
  },
]

const mockData = {
  columns: ['region', 'total_revenue', 'gross_margin'],
  rows: [
    ['华东', 12300000, 32.5],
    ['华南', 9800000, 28.7],
  ],
}

describe('AiChartBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders board title with chart count', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
      />
    )
    expect(screen.getByText('AI 图表建议')).toBeInTheDocument()
    expect(screen.getByText(/共 3 种视角/)).toBeInTheDocument()
  })

  it('renders all chart suggestions', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={() => {}}
      />
    )
    expect(screen.getByText('各区域销售额排行')).toBeInTheDocument()
    expect(screen.getByText('各区域毛利率对比')).toBeInTheDocument()
    expect(screen.getByText('销售额占比分布')).toBeInTheDocument()
  })

  it('shows empty state when no suggestions', () => {
    render(
      <AiChartBoard
        chartSuggestions={[]}
        columns={[]}
        rows={[]}
        activeIndex={0}
        onActiveChange={() => {}}
      />
    )
    expect(screen.getByText('暂无图表建议')).toBeInTheDocument()
    expect(screen.queryByText('AI 图表建议')).not.toBeInTheDocument()
  })

  it('calls onActiveChange when a chart card is clicked', () => {
    const onChange = vi.fn()
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={0}
        onActiveChange={onChange}
      />
    )
    fireEvent.click(screen.getByText('各区域毛利率对比'))
    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('marks the active chart card', () => {
    render(
      <AiChartBoard
        chartSuggestions={suggestions}
        columns={mockData.columns}
        rows={mockData.rows}
        activeIndex={1}
        onActiveChange={() => {}}
      />
    )
    const activeCard = screen.getByTestId('chart-card-各区域毛利率对比')
    const inactiveCard = screen.getByTestId('chart-card-各区域销售额排行')
    expect(activeCard.getAttribute('data-active')).toBe('true')
    expect(inactiveCard.getAttribute('data-active')).toBe('false')
  })

  it('handles null/undefined suggestions gracefully', () => {
    render(
      <AiChartBoard
        chartSuggestions={null as any}
        columns={[]}
        rows={[]}
        activeIndex={0}
        onActiveChange={() => {}}
      />
    )
    expect(screen.getByText('暂无图表建议')).toBeInTheDocument()
  })
})
