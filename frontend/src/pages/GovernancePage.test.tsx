import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import GovernancePage from './GovernancePage'
import type { GovernanceListResponse, GovernanceTicketDetail } from '../api/governance'

const mockSearchParams = new URLSearchParams()
const mockSetSearchParams = vi.fn()

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
  useNavigate: () => vi.fn(),
}))

const mockListData: GovernanceListResponse = {
  items: [
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
  ],
  pagination: { page: 1, per_page: 20, total: 1, total_pages: 1 },
}

const mockDetailData: GovernanceTicketDetail = {
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
  field_context: {
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
  },
  field_semantic: null,
}

vi.mock('../hooks/useGovernanceTickets', () => ({
  useGovernanceTickets: vi.fn(),
}))

vi.mock('../hooks/useGovernanceTicket', () => ({
  useGovernanceTicket: vi.fn(),
}))

vi.mock('../hooks/useSaveSemantic', () => ({
  useSaveSemantic: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('../hooks/useUpdateTicketStatus', () => ({
  useUpdateTicketStatus: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useAssignTicket: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

import { useGovernanceTickets } from '../hooks/useGovernanceTickets'
import { useGovernanceTicket } from '../hooks/useGovernanceTicket'

// Minimal subset of UseQueryResult fields for mock compatibility
type MockQueryResult<T> = {
  data: T | undefined
  isLoading: boolean
  isError: boolean
  error: { message: string } | null
  refetch: ReturnType<typeof vi.fn>
}

describe('GovernancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams.delete('status')
    mockSearchParams.delete('page')

    const mockListResult: MockQueryResult<GovernanceListResponse> = {
      data: mockListData,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
    vi.mocked(useGovernanceTickets).mockReturnValue(mockListResult as unknown as ReturnType<typeof useGovernanceTickets>)

    const mockTicketResult: MockQueryResult<GovernanceTicketDetail> = {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
    vi.mocked(useGovernanceTicket).mockReturnValue(mockTicketResult as unknown as ReturnType<typeof useGovernanceTicket>)
  })

  it('renders page title and filter bar', () => {
    render(<GovernancePage />)
    expect(screen.getByText('治理待办')).toBeTruthy()
  })

  it('renders ticket list', () => {
    render(<GovernancePage />)
    expect(screen.getByText('字段 contract_code 缺少语义')).toBeTruthy()
  })

  it('shows loading state when tickets are loading', () => {
    const mockResult: MockQueryResult<GovernanceListResponse> = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
    vi.mocked(useGovernanceTickets).mockReturnValue(mockResult as unknown as ReturnType<typeof useGovernanceTickets>)

    render(<GovernancePage />)
    // Table shows Spin when loading; use accessible role if available
    const progressbar = document.querySelector('.ant-spin') || screen.queryByRole('progressbar')
    expect(progressbar).toBeTruthy()
  })

  it('shows error state when tickets fail to load', () => {
    const mockResult: MockQueryResult<GovernanceListResponse> = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { message: '加载失败' },
      refetch: vi.fn(),
    }
    vi.mocked(useGovernanceTickets).mockReturnValue(mockResult as unknown as ReturnType<typeof useGovernanceTickets>)

    render(<GovernancePage />)
    expect(screen.getAllByText('加载失败').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: /重\s*试/ })).toBeTruthy()
  })

  it('opens drawer when a ticket row is clicked', async () => {
    const mockResult: MockQueryResult<GovernanceTicketDetail> = {
      data: mockDetailData,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
    vi.mocked(useGovernanceTicket).mockReturnValue(mockResult as unknown as ReturnType<typeof useGovernanceTicket>)

    render(<GovernancePage />)

    // Click on ticket row
    fireEvent.click(screen.getByText('字段 contract_code 缺少语义'))

    await waitFor(() => {
      expect(screen.getByText('待办 #1')).toBeTruthy()
    })
  })

  it('resets page to 1 when a filter changes', () => {
    // Simulate being on page 2
    mockSearchParams.set('page', '2')
    render(<GovernancePage />)

    // Open status select and pick a filter value
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '状态' }))
    const options = screen.getAllByText('待处理')
    fireEvent.click(options[options.length - 1])

    // setSearchParams should have been called with page=1
    const lastCall = mockSetSearchParams.mock.calls[mockSetSearchParams.mock.calls.length - 1]
    const params = lastCall[0] as URLSearchParams
    expect(params.get('page')).toBe('1')
    expect(params.get('status')).toBe('open')
  })
})
