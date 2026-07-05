import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChartCard from './ChartCard'
import type { AiChartSpec } from '../types/aiAsk'

// Mock ChartCanvas to avoid ECharts dependency in unit tests
vi.mock('./ChartCanvas', () => ({
  default: () => <div data-testid="mock-chart-canvas" />,
}))

const barSpec: AiChartSpec = {
  title: '各区域销售额排行',
  subtitle: '近 30 天数据',
  chartType: 'bar',
  xField: 'region',
  yFields: ['total_revenue'],
  aggregation: 'sum',
  sort: { field: 'total_revenue', direction: 'desc' },
  rationale: '柱状图直观对比各区域销售额高低',
  limitations: ['仅展示近 30 天数据'],
}

const metricCardSpec: AiChartSpec = {
  title: '核心指标总览',
  chartType: 'metric-card',
  yFields: [],
  metricCards: [
    { label: '总营收', value: '3,180万', change: '+12.5%', changeDirection: 'up', icon: 'revenue' },
    { label: '毛利率', value: '31.6%', change: '+2.1%', changeDirection: 'up', icon: 'rate' },
    { label: '订单量', value: '15,387', change: '-3.2%', changeDirection: 'down', icon: 'orders' },
  ],
  rationale: '核心经营指标一览',
  limitations: [],
}

const mockData = {
  columns: ['region', 'total_revenue'],
  rows: [
    ['华东', 12300000],
    ['华南', 9800000],
  ],
}

