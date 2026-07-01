import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ChartPreview from './ChartPreview'

const mockStore = vi.hoisted(() => ({
  result: null as any,
  sql: 'SELECT * FROM users',
  datasourceId: 1 as number | null,
  chartConfig: { chartType: 'bar' as const, xColumn: null as string | null, yColumn: null as string | null },
  setChartConfig: vi.fn(),
}))

vi.mock('../stores/sqlWorkbenchStore', () => ({
  useSqlWorkbenchStore: (selector: any) => selector(mockStore),
}))

vi.mock('./ChartDraftSaveModal', async () => {
  const React = await import('react')
  return {
    default: function MockChartDraftSaveModal({ open }: { open: boolean }) {
      return open
        ? React.createElement('div', { 'data-testid': 'chart-draft-save-modal' }, '保存图表草稿')
        : null
    },
  }
})

vi.mock('echarts/core', () => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
  })),
  use: vi.fn(),
}))

describe('ChartPreview', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    mockStore.result = null
    mockStore.chartConfig = { chartType: 'bar', xColumn: null, yColumn: null }
  })

  it('renders empty state when result has no rows', () => {
    mockStore.result = { columns: ['category', 'amount'], rows: [], row_count: 0 }
    render(<ChartPreview />)
    expect(screen.getByText('查询结果为空，无法生成图表')).toBeInTheDocument()
  })

  it('renders empty state when result is null', () => {
    mockStore.result = null
    render(<ChartPreview />)
    expect(screen.getByText('查询结果为空，无法生成图表')).toBeInTheDocument()
  })

  it('renders empty state when columns are empty', () => {
    mockStore.result = { columns: [], rows: [], row_count: 0 }
    render(<ChartPreview />)
    expect(screen.getByText('查询结果为空，无法生成图表')).toBeInTheDocument()
  })

  it('renders chart type selector', () => {
    mockStore.result = { columns: ['category', 'amount'], rows: [['A', '100']], row_count: 1 }
    render(<ChartPreview />)
    expect(screen.getByText('柱状图')).toBeInTheDocument()
    expect(screen.getByText('折线图')).toBeInTheDocument()
    expect(screen.getByText('饼图')).toBeInTheDocument()
  })

  it('renders X and Y field selectors from columns', async () => {
    mockStore.result = { columns: ['category', 'amount'], rows: [['A', '100']], row_count: 1 }
    render(<ChartPreview />)
    // Open the X field select dropdown to verify options
    const xSelect = screen.getAllByRole('combobox')[0]
    fireEvent.mouseDown(xSelect)
    const categoryOptions = await screen.findAllByText('category')
    expect(categoryOptions.length).toBeGreaterThan(0)
    const amountOptions = await screen.findAllByText('amount')
    expect(amountOptions.length).toBeGreaterThan(0)
  })

  it('updates chart config when user changes chart type', () => {
    mockStore.result = { columns: ['category', 'amount'], rows: [['A', '100']], row_count: 1 }
    render(<ChartPreview />)
    const lineTab = screen.getByText('折线图')
    fireEvent.click(lineTab)
    expect(mockStore.setChartConfig).toHaveBeenCalledWith(expect.objectContaining({ chartType: 'line' }))
  })

  it('updates chart config when user selects X field', async () => {
    mockStore.result = { columns: ['category', 'amount'], rows: [['A', '100']], row_count: 1 }
    render(<ChartPreview />)
    // Open the X field select dropdown
    const xSelect = screen.getAllByRole('combobox')[0]
    fireEvent.mouseDown(xSelect)
    // Click on the 'category' option
    const categoryOption = await screen.findByTitle('category')
    fireEvent.click(categoryOption)
    expect(mockStore.setChartConfig).toHaveBeenCalledWith(expect.objectContaining({ xColumn: 'category' }))
  })

  it('updates chart config when user selects Y field', async () => {
    mockStore.result = { columns: ['category', 'amount'], rows: [['A', '100']], row_count: 1 }
    render(<ChartPreview />)
    const ySelect = screen.getAllByRole('combobox')[1]
    fireEvent.mouseDown(ySelect)
    const amountOption = await screen.findByTitle('amount')
    fireEvent.click(amountOption)
    expect(mockStore.setChartConfig).toHaveBeenCalledWith(expect.objectContaining({ yColumn: 'amount' }))
  })

  it('shows prompt to select fields when no X/Y selected', () => {
    mockStore.result = { columns: ['category', 'amount'], rows: [['A', '100']], row_count: 1 }
    mockStore.chartConfig = { chartType: 'bar', xColumn: null, yColumn: null }
    render(<ChartPreview />)
    expect(screen.getByText('请选择 X 轴字段和 Y 轴字段')).toBeInTheDocument()
  })

  it('shows alert when Y field is not numeric', () => {
    mockStore.result = {
      columns: ['category', 'name'],
      rows: [['A', 'Alice']],
      row_count: 1,
    }
    mockStore.chartConfig = { chartType: 'bar', xColumn: 'category', yColumn: 'name' }
    render(<ChartPreview />)
    expect(screen.getByText(/所选 Y 字段不是数值类型/)).toBeInTheDocument()
  })

  it('renders ChartCanvas when valid selection exists', () => {
    mockStore.result = {
      columns: ['category', 'amount'],
      rows: [['A', '100']],
      row_count: 1,
    }
    mockStore.chartConfig = { chartType: 'bar', xColumn: 'category', yColumn: 'amount' }
    render(<ChartPreview />)
    expect(screen.getByTestId('chart-canvas')).toBeInTheDocument()
  })

  it('shows truncation warning when data exceeds 100 groups', () => {
    const rows = Array.from({ length: 101 }, (_, i) => [`item-${i}`, '1'])
    mockStore.result = {
      columns: ['category', 'amount'],
      rows,
      row_count: 101,
    }
    mockStore.chartConfig = { chartType: 'bar', xColumn: 'category', yColumn: 'amount' }
    render(<ChartPreview />)
    expect(screen.getByText(/数据点过多，仅显示前 100 个分组/)).toBeInTheDocument()
  })

  it('shows save chart button in chart mode', () => {
    mockStore.result = { columns: ['category', 'amount'], rows: [['A', '100']], row_count: 1 }
    render(<ChartPreview />)
    expect(screen.getByRole('button', { name: /保存图表/ })).toBeInTheDocument()
  })

  it('opens save modal when save chart button is clicked', () => {
    mockStore.result = { columns: ['category', 'amount'], rows: [['A', '100']], row_count: 1 }
    render(<ChartPreview />)
    fireEvent.click(screen.getByRole('button', { name: /保存图表/ }))
    expect(screen.getByTestId('chart-draft-save-modal')).toBeInTheDocument()
  })
})

