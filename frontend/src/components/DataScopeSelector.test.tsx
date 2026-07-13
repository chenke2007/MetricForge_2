import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DataScopeSelector from './DataScopeSelector'

const mockSetSelectedTables = vi.fn()

const mockStore = {
  datasourceId: null as number | null,
  datasourceName: null as string | null,
  selectedTables: [] as string[],
  setDatasource: vi.fn(),
  setSelectedTables: mockSetSelectedTables,
}

vi.mock('../stores/aiAskStore', () => ({
  useAiAskStore: vi.fn((selector?: (s: typeof mockStore) => any) => {
    if (selector) return selector(mockStore)
    return mockStore
  }),
}))

const mockSearchSchema = vi.fn<(datasourceId: number | null, q: string) => any>(() => ({
  data: undefined,
  isLoading: false,
  isFetching: false,
}))

vi.mock('../api/sqlWorkbench', () => ({
  useSchemaTree: vi.fn(() => ({
    data: {
      datasource_id: 2,
      datasource_name: 'dwhrpt',
      schemas: [
        {
          schema_name: 'PUBLIC',
          tables: [
            { id: 10, name: 'REVENUE', comment: '收入表', column_count: 8 },
            { id: 11, name: 'USERS', comment: '用户表', column_count: 12 },
            { id: 12, name: 'ORDERS', comment: '订单表', column_count: 6 },
          ],
        },
        {
          schema_name: 'STAGING',
          tables: [
            { id: 20, name: 'RAW_EVENTS', comment: null, column_count: 15 },
          ],
        },
      ],
    },
    isLoading: false,
  })),
  useSearchSchema: vi.fn((datasourceId: any, q: any) => mockSearchSchema(datasourceId, q)),
}))

function setSearchResults(results: any[]) {
  mockSearchSchema.mockReturnValue({
    data: results,
    isLoading: false,
    isFetching: false,
  })
}

describe('DataScopeSelector', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    mockSearchSchema.mockReturnValue({ data: undefined, isLoading: false, isFetching: false })
    mockStore.datasourceId = null
    mockStore.datasourceName = null
    mockStore.selectedTables = []
  })

  it('does not render datasource select (moved to DataScopeBar)', () => {
    mockStore.datasourceId = 2
    render(<DataScopeSelector />)
    expect(screen.queryByText('选择数据源')).not.toBeInTheDocument()
  })

  it('shows prompt text when no datasource selected', () => {
    render(<DataScopeSelector />)
    expect(screen.getByText('选择数据源以查看可用表')).toBeInTheDocument()
  })

  it('shows schema tree when datasource is selected', () => {
    mockStore.datasourceId = 2
    render(<DataScopeSelector />)
    expect(screen.getByText(/表列表 \(4\)/)).toBeInTheDocument()
  })

  it('shows all table names in the collapsed list', () => {
    mockStore.datasourceId = 2
    render(<DataScopeSelector />)

    const collapseHeader = screen.getByText(/表列表 \(4\)/)
    fireEvent.click(collapseHeader)

    expect(screen.getByText('REVENUE')).toBeInTheDocument()
    expect(screen.getByText('USERS')).toBeInTheDocument()
    expect(screen.getByText('ORDERS')).toBeInTheDocument()
    expect(screen.getByText('RAW_EVENTS')).toBeInTheDocument()
  })

  it('allows selecting a table from the list', () => {
    mockStore.datasourceId = 2
    render(<DataScopeSelector />)

    fireEvent.click(screen.getByText(/表列表 \(4\)/))
    fireEvent.click(screen.getByText('REVENUE'))

    expect(mockSetSelectedTables).toHaveBeenCalledWith(['REVENUE'])
  })

  it('allows deselecting a table by clicking again', () => {
    mockStore.datasourceId = 2
    mockStore.selectedTables = ['REVENUE', 'USERS']

    render(<DataScopeSelector />)

    fireEvent.click(screen.getByText(/表列表 \(4\)/))
    fireEvent.click(screen.getByText('REVENUE'))

    expect(mockSetSelectedTables).toHaveBeenCalledWith(['USERS'])
  })

  it('calls useSearchSchema when searching', async () => {
    mockStore.datasourceId = 2
    render(<DataScopeSelector />)

    const input = document.querySelector('.ant-input') as HTMLInputElement
    expect(input).toBeTruthy()

    fireEvent.change(input, { target: { value: 'revenue' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    await waitFor(() => {
      expect(mockSearchSchema).toHaveBeenCalledWith(2, 'revenue')
    })
  })

  it('displays search results grouped by matched_on', () => {
    mockStore.datasourceId = 2
    setSearchResults([
      {
        match_type: 'table',
        matched_on: 'table_name',
        schema_name: 'PUBLIC',
        table_name: 'REVENUE',
        table_comment: '收入表',
        column_name: null,
        table_id: 10,
      },
      {
        match_type: 'column',
        matched_on: 'column_comment',
        schema_name: 'PUBLIC',
        table_name: 'USERS',
        table_comment: null,
        column_name: 'REGION_NAME',
        table_id: 11,
      },
    ])

    render(<DataScopeSelector />)

    const input = document.querySelector('.ant-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'revenue' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(screen.getByText('表名匹配 (1)')).toBeInTheDocument()
    expect(screen.getByText('字段注释匹配 (1)')).toBeInTheDocument()
    expect(screen.getByText('PUBLIC.REVENUE')).toBeInTheDocument()
    expect(screen.getByText('PUBLIC.USERS')).toBeInTheDocument()
  })

  it('shows empty state when search returns no results', () => {
    mockStore.datasourceId = 2
    setSearchResults([])

    render(<DataScopeSelector />)

    const input = document.querySelector('.ant-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'nothing' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(screen.getByText(/未找到与 "nothing" 相关的表或字段/)).toBeInTheDocument()
  })
})
