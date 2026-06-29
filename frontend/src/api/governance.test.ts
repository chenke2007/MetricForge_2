import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiFetch } from './client'

// Mock apiFetch to intercept calls
vi.mock('./client', () => ({
  apiFetch: vi.fn(),
}))

import {
  fetchGovernanceTickets,
  saveFieldSemantic,
  updateTicketStatus,
  assignTicket,
} from './governance'

const mockApiFetch = vi.mocked(apiFetch)

describe('governance API client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetchGovernanceTickets builds correct query params', () => {
    mockApiFetch.mockResolvedValue({ items: [], pagination: { page: 1, per_page: 20, total: 0, total_pages: 0 } })

    fetchGovernanceTickets({ status: 'open', ticket_type: 'missing_semantic', source: 'auto_detect', page: 1, per_page: 20 })

    expect(mockApiFetch).toHaveBeenCalledWith(
      '/governance/?status=open&ticket_type=missing_semantic&source=auto_detect&page=1&per_page=20'
    )
  })

  it('fetchGovernanceTickets omits empty filters', () => {
    mockApiFetch.mockResolvedValue({ items: [], pagination: { page: 1, per_page: 20, total: 0, total_pages: 0 } })

    fetchGovernanceTickets({ page: 1, per_page: 20 })

    expect(mockApiFetch).toHaveBeenCalledWith('/governance/?page=1&per_page=20')
  })

  it('saveFieldSemantic uses PUT with URL query params', () => {
    mockApiFetch.mockResolvedValue({ message: 'ok', semantic_id: 42, closed_tickets: 1 })

    saveFieldSemantic({
      column_id: 42,
      business_alias: '合同编号',
      meaning: '合同唯一编码',
    })

    expect(mockApiFetch).toHaveBeenCalledWith(
      '/field-semantics/columns/42?business_alias=%E5%90%88%E5%90%8C%E7%BC%96%E5%8F%B7&meaning=%E5%90%88%E5%90%8C%E5%94%AF%E4%B8%80%E7%BC%96%E7%A0%81',
      { method: 'PUT' }
    )
  })

  it('saveFieldSemantic does not send JSON body', () => {
    mockApiFetch.mockResolvedValue({ message: 'ok', semantic_id: 42, closed_tickets: 1 })

    saveFieldSemantic({
      column_id: 42,
      business_alias: 'alias',
      meaning: 'meaning',
    })

    const callArg = mockApiFetch.mock.calls[0][1] as { method: string; body?: unknown }
    expect(callArg.method).toBe('PUT')
    expect(callArg.body).toBeUndefined()
  })

  it('updateTicketStatus uses PUT with query params', () => {
    mockApiFetch.mockResolvedValue({ message: 'ok' })

    updateTicketStatus(1, 'closed', '已完成')

    expect(mockApiFetch).toHaveBeenCalledWith(
      '/governance/1/status?status=closed&resolution=%E5%B7%B2%E5%AE%8C%E6%88%90',
      { method: 'PUT' }
    )
  })

  it('updateTicketStatus omits resolution when not provided', () => {
    mockApiFetch.mockResolvedValue({ message: 'ok' })

    updateTicketStatus(1, 'closed')

    expect(mockApiFetch).toHaveBeenCalledWith(
      '/governance/1/status?status=closed',
      { method: 'PUT' }
    )
  })

  it('assignTicket uses PUT with query params', () => {
    mockApiFetch.mockResolvedValue({ message: 'ok' })

    assignTicket(1, '张三')

    expect(mockApiFetch).toHaveBeenCalledWith(
      '/governance/1/assign?assignee=%E5%BC%A0%E4%B8%89',
      { method: 'PUT' }
    )
  })
})
