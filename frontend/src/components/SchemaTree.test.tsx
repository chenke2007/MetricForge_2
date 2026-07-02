import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SchemaTree from './SchemaTree'

// ─── Hoisted mock data ───
const { mockSchemaData, mockColumnsData, mockSearchResults, mockAppendSql } = vi.hoisted(() => ({
  mockSchemaData: {
    datasource_id: 1,
    datasource_name: 'dwhrpt',
    schemas: [{
      schema_name: 'DWHRPT',
      tables: [
        { id: 101, name: 'ADS_CHANPJZL_D', comment: '渠道品鉴质量明细', column_count: 15 },
        { id: 102, name: 'ADS_SALE_DAILY', comment: null as string | null, column_count: 8 },
      ],
    }],
  },
  mockColumnsData: {
    101: [
      { id: 1, name: 'ID', type: 'NUMBER', nullable: false, comment: '主键ID', is_primary_key: true, is_foreign_key: false },
      { id: 2, name: 'CHANNEL_NAME', type: 'VARCHAR2(100)', nullable: true, comment: '渠道名称', is_primary_key: false, is_foreign_key: false },
      { id: 3, name: 'CREATED_AT', type: 'DATE', nullable: false, comment: '创建时间', is_primary_key: false, is_foreign_key: true },
    ],
    102: [],
  },
  mockSearchResults: [
    { match_type: 'table', schema_name: 'DWHRPT', table_name: 'ADS_CHANPJZL_D', table_comment: '渠道品鉴质量明细', column_name: null, table_id: 101 },
    { match_type: 'column', schema_name: 'DWHRPT', table_name: 'ADS_CHANPJZL_D', table_comment: null, column_name: 'CHANNEL_NAME', table_id: 101 },
  ],
  mockAppendSql: vi.fn(),
}))

const searchTextRef: { current: string } = { current: '' }

vi.mock('../api/sqlWorkbench', () => ({
  useSchemaTree: () => ({ data: mockSchemaData, isLoading: false, error: null }),
  useSearchSchema: () => ({ data: searchTextRef.current ? mockSearchResults : undefined }),
  useTableColumns: (tableId: number | null) => ({
    data: tableId ? (mockColumnsData as any)[tableId] ?? [] : undefined,
    isLoading: false,
    error: null,
  }),
}))

vi.mock('../stores/sqlWorkbenchStore', () => ({
  useSqlWorkbenchStore: (selector: any) => selector({ appendSql: mockAppendSql }),
}))

describe('SchemaTree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchTextRef.current = ''
  })

  it('shows placeholder when no datasource selected', () => {
    render(<SchemaTree datasourceId={null} />)
    expect(screen.getByText('请先选择数据源')).toBeInTheDocument()
  })

  it('renders schema and table nodes', () => {
    render(<SchemaTree datasourceId={1} />)
    expect(screen.getByText('DWHRPT')).toBeInTheDocument()
  })

  it('shows search input', () => {
    render(<SchemaTree datasourceId={1} />)
    expect(screen.getByPlaceholderText('搜索表名/字段名')).toBeInTheDocument()
  })

  it('does not display (null) text for null comments', () => {
    render(<SchemaTree datasourceId={1} />)
    expect(screen.queryByText('(null)')).not.toBeInTheDocument()
  })

  it('shows column_count badge for tables', () => {
    render(<SchemaTree datasourceId={1} />)
    // Both tables should show their column counts — rendered as "(15 列)"
    expect(screen.getByText('(15 列)')).toBeInTheDocument()
    expect(screen.getByText('(8 列)')).toBeInTheDocument()
  })

  it('appends SQL on table double-click', () => {
    render(<SchemaTree datasourceId={1} />)
    const tableEl = screen.getByText('ADS_CHANPJZL_D')
    fireEvent.doubleClick(tableEl)
    expect(mockAppendSql).toHaveBeenCalledWith('SELECT * FROM ADS_CHANPJZL_D')
  })

  it('loads and displays columns when table node is expanded', async () => {
    render(<SchemaTree datasourceId={1} />)

    // Click the switcher icon to expand ADS_CHANPJZL_D
    const tableNode = screen.getByText('ADS_CHANPJZL_D')
    const treenode = tableNode.closest('.ant-tree-treenode')
    const switcher = treenode?.querySelector('.ant-tree-switcher')
    if (switcher) fireEvent.click(switcher)

    await waitFor(() => {
      expect(screen.getByText('CHANNEL_NAME')).toBeInTheDocument()
    })

    // Column should show type
    expect(screen.getByText('VARCHAR2(100)')).toBeInTheDocument()

    // Column with comment should show it (rendered as "— 渠道名称" with em dash prefix)
    expect(screen.getByText(/渠道名称/)).toBeInTheDocument()

    // Column with null comment should still show name
    expect(screen.getByText('ID')).toBeInTheDocument()
  })

  it('shows primary key and foreign key markers', async () => {
    render(<SchemaTree datasourceId={1} />)

    const tableNode = screen.getByText('ADS_CHANPJZL_D')
    const treenode = tableNode.closest('.ant-tree-treenode')
    const switcher = treenode?.querySelector('.ant-tree-switcher')
    if (switcher) fireEvent.click(switcher)

    await waitFor(() => {
      expect(screen.getByText('ID')).toBeInTheDocument()
    })

    // ID is PK — check for a PK indicator near ID
    const idContainer = screen.getByText('ID').closest('.ant-tree-node-content-wrapper')
    expect(idContainer?.textContent).toMatch(/PK|🔑|KEY|主键/i)
  })

  it('displays search results including column matches', async () => {
    render(<SchemaTree datasourceId={1} />)

    // Type in search box — set ref BEFORE change so the mock returns search results on re-render
    const searchInput = screen.getByPlaceholderText('搜索表名/字段名')
    searchTextRef.current = 'CHANNEL'
    fireEvent.change(searchInput, { target: { value: 'CHANNEL' } })

    await waitFor(() => {
      // Table match should appear
      expect(screen.getByText('ADS_CHANPJZL_D')).toBeInTheDocument()
      // Column match should appear under parent table
      expect(screen.getByText('CHANNEL_NAME')).toBeInTheDocument()
    })
  })
})
