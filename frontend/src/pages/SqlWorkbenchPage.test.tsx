import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SqlWorkbenchPage from './SqlWorkbenchPage'

const mockSearchParams = new URLSearchParams()
const mockSetSearchParams = vi.fn()

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
}))

const mockDatasources = vi.hoisted(() => ({
  data: [{ id: 2, name: 'dwhrpt' }] as { id: number; name: string }[] | undefined,
  isLoading: false,
}))

const mockStore = vi.hoisted(() => ({
  datasourceId: null as number | null,
  datasourceName: null as string | null,
  sql: '',
  setDatasource: vi.fn((id: number, name: string | null) => {
    mockStore.datasourceId = id
    mockStore.datasourceName = name
  }),
  setSql: vi.fn((sql: string) => {
    mockStore.sql = sql
  }),
  setExecuting: vi.fn(),
  setResult: vi.fn(),
  showResult: vi.fn(),
  setChartConfig: vi.fn(),
  setResultView: vi.fn(),
}))

vi.mock('../stores/sqlWorkbenchStore', () => ({
  useSqlWorkbenchStore: (selector: any) => selector(mockStore),
}))

const mockExecute = vi.fn()

vi.mock('../api/sqlWorkbench', () => ({
  useSqlDatasources: () => mockDatasources,
  useExecuteSql: () => ({
    mutateAsync: mockExecute,
  }),
}))

vi.mock('../components/SchemaPanel', () => ({ default: () => <div /> }))
vi.mock('../components/SqlEditor', () => ({ default: () => <div /> }))
vi.mock('../components/ResultPanel', () => ({ default: () => <div /> }))
vi.mock('../components/BottomPanel', () => ({ default: () => <div /> }))
vi.mock('../components/DraftFormModal', () => ({ default: () => <div /> }))

// Mock ChartDraftList: expose onLoad callback so tests can simulate draft loading
const mockChartDraftListOnLoad = vi.fn()
vi.mock('../components/ChartDraftList', () => ({
  default: ({ onLoad }: any) => {
    mockChartDraftListOnLoad.mockImplementation(onLoad)
    return <div data-testid="chart-draft-list-mock">ChartDraftList</div>
  },
}))

// 透传型 mock Toolbar：暴露可点击的执行按钮
vi.mock('../components/SqlEditorToolbar', () => ({
  default: ({ onExecute }: any) => (
    <button data-testid="execute-btn" onClick={onExecute}>执行</button>
  ),
}))

