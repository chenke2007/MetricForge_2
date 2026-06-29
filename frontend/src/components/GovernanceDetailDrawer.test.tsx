import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import GovernanceDetailDrawer from './GovernanceDetailDrawer'
import type { GovernanceTicketDetail, FieldContext } from '../api/governance'
import { useGovernanceTicket } from '../hooks/useGovernanceTicket'
import type { UseQueryResult } from '@tanstack/react-query'

const mockFieldContext: FieldContext = {
  id: 42,
  schema_name: 'DW',
  table_name: 'DW_CONTRACT',
  column_name: 'contract_code',
  column_type: 'VARCHAR2(50)',
  nullable: false,
  comment: '合同编号',
  is_primary_key: true,
  is_foreign_key: false,
  enum_samples: null,
}

const mockDetail: GovernanceTicketDetail = {
  id: 1,
  ticket_type: 'missing_semantic',
  title: '字段 contract_code 缺少语义',
  description: null,
  source: 'auto_detect',
  related_object_type: 'column',
  related_object_id: 42,
  user_question: null,
  priority: 'high',
  status: 'open',
  assignee: null,
  resolution: null,
  resolved_at: null,
  created_at: '2026-06-28 10:00:00',
  updated_at: '2026-06-28 10:00:00',
  field_context: mockFieldContext,
  field_semantic: null,
}

function makeMockQueryResult(overrides: Partial<UseQueryResult<GovernanceTicketDetail, Error>> = {}): UseQueryResult<GovernanceTicketDetail, Error> {
  return {
    data: undefined,
    dataUpdatedAt: 0,
    error: null,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    fetchStatus: 'idle',
    isError: false,
    isFetched: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isInitialLoading: false,
    isLoading: false,
    isLoadingError: false,
    isPaused: false,
    isPending: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: false,
    isSuccess: false,
    refetch: vi.fn(),
    status: 'pending',
    ...overrides,
  } as UseQueryResult<GovernanceTicketDetail, Error>
}

vi.mock('../hooks/useGovernanceTicket', () => ({
  useGovernanceTicket: vi.fn(),
}))

vi.mock('../hooks/useUpdateTicketStatus', () => ({
  useUpdateTicketStatus: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ message: 'ok' }),
    isPending: false,
  }),
  useAssignTicket: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ message: 'ok' }),
    isPending: false,
  }),
}))

describe('GovernanceDetailDrawer', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state when ticket is loading', () => {
    vi.mocked(useGovernanceTicket).mockReturnValue(makeMockQueryResult({
      isLoading: true,
      isPending: true,
      status: 'pending',
      fetchStatus: 'fetching',
    }))

    render(
      <GovernanceDetailDrawer
        open={true}
        ticketId={1}
        onClose={onClose}
      />
    )
    expect(screen.getByText('加载中...')).toBeTruthy()
  })

  it('shows 404 error when ticket not found', () => {
    vi.mocked(useGovernanceTicket).mockReturnValue(makeMockQueryResult({
      isError: true,
      isLoadingError: true,
      status: 'error',
      error: { status: 404, message: '治理待办不存在' } as unknown as Error,
    }))

    render(
      <GovernanceDetailDrawer
        open={true}
        ticketId={999}
        onClose={onClose}
      />
    )
    expect(screen.getByText('待办不存在')).toBeTruthy()
  })

  it('shows edit button for missing_semantic open ticket', () => {
    vi.mocked(useGovernanceTicket).mockReturnValue(makeMockQueryResult({
      data: mockDetail,
      isSuccess: true,
      status: 'success',
    }))

    render(
      <GovernanceDetailDrawer
        open={true}
        ticketId={1}
        onClose={onClose}
      />
    )
    expect(screen.getByRole('button', { name: /编\s*辑\s*字\s*段\s*语\s*义/ })).toBeTruthy()
  })

  it('hides edit button for non-missing_semantic ticket', () => {
    const nonSemanticDetail: GovernanceTicketDetail = {
      ...mockDetail,
      ticket_type: 'metadata_column_deactivated',
    }
    vi.mocked(useGovernanceTicket).mockReturnValue(makeMockQueryResult({
      data: nonSemanticDetail,
      isSuccess: true,
      status: 'success',
    }))

    render(
      <GovernanceDetailDrawer
        open={true}
        ticketId={1}
        onClose={onClose}
      />
    )
    expect(screen.queryByRole('button', { name: /编\s*辑\s*字\s*段\s*语\s*义/ })).toBeNull()
  })

  it('hides edit button when field_context is null', () => {
    const noFieldDetail: GovernanceTicketDetail = {
      ...mockDetail,
      field_context: null,
    }
    vi.mocked(useGovernanceTicket).mockReturnValue(makeMockQueryResult({
      data: noFieldDetail,
      isSuccess: true,
      status: 'success',
    }))

    render(
      <GovernanceDetailDrawer
        open={true}
        ticketId={1}
        onClose={onClose}
      />
    )
    expect(screen.queryByRole('button', { name: /编\s*辑\s*字\s*段\s*语\s*义/ })).toBeNull()
  })

  it('does not render when closed', () => {
    vi.mocked(useGovernanceTicket).mockReturnValue(makeMockQueryResult())

    const { container } = render(
      <GovernanceDetailDrawer
        open={false}
        ticketId={null}
        onClose={onClose}
      />
    )
    // Drawer should not be visible
    expect(container.querySelector('.ant-drawer-open')).toBeFalsy()
  })
})
