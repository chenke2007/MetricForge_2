import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChartCanvas from './ChartCanvas'
import type { AiChartSpec } from '../types/aiAsk'

const mockSetOption = vi.fn()
const mockDispose = vi.fn()
const mockClear = vi.fn()
const mockResize = vi.fn()

vi.mock('echarts/core', () => ({
  init: vi.fn(() => ({
    setOption: mockSetOption,
    dispose: mockDispose,
    clear: mockClear,
    resize: mockResize,
  })),
  use: vi.fn(),
}))

const mockColumns = ['region', 'total_revenue', 'gross_margin', 'month']
const mockRows = [
  ['华东', 12300000, 32.5, '2026-01'],
  ['华南', 9800000, 28.7, '2026-01'],
]

const barSpec: AiChartSpec = {
  title: '各区域销售额',
  chartType: 'bar',
  xField: 'region',
  yFields: ['total_revenue'],
  rationale: '直观对比各区域销售额',
  limitations: [],
}

const lineSpec: AiChartSpec = {
  title: '趋势图',
  chartType: 'line',
  xField: 'region',
  yFields: ['total_revenue'],
  rationale: '',
  limitations: [],
}

const pieSpec: AiChartSpec = {
  title: '占比',
  chartType: 'pie',
  xField: 'region',
  yFields: ['total_revenue'],
  rationale: '',
  limitations: [],
}

const comboSpec: AiChartSpec = {
  title: '组合图',
  chartType: 'combo',
  xField: 'region',
  yFields: ['total_revenue', 'gross_margin'],
  rationale: '',
  limitations: [],
}

const multiBarSpec: AiChartSpec = {
  title: '多指标',
  chartType: 'bar',
  xField: 'region',
  yFields: ['total_revenue', 'gross_margin'],
  rationale: '',
  limitations: [],
}

const multiLineSpec: AiChartSpec = {
  title: '多折线',
  chartType: 'line',
  xField: 'region',
  yFields: ['total_revenue', 'gross_margin'],
  rationale: '',
  limitations: [],
}

describe('ChartCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders chart container with bar spec', () => {
    render(<ChartCanvas spec={barSpec} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
    expect(mockSetOption).toHaveBeenCalled()
  })

  it('renders chart container with line spec', () => {
    render(<ChartCanvas spec={lineSpec} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('renders pie chart', () => {
    render(<ChartCanvas spec={pieSpec} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('renders combo chart', () => {
    render(<ChartCanvas spec={comboSpec} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('renders multi yField bar chart (grouped)', () => {
    render(<ChartCanvas spec={multiBarSpec} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('renders multi yField line chart', () => {
    render(<ChartCanvas spec={multiLineSpec} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('handles empty data gracefully', () => {
    render(<ChartCanvas spec={barSpec} columns={mockColumns} rows={[]} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('handles metric-card type without error', () => {
    const metricSpec: AiChartSpec = {
      title: '指标卡',
      chartType: 'metric-card',
      xField: 'region',
      yFields: ['total_revenue'],
      rationale: '',
      limitations: [],
    }
    render(<ChartCanvas spec={metricSpec} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
    // metric-card should not call setOption (clears instead)
    expect(mockClear).toHaveBeenCalled()
  })

  it('renders combo with single yField as bar fallback', () => {
    const singleFieldCombo: AiChartSpec = {
      title: '单字段组合',
      chartType: 'combo',
      xField: 'region',
      yFields: ['total_revenue'],
      rationale: '',
      limitations: [],
    }
    render(<ChartCanvas spec={singleFieldCombo} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('handles table type without error', () => {
    const tableSpec: AiChartSpec = {
      title: '表格',
      chartType: 'table',
      yFields: [],
      rationale: '',
      limitations: [],
    }
    render(<ChartCanvas spec={tableSpec} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
    // table should not call setOption (clears instead)
    expect(mockClear).toHaveBeenCalled()
  })

  it('handles unsupported chart type gracefully', () => {
    const unsupportedSpec: AiChartSpec = {
      title: '未知',
      chartType: 'unknown' as any,
      xField: 'region',
      yFields: ['total_revenue'],
      rationale: '',
      limitations: [],
    }
    render(<ChartCanvas spec={unsupportedSpec} columns={mockColumns} rows={mockRows} height={200} />)
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  // ── Phase 5N Task 6.5D: decimal string conversion & unsafe degradation ──

  it('converts safe decimal strings to numbers for charting', () => {
    render(
      <ChartCanvas
        spec={barSpec}
        columns={['region', 'total_revenue']}
        rows={[['华东', '123.45'], ['华南', '678.90']]}
        columnTypes={['string', 'decimal']}
        height={200}
      />
    )
    const seriesCall = mockSetOption.mock.calls.find((c) => c[0].series)
    expect(seriesCall).toBeTruthy()
    expect(seriesCall![0].series[0].data).toEqual([123.45, 678.9])
  })

  it('degrades with precision message for unsafe decimal values', () => {
    render(
      <ChartCanvas
        spec={barSpec}
        columns={['region', 'total_revenue']}
        rows={[['华东', '12345678901234567890.1234']]}
        columnTypes={['string', 'decimal']}
        height={200}
      />
    )
    // 不得输出含 series 数据的真实图表 option
    const seriesCall = mockSetOption.mock.calls.find(
      (c) => c[0].series && c[0].series.some((s: any) => (s.data ?? []).length > 0),
    )
    expect(seriesCall).toBeUndefined()
    // 应降级为精度提示
    const titleCall = mockSetOption.mock.calls.find((c) => c[0].title)
    expect(titleCall).toBeTruthy()
    expect(titleCall![0].title.text).toMatch(/精度/)
  })
})
