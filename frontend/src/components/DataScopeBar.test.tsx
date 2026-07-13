import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DataScopeBar from './DataScopeBar'

const mockSetDatasource = vi.fn()
const mockSetSelectedTables = vi.fn()
const mockToggleCollapse = vi.fn()

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
      { id: 1, name: 'oltp' },
      { id: 2, name: 'dwhrpt' },
    ],
    isLoading: false,
  })),
}))

function renderBar(props = {}) {
  return render(
    <DataScopeBar
      siderCollapsed={false}
      onToggleCollapse={mockToggleCollapse}
      {...props}
    />,
  )
}

describe('DataScopeBar', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    mockStore.datasourceId = null
    mockStore.datasourceName = null
    mockStore.selectedTables = []
  })

  it('renders current datasource and selected tables', () => {
    mockStore.datasourceId = 2
    mockStore.datasourceName = 'dwhrpt'
    mockStore.selectedTables = ['REVENUE', 'USERS']

    renderBar()

    expect(screen.getByTitle('dwhrpt')).toBeInTheDocument()
    expect(screen.getByText('已选 (2)')).toBeInTheDocument()
    expect(screen.getByText('REVENUE')).toBeInTheDocument()
    expect(screen.getByText('USERS')).toBeInTheDocument()
  })

  it('selects another datasource and clears selected tables', async () => {
    mockStore.datasourceId = 1
    mockStore.datasourceName = 'oltp'
    mockStore.selectedTables = ['ORDERS']

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
    mockStore.selectedTables = ['ORDERS']

    const { container } = renderBar()

    const clearIcon = container.querySelector('.ant-select-clear')
    expect(clearIcon).toBeTruthy()

    fireEvent.mouseDown(clearIcon!)

    await waitFor(() => {
      expect(mockSetDatasource).toHaveBeenCalledWith(null, null)
      expect(mockSetDatasource).not.toHaveBeenCalledWith(undefined, expect.anything())
      expect(mockSetDatasource).not.toHaveBeenCalledWith(expect.anything(), undefined)
      expect(mockSetSelectedTables).toHaveBeenCalledWith([])
    })
  })

  it('removes a selected table tag', () => {
    mockStore.datasourceId = 2
    mockStore.datasourceName = 'dwhrpt'
    mockStore.selectedTables = ['REVENUE', 'USERS']

    renderBar()

    const tagCloseButtons = screen.getAllByRole('img', { name: /close/i })
    expect(tagCloseButtons.length).toBe(2)

    fireEvent.click(tagCloseButtons[0])

    expect(mockSetSelectedTables).toHaveBeenCalledWith(['USERS'])
  })

  it('calls onToggleCollapse when the collapse button is clicked', () => {
    renderBar()

    fireEvent.click(screen.getByText('数据范围'))

    expect(mockToggleCollapse).toHaveBeenCalledTimes(1)
  })

  it('does not crash when no tables are selected', () => {
    mockStore.datasourceId = 1
    mockStore.datasourceName = 'oltp'
    mockStore.selectedTables = []

    renderBar()

    expect(screen.getByTitle('oltp')).toBeInTheDocument()
    expect(screen.queryByText('已选')).not.toBeInTheDocument()
  })
})
