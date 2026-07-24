import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import DataScopeBar from './DataScopeBar'

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

const mockUseSqlDatasources = vi.fn()
const mockUseSearchSchema = vi.fn()
const mockUseSchemaTree = vi.fn()

vi.mock('../api/sqlWorkbench', () => ({
  useSqlDatasources: (...args: any[]) => mockUseSqlDatasources(...args),
  useSearchSchema: (...args: any[]) => mockUseSearchSchema(...args),
  useSchemaTree: (...args: any[]) => mockUseSchemaTree(...args),
}))

const REVENUE_TABLE_HIT = {
  match_type: 'table' as const,
  matched_on: 'table_name' as const,
  schema_name: 'DWH',
  table_name: 'REVENUE',
  table_comment: null,
  column_name: null,
  table_id: 1,
}

const ORDERS_COLUMN_HIT_A = {
  match_type: 'column' as const,
  matched_on: 'column_name' as const,
  schema_name: 'DWH',
  table_name: 'ORDERS',
  table_comment: null,
  column_name: 'AMOUNT',
  table_id: 2,
}

const ORDERS_COLUMN_HIT_B = {
  ...ORDERS_COLUMN_HIT_A,
  matched_on: 'column_comment' as const,
  column_name: 'CURRENCY',
}

const SCHEMA_TREE = {
  datasource_id: 2,
  datasource_name: 'dwhrpt',
  schemas: [
    {
      schema_name: 'DWH',
      tables: [{ id: 1, name: 'REVENUE', comment: null, column_count: 5 }],
    },
    {
      schema_name: 'ODS',
      tables: [{ id: 2, name: 'ORDERS', comment: null, column_count: 8 }],
    },
  ],
}

function renderBar() {
  return render(<DataScopeBar />)
}

function lastSearchQuery() {
  const calls = mockUseSearchSchema.mock.calls
  return calls.length ? calls[calls.length - 1][1] : undefined
}

function lastSchemaTreeArg() {
  const calls = mockUseSchemaTree.mock.calls
  return calls.length ? calls[calls.length - 1][0] : undefined
}

/** 输入关键字并推进 300ms debounce，让搜索面板出现 */
function typeAndDebounce(value: string) {
  fireEvent.change(screen.getByPlaceholderText('搜索表名或字段名'), {
    target: { value },
  })
  act(() => {
    vi.advanceTimersByTime(300)
  })
}

