import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = vi.hoisted(() => ({
  resultVisible: true,
  result: {
    columns: ['category', 'amount'],
    rows: [['A', '100']],
    row_count: 1,
    truncated: false,
    elapsed_ms: 50,
    error: null,
  },
  resultView: 'table' as 'table' | 'chart',
  setResultView: vi.fn(),
  chartConfig: { chartType: 'bar' as const, xColumn: null as string | null, yColumn: null as string | null },
  setChartConfig: vi.fn(),
}))

vi.mock('../stores/sqlWorkbenchStore', () => ({
  useSqlWorkbenchStore: (selector: any) => selector(mockStore),
}))

vi.mock('./ResultTable', () => ({
  default: () => <div data-testid="result-table">ResultTable</div>,
}))

// ChartPreview renders ChartDraftSaveModal which needs @tanstack/react-query.
// Mock it at the component level so the test doesn't need a QueryClientProvider.
vi.mock('./ChartDraftSaveModal', () => ({
  default: () => null,
}))

vi.mock('echarts/core', () => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
  })),
  use: vi.fn(),
}))

// Import statically after mocks are set up
import ResultPanel from './ResultPanel'

describe('ResultPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.resultView = 'table'
  })

  it('renders ResultTable by default', () => {
    render(<ResultPanel />)
    expect(screen.getByTestId('result-table')).toBeInTheDocument()
  })

  it('switches to chart tab when clicked', () => {
    render(<ResultPanel />)
    const chartTab = screen.getByText('图表')
    fireEvent.click(chartTab)
    expect(mockStore.setResultView).toHaveBeenCalledWith('chart')
  })

  it('renders ChartPreview when resultView is chart', () => {
    mockStore.resultView = 'chart'
    render(<ResultPanel />)
    // Use getAllByText since Segmented renders multiple '柱状图' labels (one per item)
    const chartTypeLabels = screen.getAllByText('柱状图')
    expect(chartTypeLabels.length).toBeGreaterThan(0)
  })

  it('keeps ResultToolbar visible across tabs', () => {
    render(<ResultPanel />)
    expect(screen.getByText(/1 行/)).toBeInTheDocument()
    const chartTab = screen.getByText('图表')
    fireEvent.click(chartTab)
    expect(screen.getByText(/1 行/)).toBeInTheDocument()
  })

  it('renders nothing when resultVisible is false', () => {
    mockStore.resultVisible = false
    const { container } = render(<ResultPanel />)
    expect(container.firstChild).toBeNull()
    mockStore.resultVisible = true
  })
})
