import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import GovernanceList from './GovernanceList'
import type { GovernanceTicketItem } from '../api/governance'

const mockItems: GovernanceTicketItem[] = [
  {
    id: 1,
    ticket_type: 'missing_semantic',
    title: '字段 contract_code 缺少语义',
    source: 'auto_detect',
    related_object_type: 'column',
    priority: 'high',
    status: 'open',
    assignee: null,
    created_at: '2026-06-28 10:00:00',
  },
  {
    id: 2,
    ticket_type: 'metadata_column_deactivated',
    title: '字段 old_field 已停用',
    source: 'metadata_change_detected',
    related_object_type: 'column',
    priority: 'medium',
    status: 'open',
    assignee: '张三',
    created_at: '2026-06-28 09:00:00',
  },
]

describe('GovernanceList', () => {
  it('renders loading skeleton when loading', () => {
    const { container } = render(
      <GovernanceList
        items={[]}
        pagination={{ page: 1, total: 0, total_pages: 0 }}
        loading={true}
        pageSize={20}
        onPageChange={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    // Ant Design Table shows Spin when loading
    expect(container.querySelector('.ant-spin')).toBeTruthy()
  })

  it('renders empty state when no items', () => {
    render(
      <GovernanceList
        items={[]}
        pagination={{ page: 1, total: 0, total_pages: 0 }}
        loading={false}
        pageSize={20}
        onPageChange={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('暂无数据')).toBeTruthy()
  })

  it('renders ticket rows', () => {
    render(
      <GovernanceList
        items={mockItems}
        pagination={{ page: 1, total: 2, total_pages: 1 }}
        loading={false}
        pageSize={20}
        onPageChange={vi.fn()}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('字段 contract_code 缺少语义')).toBeTruthy()
    expect(screen.getByText('字段 old_field 已停用')).toBeTruthy()
  })

  it('calls onSelect when row clicked', () => {
    const onSelect = vi.fn()
    render(
      <GovernanceList
        items={mockItems}
        pagination={{ page: 1, total: 2, total_pages: 1 }}
        loading={false}
        pageSize={20}
        onPageChange={vi.fn()}
        onSelect={onSelect}
      />
    )
    fireEvent.click(screen.getByText('字段 contract_code 缺少语义'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('renders pagination and calls onPageChange', () => {
    const onPageChange = vi.fn()
    render(
      <GovernanceList
        items={mockItems}
        pagination={{ page: 1, total: 50, total_pages: 3 }}
        loading={false}
        pageSize={20}
        onPageChange={onPageChange}
        onSelect={vi.fn()}
      />
    )
    // Click page 2 button (AntD pagination items are <li> with <a>)
    const page2 = screen.getByTitle('2')
    fireEvent.click(page2)
    expect(onPageChange).toHaveBeenCalledWith(2, 20)
  })
})