describe('DataScopeBar', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    mockStore.datasourceId = null
    mockStore.datasourceName = null
    mockStore.selectedTables = []
    mockUseSqlDatasources.mockReturnValue({
      data: [
        { id: 1, name: 'oltp' },
        { id: 2, name: 'dwhrpt' },
      ],
      isLoading: false,
    })
    mockUseSearchSchema.mockReturnValue({ data: undefined, isLoading: false, isFetching: false })
    mockUseSchemaTree.mockReturnValue({ data: undefined, isLoading: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('搜索入口', () => {
    it('hides search input and browse entry when no datasource is selected', () => {
      renderBar()
      expect(screen.queryByPlaceholderText('搜索表名或字段名')).not.toBeInTheDocument()
      expect(screen.queryByText('浏览全部')).not.toBeInTheDocument()
    })

    it('shows search input and browse entry after a datasource is selected', () => {
      mockStore.datasourceId = 2
      mockStore.datasourceName = 'dwhrpt'
      renderBar()
      expect(screen.getByPlaceholderText('搜索表名或字段名')).toBeInTheDocument()
      expect(screen.getByText('浏览全部')).toBeInTheDocument()
    })

    it('debounces input by 300ms before passing the query to useSearchSchema', () => {
      vi.useFakeTimers()
      mockStore.datasourceId = 2
      renderBar()

      fireEvent.change(screen.getByPlaceholderText('搜索表名或字段名'), {
        target: { value: 'REV' },
      })
      act(() => {
        vi.advanceTimersByTime(299)
      })
      expect(lastSearchQuery()).toBe('')

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(lastSearchQuery()).toBe('REV')
    })

    it('does not use raw fetch for schema search', () => {
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)
      try {
        vi.useFakeTimers()
        mockStore.datasourceId = 2
        renderBar()
        typeAndDebounce('REV')
        expect(fetchSpy).not.toHaveBeenCalled()
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('搜索结果', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('renders schema_name.table_name with Chinese matched_on label', () => {
      mockStore.datasourceId = 2
      mockUseSearchSchema.mockReturnValue({
        data: [REVENUE_TABLE_HIT],
        isLoading: false,
        isFetching: false,
      })
      renderBar()
      typeAndDebounce('rev')

      expect(screen.getByText('DWH.REVENUE')).toBeInTheDocument()
      expect(screen.getByText('表名匹配')).toBeInTheDocument()
    })

    it('selects the owning SCHEMA.TABLE for column hits, without the column name', () => {
      mockStore.datasourceId = 2
      mockUseSearchSchema.mockReturnValue({
        data: [ORDERS_COLUMN_HIT_A],
        isLoading: false,
        isFetching: false,
      })
      renderBar()
      typeAndDebounce('amount')

      fireEvent.click(screen.getByText('DWH.ORDERS'))
      expect(mockSetSelectedTables).toHaveBeenCalledWith(['DWH.ORDERS'])
    })

    it('dedupes multiple column hits of the same table into a single entry', () => {
      mockStore.datasourceId = 2
      mockUseSearchSchema.mockReturnValue({
        data: [ORDERS_COLUMN_HIT_A, ORDERS_COLUMN_HIT_B],
        isLoading: false,
        isFetching: false,
      })
      renderBar()
      typeAndDebounce('orders')

      expect(screen.getAllByText('DWH.ORDERS')).toHaveLength(1)
      fireEvent.click(screen.getByText('DWH.ORDERS'))
      expect(mockSetSelectedTables).toHaveBeenCalledTimes(1)
      expect(mockSetSelectedTables).toHaveBeenCalledWith(['DWH.ORDERS'])
    })

    it('adds the full SCHEMA.OBJECT when a result is clicked', () => {
      mockStore.datasourceId = 2
      mockUseSearchSchema.mockReturnValue({
        data: [REVENUE_TABLE_HIT],
        isLoading: false,
        isFetching: false,
      })
      renderBar()
      typeAndDebounce('rev')

      fireEvent.click(screen.getByText('DWH.REVENUE'))
      expect(mockSetSelectedTables).toHaveBeenCalledWith(['DWH.REVENUE'])
    })

    it('does not re-add a table that is already selected', () => {
      mockStore.datasourceId = 2
      mockStore.selectedTables = ['DWH.REVENUE']
      mockUseSearchSchema.mockReturnValue({
        data: [REVENUE_TABLE_HIT],
        isLoading: false,
        isFetching: false,
      })
      renderBar()
      typeAndDebounce('rev')

      const results = screen.getAllByText('DWH.REVENUE')
      fireEvent.click(results[0])
      expect(mockSetSelectedTables).not.toHaveBeenCalled()
    })

    it('keeps the result panel in a predictable open state after selection', () => {
      mockStore.datasourceId = 2
      mockUseSearchSchema.mockReturnValue({
        data: [REVENUE_TABLE_HIT],
        isLoading: false,
        isFetching: false,
      })
      renderBar()
      typeAndDebounce('rev')

      fireEvent.click(screen.getByText('DWH.REVENUE'))
      expect(screen.getByText('DWH.REVENUE')).toBeInTheDocument()
    })

    it('does not fabricate a TABLE/VIEW type badge when object_type is absent', () => {
      mockStore.datasourceId = 2
      mockUseSearchSchema.mockReturnValue({
        data: [REVENUE_TABLE_HIT],
        isLoading: false,
        isFetching: false,
      })
      renderBar()
      typeAndDebounce('rev')

      expect(screen.queryByText(/^TABLE$/)).not.toBeInTheDocument()
      expect(screen.queryByText(/^VIEW$/)).not.toBeInTheDocument()
    })
  })

  describe('数据源切换', () => {
    it('selects another datasource and clears selected tables', async () => {
      mockStore.datasourceId = 1
      mockStore.datasourceName = 'oltp'
      mockStore.selectedTables = ['DWH.ORDERS']

      renderBar()

      const select = screen.getByRole('combobox')
      fireEvent.mouseDown(select)

      const option = await screen.findByTitle('dwhrpt')
      fireEvent.click(option)

      await waitFor(() => {
        expect(mockSetDatasource).toHaveBeenCalledWith(2, 'dwhrpt')
        expect(mockSetSelectedTables).toHaveBeenCalledWith([])
      })
    })

    it('clears datasource with null, not undefined, when allowClear is clicked', async () => {
      mockStore.datasourceId = 2
      mockStore.datasourceName = 'dwhrpt'
      mockStore.selectedTables = ['DWH.ORDERS']

      const { container } = renderBar()

      const clearIcon = container.querySelector('.ant-select-clear')
      expect(clearIcon).toBeTruthy()

      fireEvent.mouseDown(clearIcon!)

      await waitFor(() => {
        expect(mockSetDatasource).toHaveBeenCalledWith(null, null)
        expect(mockSetSelectedTables).toHaveBeenCalledWith([])
      })
    })

    it('clears query and search results when the datasource changes', () => {
      vi.useFakeTimers()
      mockStore.datasourceId = 2
      mockUseSearchSchema.mockReturnValue({
        data: [REVENUE_TABLE_HIT],
        isLoading: false,
        isFetching: false,
      })
      const { rerender } = renderBar()
      typeAndDebounce('rev')
      expect(screen.getByText('DWH.REVENUE')).toBeInTheDocument()

      mockStore.datasourceId = 1
      rerender(<DataScopeBar />)

      expect(
        (screen.getByPlaceholderText('搜索表名或字段名') as HTMLInputElement).value,
      ).toBe('')
      expect(screen.queryByText('DWH.REVENUE')).not.toBeInTheDocument()
      expect(lastSearchQuery()).toBe('')
    })
  })

  describe('已选标签', () => {
    it('renders selected tables as removable tags', () => {
      mockStore.datasourceId = 2
      mockStore.datasourceName = 'dwhrpt'
      mockStore.selectedTables = ['DWH.REVENUE', 'DWH.USERS']

      renderBar()

      expect(screen.getByText('已选 (2)')).toBeInTheDocument()
      const tagCloseButtons = screen.getAllByRole('img', { name: /close/i })
      expect(tagCloseButtons.length).toBe(2)

      fireEvent.click(tagCloseButtons[0])
      expect(mockSetSelectedTables).toHaveBeenCalledWith(['DWH.USERS'])
    })
  })

  describe('浏览全部 Drawer', () => {
    it('does not render the full table list on the page by default', () => {
      mockStore.datasourceId = 2
      mockUseSchemaTree.mockReturnValue({ data: SCHEMA_TREE, isLoading: false })
      renderBar()
      expect(screen.queryByText('ORDERS')).not.toBeInTheDocument()
      expect(screen.queryByText('REVENUE')).not.toBeInTheDocument()
    })

    it('opens the drawer when datasource exists and lazy-loads the schema tree', () => {
      mockStore.datasourceId = 2
      mockStore.datasourceName = 'dwhrpt'
      renderBar()

      expect(
        mockUseSchemaTree.mock.calls.every((call) => call[0] === null),
      ).toBe(true)

      fireEvent.click(screen.getByText('浏览全部'))

      expect(lastSchemaTreeArg()).toBe(2)
      expect(screen.getByText('浏览全部数据对象')).toBeInTheDocument()
    })

    it('lists objects grouped by schema and adds full SCHEMA.OBJECT on click', () => {
      mockStore.datasourceId = 2
      mockUseSchemaTree.mockReturnValue({ data: SCHEMA_TREE, isLoading: false })
      renderBar()

      fireEvent.click(screen.getByText('浏览全部'))
      expect(screen.getByText('DWH')).toBeInTheDocument()
      expect(screen.getByText('ODS')).toBeInTheDocument()

      fireEvent.click(screen.getByText('ORDERS'))
      expect(mockSetSelectedTables).toHaveBeenCalledWith(['ODS.ORDERS'])
    })

    it('marks selected objects and never adds duplicates', () => {
      mockStore.datasourceId = 2
      mockStore.selectedTables = ['ODS.ORDERS']
      mockUseSchemaTree.mockReturnValue({ data: SCHEMA_TREE, isLoading: false })
      renderBar()

      fireEvent.click(screen.getByText('浏览全部'))

      const ordersItem = screen.getByText('ORDERS').closest('[role="button"]')
      expect(ordersItem).toHaveAttribute('aria-pressed', 'true')

      fireEvent.click(screen.getByText('ORDERS'))
      expect(mockSetSelectedTables).not.toHaveBeenCalled()
    })

    it('removes the full table DOM after the drawer is closed', async () => {
      mockStore.datasourceId = 2
      mockUseSchemaTree.mockReturnValue({ data: SCHEMA_TREE, isLoading: false })
      renderBar()

      fireEvent.click(screen.getByText('浏览全部'))
      expect(screen.getByText('ORDERS')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: /close/i }))

      await waitFor(() => {
        expect(screen.queryByText('ORDERS')).not.toBeInTheDocument()
        expect(screen.queryByText('REVENUE')).not.toBeInTheDocument()
      })
    })

    it('shows an empty state instead of a placeholder when metadata is missing', () => {
      mockStore.datasourceId = 2
      mockUseSchemaTree.mockReturnValue({ data: undefined, isLoading: false })
      renderBar()

      fireEvent.click(screen.getByText('浏览全部'))
      expect(screen.getByText('该数据源尚未采集元数据')).toBeInTheDocument()
    })
  })
})
