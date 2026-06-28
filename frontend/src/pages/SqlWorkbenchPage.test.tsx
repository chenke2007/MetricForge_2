import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SqlWorkbenchPage from './SqlWorkbenchPage'

const mockSetSql = vi.fn()
const mockSetDatasource = vi.fn()
const mockSearchParams = new URLSearchParams()
const mockSetSearchParams = vi.fn()

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
}))

const mockDatasources = vi.hoisted(() => ({
  data: [
    { id: 1, name: '数据源 A' },
    { id: 3, name: '数据源 B' },
  ] as { id: number; name: string }[] | undefined,
  isLoading: false,
}))

vi.mock('../stores/sqlWorkbenchStore', () => ({
  useSqlWorkbenchStore: (selector: any) => {
    const store = {
      datasourceId: null,
      datasourceName: null,
      sql: '',
      setDatasource: mockSetDatasource,
      setSql: mockSetSql,
      setExecuting: vi.fn(),
      setResult: vi.fn(),
      showResult: vi.fn(),
    }
    return selector(store)
  },
}))

vi.mock('../api/sqlWorkbench', () => ({
  useSqlDatasources: () => mockDatasources,
  useExecuteSql: () => ({
    mutateAsync: vi.fn(),
  }),
}))

vi.mock('../components/SchemaPanel', () => ({ default: () => <div /> }))
vi.mock('../components/SqlEditor', () => ({ default: () => <div /> }))
vi.mock('../components/SqlEditorToolbar', () => ({ default: () => <div /> }))
vi.mock('../components/ResultPanel', () => ({ default: () => <div /> }))
vi.mock('../components/BottomPanel', () => ({ default: () => <div /> }))
vi.mock('../components/DraftFormModal', () => ({ default: () => <div /> }))

describe('SqlWorkbenchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams.delete('sql')
    mockSearchParams.delete('datasource_id')
    mockDatasources.data = [
      { id: 1, name: '数据源 A' },
      { id: 3, name: '数据源 B' },
    ]
    mockDatasources.isLoading = false
  })

  it('reads sql and datasource_id from URL and sets store', async () => {
    mockSearchParams.set('sql', 'SELECT * FROM test')
    mockSearchParams.set('datasource_id', '3')

    render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockSetSql).toHaveBeenCalledWith('SELECT * FROM test')
    })
    expect(mockSetDatasource).toHaveBeenCalledWith(3, '数据源 B')
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
    expect(mockSetSql).not.toHaveBeenCalled()
    expect(mockSetDatasource).not.toHaveBeenCalled()
  })

  it('does not call setDatasource when URL has sql but no datasource_id', async () => {
    mockSearchParams.set('sql', 'SELECT 1')

    render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockSetSql).toHaveBeenCalledWith('SELECT 1')
    })
    expect(mockSetDatasource).not.toHaveBeenCalled()
  })

  it('sets correct datasource name from list', async () => {
    mockSearchParams.set('sql', 'SELECT 1')
    mockSearchParams.set('datasource_id', '1')

    render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockSetDatasource).toHaveBeenCalledWith(1, '数据源 A')
    })
  })

  it('sets datasource name after datasources load asynchronously', async () => {
    mockDatasources.data = undefined
    mockDatasources.isLoading = true
    mockSearchParams.set('sql', 'SELECT 1')
    mockSearchParams.set('datasource_id', '1')

    const { rerender } = render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockSetSql).toHaveBeenCalledWith('SELECT 1')
    })
    expect(mockSetDatasource).toHaveBeenCalledWith(1, null)

    // 模拟数据源列表异步加载完成
    mockDatasources.data = [{ id: 1, name: '数据源 A' }]
    mockDatasources.isLoading = false
    rerender(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockSetDatasource).toHaveBeenCalledWith(1, '数据源 A')
    })
  })

  it('does not update datasource name when pending id is not in datasources', async () => {
    mockDatasources.data = undefined
    mockDatasources.isLoading = true
    mockSearchParams.set('sql', 'SELECT 1')
    mockSearchParams.set('datasource_id', '999')

    const { rerender } = render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockSetSql).toHaveBeenCalledWith('SELECT 1')
    })
    expect(mockSetDatasource).toHaveBeenCalledWith(999, null)

    // 数据源列表加载完成，但没有匹配的 id
    mockDatasources.data = [{ id: 1, name: '数据源 A' }]
    mockDatasources.isLoading = false
    rerender(<SqlWorkbenchPage />)

    // 不应再调用 setDatasource（因为没有匹配项）
    await waitFor(() => {
      expect(mockSetDatasource).toHaveBeenCalledTimes(1)
    })
  })
})
