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
})
