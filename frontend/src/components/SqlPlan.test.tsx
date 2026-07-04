import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SqlPlan from './SqlPlan'

const mockSqlPlan = {
  datasourceId: 2,
  datasourceName: 'dwhrpt',
  sql: 'SELECT * FROM REVENUE',
  tables: ['REVENUE', 'ORDERS'],
  fields: ['region', 'total_revenue', 'order_count'],
  assumptions: ['使用 SYSDATE 作为当前日期边界'],
  safetyWarnings: [],
}

function expandCollapse() {
  // Click the collapse header to expand the panel
  const header = screen.getByText('SQL 和查询计划').closest('.ant-collapse-header')
  if (header) fireEvent.click(header)
}

describe('SqlPlan', () => {
  it('renders collapsed header with datasource name and tables', () => {
    render(<SqlPlan sqlPlan={mockSqlPlan} />)
    expect(screen.getByText('SQL 和查询计划')).toBeInTheDocument()
    expect(screen.getByText('dwhrpt')).toBeInTheDocument()
    expect(screen.getByText(/REVENUE, ORDERS/)).toBeInTheDocument()
  })

  it('renders fields as tags after expanding', () => {
    render(<SqlPlan sqlPlan={mockSqlPlan} />)
    expandCollapse()
    expect(screen.getByText('region')).toBeInTheDocument()
    expect(screen.getByText('total_revenue')).toBeInTheDocument()
    expect(screen.getByText('order_count')).toBeInTheDocument()
  })

  it('renders SQL code after expanding', () => {
    render(<SqlPlan sqlPlan={mockSqlPlan} />)
    expandCollapse()
    expect(screen.getByText('SELECT * FROM REVENUE')).toBeInTheDocument()
  })

  it('renders assumptions after expanding', () => {
    render(<SqlPlan sqlPlan={mockSqlPlan} />)
    expandCollapse()
    expect(screen.getByText('AI 推断假设')).toBeInTheDocument()
    expect(screen.getByText(/使用 SYSDATE/)).toBeInTheDocument()
  })

  it('renders copy button after expanding', () => {
    render(<SqlPlan sqlPlan={mockSqlPlan} />)
    expandCollapse()
    expect(screen.getByText('复制 SQL')).toBeInTheDocument()
  })

  it('renders workbench button when onOpenInWorkbench provided', () => {
    const onOpen = vi.fn()
    render(<SqlPlan sqlPlan={mockSqlPlan} onOpenInWorkbench={onOpen} />)
    expandCollapse()
    expect(screen.getByText('在 SQL Workbench 中打开')).toBeInTheDocument()
  })

  it('calls onOpenInWorkbench when button clicked', () => {
    const onOpen = vi.fn()
    render(<SqlPlan sqlPlan={mockSqlPlan} onOpenInWorkbench={onOpen} />)
    expandCollapse()
    fireEvent.click(screen.getByText('在 SQL Workbench 中打开'))
    expect(onOpen).toHaveBeenCalledWith('SELECT * FROM REVENUE', 2)
  })

  it('does not render assumptions section when empty', () => {
    const noAssumptions = { ...mockSqlPlan, assumptions: [] }
    render(<SqlPlan sqlPlan={noAssumptions} />)
    expandCollapse()
    expect(screen.queryByText('AI 推断假设')).not.toBeInTheDocument()
  })

  it('renders safety warnings when present', () => {
    const withWarnings = {
      ...mockSqlPlan,
      safetyWarnings: ['全表扫描可能影响性能'],
    }
    render(<SqlPlan sqlPlan={withWarnings} />)
    expandCollapse()
    expect(screen.getByText('全表扫描可能影响性能')).toBeInTheDocument()
  })
})
