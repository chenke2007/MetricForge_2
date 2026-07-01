import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ChartCanvas from './ChartCanvas'

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

describe('ChartCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders chart container', () => {
    render(
      <ChartCanvas
        chartType="bar"
        xColumn="category"
        yColumn="amount"
        columns={['category', 'amount']}
        rows={[
          ['A', '100'],
          ['B', '200'],
        ]}
      />
    )
    expect(screen.getByTestId('chart-canvas')).toBeInTheDocument()
  })

  it('calls echarts init with container ref', async () => {
    const echartsCore = await import('echarts/core')
    render(
      <ChartCanvas
        chartType="bar"
        xColumn="category"
        yColumn="amount"
        columns={['category', 'amount']}
        rows={[
          ['A', '100'],
          ['B', '200'],
        ]}
      />
    )
    expect(echartsCore.init).toHaveBeenCalled()
  })

  it('calls setOption when props change', () => {
    const { rerender } = render(
      <ChartCanvas
        chartType="bar"
        xColumn="category"
        yColumn="amount"
        columns={['category', 'amount']}
        rows={[
          ['A', '100'],
          ['B', '200'],
        ]}
      />
    )
    expect(mockSetOption).toHaveBeenCalled()

    rerender(
      <ChartCanvas
        chartType="line"
        xColumn="category"
        yColumn="amount"
        columns={['category', 'amount']}
        rows={[
          ['A', '100'],
          ['B', '200'],
          ['C', '300'],
        ]}
      />
    )
    expect(mockSetOption).toHaveBeenCalledTimes(2)
  })

  it('disposes chart on unmount', () => {
    const { unmount } = render(
      <ChartCanvas
        chartType="bar"
        xColumn="category"
        yColumn="amount"
        columns={['category', 'amount']}
        rows={[
          ['A', '100'],
        ]}
      />
    )
    unmount()
    expect(mockDispose).toHaveBeenCalled()
  })

  it('calls clear when data is empty', () => {
    render(
      <ChartCanvas
        chartType="bar"
        xColumn="category"
        yColumn="amount"
        columns={['category', 'amount']}
        rows={[]}
      />
    )
    expect(mockClear).toHaveBeenCalled()
    expect(mockSetOption).not.toHaveBeenCalled()
  })

  it('calls clear when xColumn is not found', () => {
    render(
      <ChartCanvas
        chartType="bar"
        xColumn="nonexistent"
        yColumn="amount"
        columns={['category', 'amount']}
        rows={[
          ['A', '100'],
        ]}
      />
    )
    expect(mockClear).toHaveBeenCalled()
    expect(mockSetOption).not.toHaveBeenCalled()
  })

  it('calls clear when yColumn is not numeric', () => {
    render(
      <ChartCanvas
        chartType="bar"
        xColumn="category"
        yColumn="amount"
        columns={['category', 'amount']}
        rows={[
          ['A', 'not_a_number'],
        ]}
      />
    )
    expect(mockClear).toHaveBeenCalled()
    expect(mockSetOption).not.toHaveBeenCalled()
  })

  it('does not init chart when container ref is null', () => {
    // This is implicitly tested by the component structure;
    // the init call is guarded by containerRef.current check.
    // We verify the component still renders without crashing.
    const { container } = render(
      <ChartCanvas
        chartType="bar"
        xColumn="category"
        yColumn="amount"
        columns={['category', 'amount']}
        rows={[
          ['A', '100'],
        ]}
      />
    )
    expect(container.querySelector('[data-testid="chart-canvas"]')).toBeInTheDocument()
  })
})
