import { apiFetch } from './client'

/* ─── Types ─── */

export interface GovernanceTicketItem {
  id: number
  ticket_type: string
  title: string
  source: string
  related_object_type: string
  priority: string
  status: string
  assignee: string | null
  created_at: string
}

export interface GovernanceListResponse {
  items: GovernanceTicketItem[]
  pagination: {
    page: number
    per_page: number
    total: number
    total_pages: number
  }
}

export interface GovernanceFilters {
  status?: string
  ticket_type?: string
  source?: string
  page?: number
  per_page?: number
}

export interface FieldContext {
  id: number
  schema_name: string
  table_name: string
  column_name: string
  column_type: string
  nullable: boolean
  comment: string | null
  is_primary_key: boolean
  is_foreign_key: boolean
  enum_samples: string | null
}

export interface FieldSemanticData {
  id: number
  business_alias: string
  meaning: string
  unit: string | null
  enum_values: string | null
  data_quality_note: string | null
  is_governed: boolean
  governed_by: string | null
  governed_at: string | null
}

export interface GovernanceTicketDetail {
  id: number
  ticket_type: string
  title: string
  description: string | null
  source: string
  related_object_type: string | null
  related_object_id: number | null
  user_question: string | null
  priority: string
  status: string
  assignee: string | null
  resolution: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  field_context: FieldContext | null
  field_semantic: FieldSemanticData | null
}

export interface SaveSemanticInput {
  column_id: number
  business_alias: string
  meaning: string
  unit?: string | null
  enum_values?: string | null
  data_quality_note?: string | null
  governed_by?: string | null
}

export interface SaveSemanticResponse {
  message: string
  semantic_id: number
  closed_tickets: number
}

/* ─── Helpers ─── */

/**
 * PUT endpoints use URL query params (not JSON body).
 * This helper builds the query string and sends a PUT with no body.
 */
function apiPutQuery<T>(path: string, params: Record<string, string | number | null | undefined>): Promise<T> {
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      searchParams.set(key, String(value))
    }
  })
  const qs = searchParams.toString()
  return apiFetch<T>(`${path}${qs ? `?${qs}` : ''}`, { method: 'PUT' })
}

/* ─── Fetchers ─── */

export function fetchGovernanceTickets(filters: GovernanceFilters): Promise<GovernanceListResponse> {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.ticket_type) params.set('ticket_type', filters.ticket_type)
  if (filters.source) params.set('source', filters.source)
  if (filters.page) params.set('page', String(filters.page))
  if (filters.per_page) params.set('per_page', String(filters.per_page))
  const qs = params.toString()
  return apiFetch<GovernanceListResponse>(`/governance/${qs ? `?${qs}` : ''}`)
}

export function fetchGovernanceTicket(ticketId: number): Promise<GovernanceTicketDetail> {
  return apiFetch<GovernanceTicketDetail>(`/governance/${ticketId}`)
}

export function saveFieldSemantic(input: SaveSemanticInput): Promise<SaveSemanticResponse> {
  return apiPutQuery<SaveSemanticResponse>(`/field-semantics/columns/${input.column_id}`, {
    business_alias: input.business_alias,
    meaning: input.meaning,
    unit: input.unit,
    enum_values: input.enum_values,
    data_quality_note: input.data_quality_note,
    governed_by: input.governed_by,
  })
}

export function updateTicketStatus(ticketId: number, status: string, resolution?: string): Promise<{ message: string }> {
  return apiPutQuery<{ message: string }>(`/governance/${ticketId}/status`, {
    status,
    resolution: resolution || null,
  })
}

export function assignTicket(ticketId: number, assignee: string): Promise<{ message: string }> {
  return apiPutQuery<{ message: string }>(`/governance/${ticketId}/assign`, { assignee })
}
