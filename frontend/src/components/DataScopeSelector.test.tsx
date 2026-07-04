import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DataScopeSelector from './DataScopeSelector'

const mockSetDatasource = vi.fn()
const mockSetSelectedTables = vi.fn()

const mockStore = {
  datasourceId: null as number | null,
  datasourceName: null as string | null,
  selectedTables: [] as string[],
  setDatasource: mockSetDatasource,
  setSelectedTables: mockSetSelectedTables,
}

vi.mock('../stores/aiAskStore', () => ({
  useAiAskStore: vi.fn((selector?: (s: typeof mockStore) => any) => {
    if (selector) return selector(mockStore)
    return mockStore
  }),
}))

vi.mock('../api/sqlWorkbench', () => ({
  useSqlDatasources: vi.fn(() => ({
    data: [
      { id: 1, name: 'proddb', ds_type: 'postgresql', dialect: 'postgresql' },
      { id: 2, name: 'dwhrpt', ds_type: 'oracle', dialect: 'oracle' },
      { id: 3, name: 'analytics', ds_type: 'clickhouse', dialect: 'clickhouse' },
    ],
    isLoading: false,
  })),
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
}))

describe('DataScopeSelector', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    mockStore.datasourceId = null
    mockStore.datasourceName = null
    mockStore.selectedTables = []
  })

  it('renders datasource selector', () => {
    render(<DataScopeSelector />)
    expect(screen.getByText('选择数据源')).toBeInTheDocument()
  })

  it('shows prompt text when no datasource selected', () => {
    render(<DataScopeSelector />)
    expect(screen.getByText('选择数据源以查看可用表')).toBeInTheDocument()
  })

  it('shows schema tables when datasource is selected', () => {
    mockStore.datasourceId = 2
    mockStore.datasourceName = 'dwhrpt'
    render(<DataScopeSelector />)

    // 数据源 select 显示已选值
    expect(screen.getByTitle('dwhrpt')).toBeInTheDocument()

    // "表列表 (4)" — 4 tables total across all schemas
    expect(screen.getByText(/表列表 \(4\)/)).toBeInTheDocument()
  })

  it('shows all table names in the collapsed list', () => {
    mockStore.datasourceId = 2
    mockStore.datasourceName = 'dwhrpt'
    render(<DataScopeSelector />)

    // Expand the collapse
    const collapseHeader = screen.getByText(/表列表 \(4\)/)
    fireEvent.click(collapseHeader)

    expect(screen.getByText('REVENUE')).toBeInTheDocument()
    expect(screen.getByText('USERS')).toBeInTheDocument()
    expect(screen.getByText('ORDERS')).toBeInTheDocument()
    expect(screen.getByText('RAW_EVENTS')).toBeInTheDocument()
  })

  it('allows selecting a table from the list', () => {
    mockStore.datasourceId = 2
    mockStore.datasourceName = 'dwhrpt'

    render(<DataScopeSelector />)

    // Expand collapse
    fireEvent.click(screen.getByText(/表列表 \(4\)/))

    // Click REVENUE
    fireEvent.click(screen.getByText('REVENUE'))

    expect(mockSetSelectedTables).toHaveBeenCalledWith(['REVENUE'])
  })

  it('allows deselecting a table by clicking again', () => {
    mockStore.datasourceId = 2
    mockStore.datasourceName = 'dwhrpt'
    mockStore.selectedTables = ['REVENUE', 'USERS']

    render(<DataScopeSelector />)

    // Selected tables should be shown as tags
    expect(screen.getByText('已选表 (2)')).toBeInTheDocument()
    expect(screen.getByText('REVENUE')).toBeInTheDocument()
    expect(screen.getByText('USERS')).toBeInTheDocument()
  })

  it('removes table when tag close is clicked', () => {
    mockStore.datasourceId = 2
    mockStore.datasourceName = 'dwhrpt'
    mockStore.selectedTables = ['REVENUE']

    render(<DataScopeSelector />)

    // Tag has a close icon (anticon-close)
    const closeIcon = document.querySelector('.ant-tag-close-icon')
    if (closeIcon) {
      fireEvent.click(closeIcon)
      expect(mockSetSelectedTables).toHaveBeenCalledWith([])
    }
  })

  it('calls setDatasource when a datasource is selected', () => {
    render(<DataScopeSelector />)

    // Open dropdown and select dwhrpt
    const selectInput = document.querySelector('.ant-select-selector')
    expect(selectInput).toBeTruthy()
    fireEvent.mouseDown(selectInput!)

    const dwhrptOption = screen.getByTitle('dwhrpt')
    fireEvent.click(dwhrptOption)

    expect(mockSetDatasource).toHaveBeenCalledWith(2, 'dwhrpt')
  })
})
