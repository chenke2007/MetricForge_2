import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
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

const mockColumns = ['region', 'total_revenue', 'gross_margin']
const mockRows = [
  ['华东', 12300000, 32.5],
  ['华南', 9800000, 28.7],
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

describe('ChartCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders chart container with bar spec', () => {
    render(
      <ChartCanvas spec={barSpec} columns={mockColumns} rows={mockRows} height={200} />
    )
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('renders chart container with line spec', () => {
    render(
      <ChartCanvas spec={lineSpec} columns={mockColumns} rows={mockRows} height={200} />
    )
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('renders chart container with pie spec', () => {
    render(
      <ChartCanvas spec={pieSpec} columns={mockColumns} rows={mockRows} height={200} />
    )
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('handles empty data gracefully', () => {
    render(
      <ChartCanvas spec={barSpec} columns={mockColumns} rows={[]} height={200} />
    )
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })

  it('handles metric-card as fallback (no ECharts render)', () => {
    const metricSpec: AiChartSpec = {
      title: '指标卡',
      chartType: 'metric-card',
      xField: 'region',
      yFields: ['total_revenue'],
      rationale: '',
      limitations: [],
    }
    render(
      <ChartCanvas spec={metricSpec} columns={mockColumns} rows={mockRows} height={200} />
    )
    expect(screen.getByTestId('chart-canvas')).toBeTruthy()
  })
})