describe('SqlWorkbenchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.datasourceId = null
    mockStore.datasourceName = null
    mockStore.sql = ''
    mockSearchParams.delete('sql')
    mockSearchParams.delete('datasource_id')
    mockDatasources.data = [{ id: 2, name: 'dwhrpt' }]
    mockDatasources.isLoading = false
  })

  it('reads sql and datasource_id from URL and sets store', async () => {
    mockSearchParams.set('sql', 'SELECT * FROM test')
    mockSearchParams.set('datasource_id', '2')

    render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockStore.sql).toBe('SELECT * FROM test')
    })
    expect(mockStore.datasourceId).toBe(2)
    expect(mockStore.datasourceName).toBe('dwhrpt')
  })

  it('clears URL params after consuming them', async () => {
    mockSearchParams.set('sql', 'SELECT 1')

    render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockSetSearchParams).toHaveBeenCalledWith({}, { replace: true })
    })
  })

  it('does nothing when URL has no sql param', () => {
    render(<SqlWorkbenchPage />)
    expect(mockStore.setSql).not.toHaveBeenCalled()
    expect(mockStore.setDatasource).not.toHaveBeenCalled()
  })

  it('does not call setDatasource when URL has sql but no datasource_id', async () => {
    mockSearchParams.set('sql', 'SELECT 1')

    render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockStore.sql).toBe('SELECT 1')
    })
    expect(mockStore.setDatasource).not.toHaveBeenCalled()
  })

  it('sets correct datasource name from list', async () => {
    mockSearchParams.set('sql', 'SELECT 1')
    mockSearchParams.set('datasource_id', '2')

    render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockStore.datasourceName).toBe('dwhrpt')
    })
  })

  it('sets datasource name after datasources load asynchronously', async () => {
    mockDatasources.data = undefined
    mockDatasources.isLoading = true
    mockSearchParams.set('sql', 'SELECT 1')
    mockSearchParams.set('datasource_id', '2')

    const { rerender } = render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockStore.sql).toBe('SELECT 1')
    })
    expect(mockStore.datasourceId).toBe(2)
    expect(mockStore.datasourceName).toBeNull()

    mockDatasources.data = [{ id: 2, name: 'dwhrpt' }]
    mockDatasources.isLoading = false
    rerender(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockStore.datasourceName).toBe('dwhrpt')
    })
  })

  it('does not update datasource name when pending id is not in datasources', async () => {
    mockDatasources.data = undefined
    mockDatasources.isLoading = true
    mockSearchParams.set('sql', 'SELECT 1')
    mockSearchParams.set('datasource_id', '999')

    const { rerender } = render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockStore.sql).toBe('SELECT 1')
    })
    expect(mockStore.datasourceId).toBe(999)
    expect(mockStore.datasourceName).toBeNull()

    mockDatasources.data = [{ id: 2, name: 'dwhrpt' }]
    mockDatasources.isLoading = false
    rerender(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockStore.setDatasource).toHaveBeenCalledTimes(1)
    })
  })

  it('triggers execute mutation when execute button clicked', async () => {
    mockSearchParams.set('sql', 'SELECT 1')
    mockSearchParams.set('datasource_id', '2')

    const { rerender } = render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockStore.sql).toBe('SELECT 1')
    })
    expect(mockStore.datasourceId).toBe(2)

    rerender(<SqlWorkbenchPage />)

    const executeBtn = screen.getByTestId('execute-btn')
    fireEvent.click(executeBtn)

    await waitFor(() => {
      expect(mockExecute).toHaveBeenCalledWith({
        datasource_id: 2,
        sql: 'SELECT 1',
      })
    })
  })

  it('shows chart drafts button on the page', () => {
    render(<SqlWorkbenchPage />)
    expect(screen.getByText('图表草稿')).toBeInTheDocument()
  })

  it('opens drawer when chart drafts button is clicked', () => {
    render(<SqlWorkbenchPage />)
    // Drawer should not be visible initially
    expect(screen.queryByTestId('chart-draft-list-mock')).not.toBeInTheDocument()
    // Click to open
    fireEvent.click(screen.getByText('图表草稿'))
    expect(screen.getByTestId('chart-draft-list-mock')).toBeInTheDocument()
  })

  it('loads chart draft data via onLoad callback', () => {
    const mockDraft = {
      id: 1,
      title: 'Test Chart',
      sqlText: 'SELECT * FROM test',
      datasourceId: 2,
      chartConfig: { chartType: 'bar' as const, xColumn: 'name' as const, yColumn: 'value' as const },
      datasourceAvailable: true,
      createdAt: '2026-06-30T10:00:00Z',
      updatedAt: '2026-06-30T12:00:00Z',
    }

    // Datasources are already loaded (mockDatasources.data = [{ id: 2, name: 'dwhrpt' }]),
    // so the callback will match and look up the datasource name
    render(<SqlWorkbenchPage />)
    fireEvent.click(screen.getByText('图表草稿'))

    // Trigger onLoad via the mocked component
    mockChartDraftListOnLoad(mockDraft)

    expect(mockStore.setSql).toHaveBeenCalledWith('SELECT * FROM test')
    expect(mockStore.setDatasource).toHaveBeenCalledWith(2, 'dwhrpt')
    expect(mockStore.setChartConfig).toHaveBeenCalledWith(mockDraft.chartConfig)
    expect(mockStore.setResultView).toHaveBeenCalledWith('chart')
  })
})
