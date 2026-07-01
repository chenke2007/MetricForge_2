import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ChartDraftList from './ChartDraftList'
import type { ChartDraft } from '../api/chartDrafts'

const mockDrafts: ChartDraft[] = [
  {
    id: 1,
    title: 'Sales by Region',
    sqlText: 'SELECT region, SUM(amount) FROM sales GROUP BY region',
    datasourceId: 1,
    chartConfig: { chartType: 'bar', xColumn: 'region', yColumn: 'amount' },
    datasourceAvailable: true,
    createdAt: '2026-06-30T10:00:00Z',
    updatedAt: '2026-06-30T12:00:00Z',
  },
  {
    id: 2,
    title: 'Daily Users',
    sqlText: 'SELECT date, COUNT(*) FROM users GROUP BY date',
    datasourceId: 3,
    chartConfig: { chartType: 'line', xColumn: 'date', yColumn: 'count' },
    datasourceAvailable: false,
    createdAt: '2026-06-29T08:00:00Z',
    updatedAt: '2026-06-29T09:00:00Z',
  },
]

const mockQuery = vi.hoisted(() => ({
  data: undefined as ChartDraft[] | undefined,
  isLoading: false,
  error: null as Error | null,
}))

vi.mock('../api/chartDrafts', () => ({
  useChartDrafts: () => mockQuery,
}))

const onLoad = vi.fn()

describe('ChartDraftList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.data = undefined
    mockQuery.isLoading = false
    mockQuery.error = null
  })

  it('shows loading spinner when loading', () => {
    mockQuery.isLoading = true
    render(<ChartDraftList onLoad={onLoad} />)
    expect(screen.getByTestId('chart-draft-list-spin')).toBeInTheDocument()
  })

  it('shows empty state when no drafts', () => {
    mockQuery.data = []
    render(<ChartDraftList onLoad={onLoad} />)
    expect(screen.getByText('暂无图表草稿')).toBeInTheDocument()
  })

  it('renders draft items with titles', () => {
    mockQuery.data = mockDrafts
    render(<ChartDraftList onLoad={onLoad} />)
    expect(screen.getByText('Sales by Region')).toBeInTheDocument()
    expect(screen.getByText('Daily Users')).toBeInTheDocument()
  })

  it('shows datasource unavailable tag for unavailable drafts', () => {
    mockQuery.data = mockDrafts
    render(<ChartDraftList onLoad={onLoad} />)
    const tags = screen.getAllByText('数据源不可用')
    expect(tags.length).toBeGreaterThanOrEqual(1)
  })

  it('calls onLoad with full draft data when clicked', () => {
    mockQuery.data = mockDrafts
    render(<ChartDraftList onLoad={onLoad} />)
    fireEvent.click(screen.getByText('Sales by Region'))
    expect(onLoad).toHaveBeenCalledWith(mockDrafts[0])
  })

  it('still allows clicking draft with unavailable datasource', () => {
    mockQuery.data = mockDrafts
    render(<ChartDraftList onLoad={onLoad} />)
    fireEvent.click(screen.getByText('Daily Users'))
    expect(onLoad).toHaveBeenCalledWith(mockDrafts[1])
  })

  it('shows error message when query fails', () => {
    mockQuery.error = new Error('network error')
    render(<ChartDraftList onLoad={onLoad} />)
    expect(screen.getByText('加载图表草稿失败')).toBeInTheDocument()
  })
})
