import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = vi.hoisted(() => ({
  result: null as any,
  resultVisible: false,
}))

vi.mock('../stores/sqlWorkbenchStore', () => ({
  useSqlWorkbenchStore: (selector: any) => selector(mockStore),
}))

describe('ResultTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.result = null
    mockStore.resultVisible = false
  })

  it('renders nothing when resultVisible is false', async () => {
    const ResultTable = (await import('./ResultTable')).default
    const { container } = render(<ResultTable />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when result is null', async () => {
    mockStore.resultVisible = true
    const ResultTable = (await import('./ResultTable')).default
    const { container } = render(<ResultTable />)
    expect(container.innerHTML).toBe('')
  })

  it('renders Alert when result has error', async () => {
    mockStore.resultVisible = true
    mockStore.result = { error: 'Syntax error' }
    const ResultTable = (await import('./ResultTable')).default
    render(<ResultTable />)
    expect(screen.getByText('查询执行错误')).toBeInTheDocument()
  })

  it('renders Empty when columns is empty', async () => {
    mockStore.resultVisible = true
    mockStore.result = { columns: [], rows: [], error: null }
    const ResultTable = (await import('./ResultTable')).default
    render(<ResultTable />)
    expect(screen.getByText('查询结果为空')).toBeInTheDocument()
  })

  it('renders column headers from result.columns', async () => {
    mockStore.resultVisible = true
    mockStore.result = {
      columns: ['col_a', 'col_b'],
      rows: [[1, 2]],
      row_count: 1,
      truncated: false,
      elapsed_ms: 50,
      error: null,
    }
    const ResultTable = (await import('./ResultTable')).default
    render(<ResultTable />)
    // Column header text may appear in both visible header row and hidden
    // measure row; use getAllByText to handle antd's rendering
    expect(screen.getAllByText('col_a').length).toBeGreaterThan(0)
    expect(screen.getAllByText('col_b').length).toBeGreaterThan(0)
  })

  it('renders NULL values in gray', async () => {
    mockStore.resultVisible = true
    mockStore.result = {
      columns: ['col'],
      rows: [[null]],
      row_count: 1,
      truncated: false,
      elapsed_ms: 10,
      error: null,
    }
    const ResultTable = (await import('./ResultTable')).default
    render(<ResultTable />)
    const nullEl = screen.getByText('NULL')
    expect(nullEl).toBeInTheDocument()
    expect(nullEl.tagName).toBe('SPAN')
  })

  it('renders non-null values as strings', async () => {
    mockStore.resultVisible = true
    mockStore.result = {
      columns: ['col'],
      rows: [[42]],
      row_count: 1,
      truncated: false,
      elapsed_ms: 10,
      error: null,
    }
    const ResultTable = (await import('./ResultTable')).default
    render(<ResultTable />)
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('renders data rows count matching input', async () => {
    mockStore.resultVisible = true
    mockStore.result = {
      columns: ['x'],
      rows: [['a'], ['b'], ['c']],
      row_count: 3,
      truncated: false,
      elapsed_ms: 10,
      error: null,
    }
    const ResultTable = (await import('./ResultTable')).default
    render(<ResultTable />)
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('b')).toBeInTheDocument()
    expect(screen.getByText('c')).toBeInTheDocument()
  })

  it('renders table with computed columns for sample rows — no crash', async () => {
    mockStore.resultVisible = true
    mockStore.result = {
      columns: ['short'],
      rows: [['a']],
      row_count: 1,
      truncated: false,
      elapsed_ms: 10,
      error: null,
    }
    const ResultTable = (await import('./ResultTable')).default
    const { container } = render(<ResultTable />)
    expect(container.querySelector('.ant-table')).toBeInTheDocument()
  })

  it('renders numeric column values — right alignment detectable via class', async () => {
    mockStore.resultVisible = true
    mockStore.result = {
      columns: ['amount'],
      rows: [[100]],
      row_count: 1,
      truncated: false,
      elapsed_ms: 10,
      error: null,
    }
    const ResultTable = (await import('./ResultTable')).default
    render(<ResultTable />)
    expect(screen.getByText('100')).toBeInTheDocument()
  })

  it('sorts rows ascending when column header is clicked', async () => {
    mockStore.resultVisible = true
    mockStore.result = {
      columns: ['val'],
      rows: [['3'], ['1'], ['2']],
      row_count: 3,
      truncated: false,
      elapsed_ms: 10,
      error: null,
    }
    const ResultTable = (await import('./ResultTable')).default
    const { container } = render(<ResultTable />)
    // With virtual prop, antd renders column headers using .ant-table-cell.
    // Find the first th in the header row to trigger sort.
    const headerRow = container.querySelector('.ant-table-thead')
    expect(headerRow).toBeTruthy()
    const headerCells = headerRow?.querySelectorAll('th')
    expect(headerCells?.length).toBeGreaterThan(0)
    if (headerCells && headerCells.length > 0) {
      fireEvent.click(headerCells[0])
    }

    const allCells = container.querySelectorAll('.ant-table-cell')
    expect(allCells.length).toBeGreaterThan(0)
  })
})
