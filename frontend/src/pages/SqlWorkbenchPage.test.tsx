import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SqlWorkbenchPage from './SqlWorkbenchPage'

const mockSetSql = vi.fn()
const mockSetDatasource = vi.fn()
const mockSearchParams = new URLSearchParams()
const mockSetSearchParams = vi.fn()

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
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
  useSqlDatasources: () => ({
    data: [
      { id: 1, name: '数据源 A' },
      { id: 3, name: '数据源 B' },
    ],
    isLoading: false,
  }),
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
  })

  it('reads sql and datasource_id from URL and sets store', async () => {
    mockSearchParams.set('sql', 'SELECT * FROM test')
    mockSearchParams.set('datasource_id', '3')

    render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockSetSql).toHaveBeenCalledWith('SELECT * FROM test')
    })
    expect(mockSetDatasource).toHaveBeenCalledWith(3, expect.anything())
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

  it('sets correct datasource name from list', async () => {
    mockSearchParams.set('sql', 'SELECT 1')
    mockSearchParams.set('datasource_id', '1')

    render(<SqlWorkbenchPage />)

    await waitFor(() => {
      expect(mockSetDatasource).toHaveBeenCalledWith(1, '数据源 A')
    })
  })
})