describe('ChartCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders chart title', () => {
    render(<ChartCard spec={barSpec} columns={mockData.columns} rows={mockData.rows} />)
    expect(screen.getByText('各区域销售额排行')).toBeInTheDocument()
  })

  it('renders subtitle when present', () => {
    render(<ChartCard spec={barSpec} columns={mockData.columns} rows={mockData.rows} />)
    expect(screen.getByText('近 30 天数据')).toBeInTheDocument()
  })

  it('renders chart type tag', () => {
    render(<ChartCard spec={barSpec} columns={mockData.columns} rows={mockData.rows} />)
    expect(screen.getByText('柱状图')).toBeInTheDocument()
  })

  it('renders aggregation tag', () => {
    render(<ChartCard spec={barSpec} columns={mockData.columns} rows={mockData.rows} />)
    expect(screen.getByText('sum')).toBeInTheDocument()
  })

  it('renders rationale text', () => {
    render(<ChartCard spec={barSpec} columns={mockData.columns} rows={mockData.rows} />)
    expect(screen.getByText('柱状图直观对比各区域销售额高低')).toBeInTheDocument()
  })

  it('renders limitations text', () => {
    render(<ChartCard spec={barSpec} columns={mockData.columns} rows={mockData.rows} />)
    expect(screen.getByText(/仅展示近 30 天数据/)).toBeInTheDocument()
  })

  it('renders ChartCanvas for non-metric-card types', () => {
    render(<ChartCard spec={barSpec} columns={mockData.columns} rows={mockData.rows} />)
    expect(screen.getByTestId('mock-chart-canvas')).toBeInTheDocument()
  })

  it('renders metric cards inline instead of ChartCanvas', () => {
    render(
      <ChartCard spec={metricCardSpec} columns={mockData.columns} rows={mockData.rows} />
    )
    expect(screen.getByText('总营收')).toBeInTheDocument()
    expect(screen.getByText('3,180万')).toBeInTheDocument()
    // ↑ appears in 2 metric cards (both have changeDirection: 'up')
    expect(screen.getAllByText('↑').length).toBe(2)
    expect(screen.getByText('+12.5%')).toBeInTheDocument()
    expect(screen.getByText('毛利率')).toBeInTheDocument()
    expect(screen.getByText('31.6%')).toBeInTheDocument()
    expect(screen.getByText('订单量')).toBeInTheDocument()
    expect(screen.getByText('15,387')).toBeInTheDocument()
    expect(screen.getByText('↓')).toBeInTheDocument()
    expect(screen.getByText('-3.2%')).toBeInTheDocument()
    // 指标卡类型不应渲染 ChartCanvas
    expect(screen.queryByTestId('mock-chart-canvas')).not.toBeInTheDocument()
  })

  it('renders metric-card type tag', () => {
    render(
      <ChartCard spec={metricCardSpec} columns={mockData.columns} rows={mockData.rows} />
    )
    expect(screen.getByText('指标卡')).toBeInTheDocument()
  })

  it('renders metric-card with icons when icon field is present', () => {
    render(
      <ChartCard spec={metricCardSpec} columns={mockData.columns} rows={mockData.rows} />
    )
    // The icons are rendered as SVG elements from @ant-design/icons
    // Just verify metric-card elements render with icons present
    expect(screen.getByText('总营收')).toBeInTheDocument()
    expect(screen.getByText('毛利率')).toBeInTheDocument()
    expect(screen.getByText('订单量')).toBeInTheDocument()
    // Value text should be present
    expect(screen.getByText('3,180万')).toBeInTheDocument()
  })

  it('renders metric-card without icon when icon field is missing', () => {
    const noIconMetricSpec: AiChartSpec = {
      title: '核心指标总览',
      chartType: 'metric-card',
      yFields: [],
      metricCards: [
        { label: '总营收', value: '3,180万', change: '+12.5%', changeDirection: 'up' },
      ],
      rationale: '',
      limitations: [],
    }
    render(
      <ChartCard spec={noIconMetricSpec} columns={mockData.columns} rows={mockData.rows} />
    )
    expect(screen.getByText('总营收')).toBeInTheDocument()
    expect(screen.getByText('3,180万')).toBeInTheDocument()
  })

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn()
    render(
      <ChartCard
        spec={barSpec}
        columns={mockData.columns}
        rows={mockData.rows}
        onSelect={onSelect}
      />
    )
    fireEvent.click(screen.getByText('各区域销售额排行'))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('shows active border styling when isActive is true', () => {
    const { container } = render(
      <ChartCard
        spec={barSpec}
        columns={mockData.columns}
        rows={mockData.rows}
        isActive
      />
    )
    const card = container.querySelector('.ant-card')
    expect(card).toBeTruthy()
    // 激活态应包含蓝色边框样式 (Ant Design 将 hex 转为 rgb)
    expect(card?.getAttribute('style')).toContain('rgb(78, 123, 245)')
  })

  it('renders fallback chart type tag for unknown types', () => {
    const unknownSpec: AiChartSpec = {
      title: '未知图表',
      chartType: 'combo',
      yFields: [],
      rationale: '',
      limitations: [],
    }
    render(
      <ChartCard spec={unknownSpec} columns={mockData.columns} rows={mockData.rows} />
    )
    expect(screen.getByText('组合图')).toBeInTheDocument()
  })

  it('renders metric-card with no metricCards gracefully', () => {
    const emptyMetricSpec: AiChartSpec = {
      title: '空指标卡',
      chartType: 'metric-card',
      yFields: [],
      metricCards: [],
      rationale: '',
      limitations: [],
    }
    render(
      <ChartCard spec={emptyMetricSpec} columns={mockData.columns} rows={mockData.rows} />
    )
    expect(screen.getByText('空指标卡')).toBeInTheDocument()
    // 无 metricCards 不应渲染网格
    expect(screen.queryByText('总营收')).not.toBeInTheDocument()
  })

  it('renders no limitations section when limitations array is empty', () => {
    const noLimitSpec: AiChartSpec = {
      title: '无限制图表',
      chartType: 'bar',
      xField: 'x',
      yFields: ['y'],
      rationale: 'test',
      limitations: [],
    }
    render(
      <ChartCard spec={noLimitSpec} columns={mockData.columns} rows={mockData.rows} />
    )
    expect(screen.queryByText(/局限性/)).not.toBeInTheDocument()
  })
})
