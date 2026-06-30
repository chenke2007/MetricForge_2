import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import ResultToolbar from './ResultToolbar'

// Mock CSV utility functions with named spies (hoisted so vi.mock can reference them)
const { mockDownloadCsv, mockCopyCsv } = vi.hoisted(() => ({
  mockDownloadCsv: vi.fn(),
  mockCopyCsv: vi.fn<(csv: string) => Promise<boolean>>(),
}))

vi.mock('../utils/csv', () => ({
  rowsToCsv: vi.fn(() => 'mock,csv\n1,2'),
  downloadCsv: mockDownloadCsv,
  copyCsv: mockCopyCsv,
}))

// Mock antd message
vi.mock('antd', async () => {
  const actual = await vi.importActual('antd')
  return {
    ...(actual as any),
    message: {
      success: vi.fn(),
      warning: vi.fn(),
    },
  }
})

const mockStore = vi.hoisted(() => ({
  result: null as any,
}))

vi.mock('../stores/sqlWorkbenchStore', () => ({
  useSqlWorkbenchStore: (selector: any) => selector(mockStore),
}))

describe('ResultToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.result = null
  })

  it('renders nothing when result is null', () => {
    const { container } = render(<ResultToolbar />)
    expect(container.innerHTML).toBe('')
  })

  it('renders error tag when result has error', () => {
    mockStore.result = { error: 'DB connection failed' }
    render(<ResultToolbar />)
    expect(screen.getByText(/DB connection failed/)).toBeInTheDocument()
  })

  it('renders row count and elapsed time for successful result', () => {
    mockStore.result = {
      columns: ['a'],
      rows: [[1]],
      row_count: 1,
      truncated: false,
      elapsed_ms: 150,
      error: null,
      history_id: null,
    }
    render(<ResultToolbar />)
    expect(screen.getByText('1 行')).toBeInTheDocument()
    expect(screen.getByText('150ms')).toBeInTheDocument()
  })

  it('shows truncated tag when result is truncated', () => {
    mockStore.result = {
      columns: ['a'],
      rows: [[1]],
      row_count: 1000,
      truncated: true,
      elapsed_ms: 200,
      error: null,
    }
    render(<ResultToolbar />)
    expect(screen.getByText(/已截断/)).toBeInTheDocument()
  })

  it('shows disabled export buttons when row_count is 0', () => {
    mockStore.result = {
      columns: ['a'],
      rows: [],
      row_count: 0,
      truncated: false,
      elapsed_ms: 50,
      error: null,
    }
    render(<ResultToolbar />)
    const buttons = screen.getAllByRole('button')
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled()
    })
  })

  it('shows active export buttons when rows exist', () => {
    mockStore.result = {
      columns: ['a'],
      rows: [[1]],
      row_count: 1,
      truncated: false,
      elapsed_ms: 50,
      error: null,
    }
    render(<ResultToolbar />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(2)
    buttons.forEach((btn) => {
      expect(btn).not.toBeDisabled()
    })
  })

  it('calls downloadCsv on export button click', () => {
    mockStore.result = {
      columns: ['a', 'b'],
      rows: [[1, 2]],
      row_count: 1,
      truncated: false,
      elapsed_ms: 50,
      error: null,
    }
    render(<ResultToolbar />)
    // Find the download/export button (second button: copy then export)
    const buttons = screen.getAllByRole('button')
    // Click the export button
    fireEvent.click(buttons[buttons.length - 1])

    expect(mockDownloadCsv).toHaveBeenCalled()
  })

  it('calls copyCsv on copy button click', () => {
    mockCopyCsv.mockResolvedValue(true)
    mockStore.result = {
      columns: ['a', 'b'],
      rows: [[1, 2]],
      row_count: 1,
      truncated: false,
      elapsed_ms: 50,
      error: null,
    }
    render(<ResultToolbar />)

    const buttons = screen.getAllByRole('button')
    // Click the copy button (first button)
    fireEvent.click(buttons[0])

    expect(mockCopyCsv).toHaveBeenCalled()
  })
})
