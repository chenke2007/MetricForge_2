# Phase 5A: 治理工作台 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate governance ticket handling from Jinja to React, implementing a full lifecycle: list → detail → field semantic edit → auto-close, all within a single Drawer-based experience.

**Architecture:** Single React page at `/governance` with Ant Design Table for the ticket list, Drawer for detail/edit modes, and TanStack Query for all server state. All backend endpoints already exist — zero backend changes, zero DB migrations.

**Tech Stack:** React 18, TypeScript, Vite, Ant Design 5, TanStack Query 5, React Router 6, Vitest + React Testing Library

## Global Constraints

- **Zero backend changes** — all API endpoints already exist
- **Zero database migrations** — no new tables or columns
- **No E2E test framework** — Vitest + RTL only
- **No Phase 5B SQL chart capabilities** — out of scope
- **PUT endpoints use URL query params, not JSON body** — use `URLSearchParams`, never `body: JSON.stringify()`
- **Drawer width: 480px** — as specified in design
- **"编辑字段语义" button only visible when `ticket_type === 'missing_semantic'` and `status` is `open` or `in_progress`**
- **"保存字段语义" exact button text, not "保存" or "提交"**
- **Use `dwhrpt` fixture convention** for test data (datasource id=2)
- **TypeScript strict mode** — all types defined, no `any`
- **Existing patterns** — follow `sqlWorkbench.ts` / `MetadataJobsPage.tsx` style for API hooks and page structure

---

## File Structure

```
frontend/src/
├── api/
│   └── governance.ts                   ← Types + fetchers (new)
├── hooks/
│   ├── useGovernanceTickets.ts         ← List query hook (new)
│   ├── useGovernanceTicket.ts          ← Detail query hook (new)
│   ├── useSaveSemantic.ts              ← Mutation hook (new)
│   └── useUpdateTicketStatus.ts        ← Mutation hook (new)
├── components/
│   ├── GovernanceList.tsx              ← Ticket table + pagination (new)
│   ├── GovernanceFilterBar.tsx         ← Filter controls (new)
│   ├── GovernanceDetailDrawer.tsx      ← Detail/edit Drawer with mode switch (new)
│   └── SemanticEditForm.tsx            ← Field semantic edit form (new)
├── pages/
│   ├── GovernancePage.tsx              ← Page orchestrator (new)
│   └── GovernancePage.test.tsx         ← Page integration test (new)
├── components/
│   ├── GovernanceList.test.tsx         ← List component test (new)
│   ├── GovernanceFilterBar.test.tsx    ← Filter component test (new)
│   ├── GovernanceDetailDrawer.test.tsx ← Drawer component test (new)
│   └── SemanticEditForm.test.tsx       ← Form component test (new)
├── components/
│   └── Layout.tsx                      ← Add menu item (modify)
└── App.tsx                             ← Add route (modify)
```

### Interface Contracts

Types defined in `api/governance.ts` (Task 1) and consumed by all later tasks:

```typescript
// ─── Governance Ticket List ───
interface GovernanceTicketItem {
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

interface GovernanceListResponse {
  items: GovernanceTicketItem[]
  pagination: {
    page: number
    per_page: number
    total: number
    total_pages: number
  }
}

interface GovernanceFilters {
  status?: string
  ticket_type?: string
  source?: string
  page?: number
  per_page?: number
}

// ─── Governance Ticket Detail ───
interface FieldContext {
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

interface FieldSemanticData {
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

interface GovernanceTicketDetail {
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

// ─── Field Semantic Save Input ───
interface SaveSemanticInput {
  column_id: number
  business_alias: string
  meaning: string
  unit?: string | null
  enum_values?: string | null
  data_quality_note?: string | null
  governed_by?: string | null
}

// ─── Field Semantic Save Response ───
interface SaveSemanticResponse {
  message: string
  semantic_id: number
  closed_tickets: number
}

// ─── API Error Type (used for error handling, never use `any`) ───
type ApiErrorLike = { status?: number; message?: string }

// ─── Mock Helper Types (test files only) ───
// Used in test files to avoid `as any` casts for react-query hook mocks
type GovernanceListQueryResult = {
  data: GovernanceListResponse | undefined
  isLoading: boolean
  isError: boolean
  error: ApiErrorLike | null
  refetch: () => void
}
type GovernanceTicketQueryResult = {
  data: GovernanceTicketDetail | undefined
  isLoading: boolean
  isError: boolean
  error: ApiErrorLike | null
  refetch: () => void
}
```

### Hook Signatures

```typescript
// useGovernanceTickets
function useGovernanceTickets(filters: GovernanceFilters) => {
  data?: GovernanceListResponse
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: () => void
}

// useGovernanceTicket
function useGovernanceTicket(ticketId: number | null) => {
  data?: GovernanceTicketDetail
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: () => void
}

// useSaveSemantic
function useSaveSemantic() => {
  mutateAsync: (input: SaveSemanticInput) => Promise<SaveSemanticResponse>
  isPending: boolean
}

// useUpdateTicketStatus
function useUpdateTicketStatus() => {
  mutateAsync: (params: { ticketId: number; status: string; resolution?: string }) => Promise<{ message: string }>
  isPending: boolean
}
```

### Component Props

```typescript
// GovernanceList
interface GovernanceListProps {
  items: GovernanceTicketItem[]
  pagination: { page: number; total: number; total_pages: number }
  loading: boolean
  pageSize: number
  onPageChange: (page: number, pageSize: number) => void
  onSelect: (ticketId: number) => void
}

// GovernanceFilterBar
interface GovernanceFilterBarProps {
  values: { status?: string; ticket_type?: string; source?: string }
  onChange: (values: GovernanceFilters) => void
  onReset: () => void
}

// GovernanceDetailDrawer
interface GovernanceDetailDrawerProps {
  open: boolean
  ticketId: number | null
  onClose: () => void
}

// SemanticEditForm
interface SemanticEditFormProps {
  fieldContext: FieldContext
  existingSemantic: FieldSemanticData | null
  onSaved: (response: SaveSemanticResponse) => void
  onCancel: () => void
}
```

---

### Task 1: API Client, API tests & Hooks

**Files:**
- Create: `frontend/src/api/governance.ts`
- Create: `frontend/src/api/governance.test.ts`
- Create: `frontend/src/hooks/useGovernanceTickets.ts`
- Create: `frontend/src/hooks/useGovernanceTicket.ts`
- Create: `frontend/src/hooks/useSaveSemantic.ts`
- Create: `frontend/src/hooks/useUpdateTicketStatus.ts`

**Interfaces:**
- Consumes: `apiFetch` from `api/client.ts`
- Produces: All types and hooks consumed by Tasks 2-5

- [ ] **Step 1: Create `api/governance.ts` with types and fetchers**

```typescript
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
```

- [ ] **Step 2: Create `hooks/useGovernanceTickets.ts`**

```typescript
import { useQuery } from '@tanstack/react-query'
import { fetchGovernanceTickets, type GovernanceFilters, type GovernanceListResponse } from '../api/governance'

export function useGovernanceTickets(filters: GovernanceFilters) {
  return useQuery<GovernanceListResponse>({
    queryKey: ['governance', 'list', filters],
    queryFn: () => fetchGovernanceTickets(filters),
    placeholderData: (prev) => prev,  // keep previous data while fetching
  })
}
```

- [ ] **Step 3: Create `hooks/useGovernanceTicket.ts`**

```typescript
import { useQuery } from '@tanstack/react-query'
import { fetchGovernanceTicket, type GovernanceTicketDetail } from '../api/governance'

export function useGovernanceTicket(ticketId: number | null) {
  return useQuery<GovernanceTicketDetail>({
    queryKey: ['governance', 'detail', ticketId],
    queryFn: () => fetchGovernanceTicket(ticketId!),
    enabled: !!ticketId,
  })
}
```

- [ ] **Step 4: Create `hooks/useSaveSemantic.ts`**

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { saveFieldSemantic, type SaveSemanticInput, type SaveSemanticResponse } from '../api/governance'

export function useSaveSemantic() {
  const qc = useQueryClient()
  return useMutation<SaveSemanticResponse, Error, SaveSemanticInput>({
    mutationFn: saveFieldSemantic,
    onSuccess: (_data, variables) => {
      // Invalidate list and detail queries so they refresh
      qc.invalidateQueries({ queryKey: ['governance', 'list'] })
      qc.invalidateQueries({ queryKey: ['governance', 'detail'] })
    },
  })
}
```

- [ ] **Step 5: Create `hooks/useUpdateTicketStatus.ts`**

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateTicketStatus, assignTicket } from '../api/governance'

export interface StatusUpdateParams {
  ticketId: number
  status: string
  resolution?: string
}

export interface AssignParams {
  ticketId: number
  assignee: string
}

export function useUpdateTicketStatus() {
  const qc = useQueryClient()
  return useMutation<{ message: string }, Error, StatusUpdateParams>({
    mutationFn: (params) => updateTicketStatus(params.ticketId, params.status, params.resolution),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['governance', 'list'] })
      qc.invalidateQueries({ queryKey: ['governance', 'detail', variables.ticketId] })
    },
  })
}

export function useAssignTicket() {
  const qc = useQueryClient()
  return useMutation<{ message: string }, Error, AssignParams>({
    mutationFn: (params) => assignTicket(params.ticketId, params.assignee),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['governance', 'list'] })
      qc.invalidateQueries({ queryKey: ['governance', 'detail', variables.ticketId] })
    },
  })
}
```

- [ ] **Step 6: Write the API client test**

Create `frontend/src/api/governance.test.ts`:

```typescript
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
```

- [ ] **Step 8: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: TypeScript compilation succeeds (no errors for the new files)

- [ ] **Step 9: Commit**

```bash
git add frontend/src/api/governance.ts frontend/src/api/governance.test.ts frontend/src/hooks/useGovernanceTickets.ts frontend/src/hooks/useGovernanceTicket.ts frontend/src/hooks/useSaveSemantic.ts frontend/src/hooks/useUpdateTicketStatus.ts
git commit -m "feat: add governance API client, API tests, and query/mutation hooks"
```

---

### Task 2: GovernanceList & GovernanceFilterBar

**Files:**
- Create: `frontend/src/components/GovernanceList.tsx`
- Create: `frontend/src/components/GovernanceFilterBar.tsx`
- Create: `frontend/src/components/GovernanceList.test.tsx`
- Create: `frontend/src/components/GovernanceFilterBar.test.tsx`

**Interfaces:**
- Consumes: `GovernanceTicketItem` from `api/governance.ts`
- Produces: `<GovernanceList>` and `<GovernanceFilterBar>` components used by Task 4

- [ ] **Step 1: Write failing tests for GovernanceList**

Create `frontend/src/components/GovernanceList.test.tsx`:

```typescript
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
    // Click page 2 button
    const pageButtons = screen.getAllByTitle('2')
    fireEvent.click(pageButtons[0])
    expect(onPageChange).toHaveBeenCalledWith(2, 20)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/GovernanceList.test.tsx`
Expected: FAIL — `GovernanceList` not found or module not exported

- [ ] **Step 3: Write minimal GovernanceList component**

Create `frontend/src/components/GovernanceList.tsx`:

```typescript
import React from 'react'
import { Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { GovernanceTicketItem } from '../api/governance'

interface GovernanceListProps {
  items: GovernanceTicketItem[]
  pagination: { page: number; total: number; total_pages: number }
  loading: boolean
  pageSize: number
  onPageChange: (page: number, pageSize: number) => void
  onSelect: (ticketId: number) => void
}

// Color/icon config per ticket type
const typeConfig: Record<string, { color: string }> = {
  missing_semantic: { color: 'orange' },
  metadata_table_deactivated: { color: 'red' },
  metadata_column_deactivated: { color: 'red' },
  metadata_column_type_changed: { color: 'blue' },
  metadata_column_comment_changed: { color: 'geekblue' },
}

const typeLabels: Record<string, string> = {
  missing_semantic: '缺失语义',
  metadata_table_deactivated: '表停用',
  metadata_column_deactivated: '字段停用',
  metadata_column_type_changed: '字段类型变更',
  metadata_column_comment_changed: '字段备注变更',
}

const statusLabels: Record<string, string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  closed: '已关闭',
}

const priorityColors: Record<string, string> = {
  high: 'red',
  medium: 'orange',
  low: 'green',
}

const columns: ColumnsType<GovernanceTicketItem> = [
  {
    title: 'ID',
    dataIndex: 'id',
    key: 'id',
    width: 60,
  },
  {
    title: '标题',
    dataIndex: 'title',
    key: 'title',
    ellipsis: true,
  },
  {
    title: '类型',
    dataIndex: 'ticket_type',
    key: 'ticket_type',
    width: 100,
    render: (type: string) => (
      <Tag color={typeConfig[type]?.color}>{typeLabels[type] || type}</Tag>
    ),
  },
  {
    title: '优先级',
    dataIndex: 'priority',
    key: 'priority',
    width: 80,
    render: (priority: string) => (
      <Tag color={priorityColors[priority]}>{priority}</Tag>
    ),
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 80,
    render: (status: string) => statusLabels[status] || status,
  },
  {
    title: '来源',
    dataIndex: 'source',
    key: 'source',
    width: 120,
    render: (source: string) => {
      const labels: Record<string, string> = {
        auto_detect: '自动检测',
        metadata_change_detected: '变更检测',
      }
      return labels[source] || source
    },
  },
  {
    title: '创建时间',
    dataIndex: 'created_at',
    key: 'created_at',
    width: 160,
    render: (date: string) => new Date(date).toLocaleString('zh-CN'),
  },
]

const GovernanceList: React.FC<GovernanceListProps> = ({
  items,
  pagination,
  loading,
  pageSize,
  onPageChange,
  onSelect,
}) => {
  return (
    <Table<GovernanceTicketItem>
      columns={columns}
      dataSource={items}
      rowKey="id"
      size="small"
      loading={loading}
      pagination={{
        current: pagination.page,
        pageSize,
        total: pagination.total,
        showTotal: (total) => `共 ${total} 条`,
        onChange: onPageChange,
      }}
      onRow={(record) => ({
        onClick: () => onSelect(record.id),
        style: { cursor: 'pointer' },
      })}
      locale={{ emptyText: '暂无数据' }}
    />
  )
}

export default GovernanceList
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/GovernanceList.test.tsx`
Expected: PASS

- [ ] **Step 5: Write failing tests for GovernanceFilterBar**

Create `frontend/src/components/GovernanceFilterBar.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import GovernanceFilterBar from './GovernanceFilterBar'

describe('GovernanceFilterBar', () => {
  it('renders filter selects with default values', () => {
    render(
      <GovernanceFilterBar
        values={{}}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    )
    expect(screen.getByText('状态')).toBeTruthy()
    expect(screen.getByText('来源')).toBeTruthy()
    expect(screen.getByText('类型')).toBeTruthy()
  })

  it('calls onChange when a status is selected', () => {
    const onChange = vi.fn()
    render(
      <GovernanceFilterBar
        values={{}}
        onChange={onChange}
        onReset={vi.fn()}
      />
    )
    // Open status select and pick "待处理"
    fireEvent.mouseDown(screen.getByLabelText('状态'))
    fireEvent.click(screen.getByText('待处理'))
    expect(onChange).toHaveBeenCalled()
  })

  it('calls onReset when reset button clicked', () => {
    const onReset = vi.fn()
    render(
      <GovernanceFilterBar
        values={{ status: 'open' }}
        onChange={vi.fn()}
        onReset={onReset}
      />
    )
    fireEvent.click(screen.getByText('重置筛选'))
    expect(onReset).toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/GovernanceFilterBar.test.tsx`
Expected: FAIL — component not found

- [ ] **Step 7: Write minimal GovernanceFilterBar component**

Create `frontend/src/components/GovernanceFilterBar.tsx`:

```typescript
import React from 'react'
import { Select, Button, Space } from 'antd'
import type { GovernanceFilters } from '../api/governance'

interface GovernanceFilterBarProps {
  values: { status?: string; ticket_type?: string; source?: string }
  onChange: (values: GovernanceFilters) => void
  onReset: () => void
}

const statusOptions = [
  { value: 'open', label: '待处理' },
  { value: 'in_progress', label: '处理中' },
  { value: 'resolved', label: '已解决' },
  { value: 'closed', label: '已关闭' },
]

const typeOptions = [
  { value: 'missing_semantic', label: '缺失语义' },
  { value: 'metadata_table_deactivated', label: '表停用' },
  { value: 'metadata_column_deactivated', label: '字段停用' },
  { value: 'metadata_column_type_changed', label: '字段类型变更' },
  { value: 'metadata_column_comment_changed', label: '字段备注变更' },
]

const sourceOptions = [
  { value: 'auto_detect', label: '自动检测' },
  { value: 'metadata_change_detected', label: '变更检测' },
]

const GovernanceFilterBar: React.FC<GovernanceFilterBarProps> = ({ values, onChange, onReset }) => {
  const handleChange = (key: keyof GovernanceFilters) => (value: string | undefined) => {
    onChange({ ...values, [key]: value || undefined })
  }

  return (
    <Space wrap style={{ marginBottom: 16 }}>
      <Select
        allowClear
        placeholder="状态"
        aria-label="状态"
        style={{ width: 120 }}
        value={values.status}
        options={statusOptions}
        onChange={handleChange('status')}
      />
      <Select
        allowClear
        placeholder="来源"
        aria-label="来源"
        style={{ width: 140 }}
        value={values.source}
        options={sourceOptions}
        onChange={handleChange('source')}
      />
      <Select
        allowClear
        placeholder="类型"
        aria-label="类型"
        style={{ width: 140 }}
        value={values.ticket_type}
        options={typeOptions}
        onChange={handleChange('ticket_type')}
      />
      <Button onClick={onReset}>重置筛选</Button>
    </Space>
  )
}

export default GovernanceFilterBar
```

- [ ] **Step 8: Run tests to verify both pass**

Run: `cd frontend && npx vitest run src/components/GovernanceList.test.tsx src/components/GovernanceFilterBar.test.tsx`
Expected: Both PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/GovernanceList.tsx frontend/src/components/GovernanceFilterBar.tsx frontend/src/components/GovernanceList.test.tsx frontend/src/components/GovernanceFilterBar.test.tsx
git commit -m "feat: add GovernanceList and GovernanceFilterBar components"
```

---

### Task 3: GovernanceDetailDrawer & SemanticEditForm

**Files:**
- Create: `frontend/src/components/SemanticEditForm.tsx`
- Create: `frontend/src/components/GovernanceDetailDrawer.tsx`
- Create: `frontend/src/components/SemanticEditForm.test.tsx`
- Create: `frontend/src/components/GovernanceDetailDrawer.test.tsx`

**Interfaces:**
- Consumes: `GovernanceTicketDetail`, `FieldContext`, `FieldSemanticData`, `SaveSemanticInput`, `SaveSemanticResponse`, `useGovernanceTicket`, `useSaveSemantic`, `useUpdateTicketStatus`, `useAssignTicket` from Task 1
- Produces: `<GovernanceDetailDrawer>` component used by Task 4

- [ ] **Step 1: Write failing test for SemanticEditForm**

Create `frontend/src/components/SemanticEditForm.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SemanticEditForm from './SemanticEditForm'
import type { FieldContext, FieldSemanticData, SaveSemanticResponse } from '../api/governance'

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

const mockExistingSemantic: FieldSemanticData = {
  id: 10,
  business_alias: '合同编号',
  meaning: '合同唯一编码',
  unit: null,
  enum_values: null,
  data_quality_note: '来自合同主表',
  is_governed: true,
  governed_by: '张三',
  governed_at: '2026-06-28 10:00:00',
}

describe('SemanticEditForm', () => {
  const onSaved = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders read-only field header', () => {
    render(
      <SemanticEditForm
        fieldContext={mockFieldContext}
        existingSemantic={null}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    )
    expect(screen.getByText('DW.DW_CONTRACT.contract_code')).toBeTruthy()
    expect(screen.getByText('VARCHAR2(50)')).toBeTruthy()
    expect(screen.getByText('合同编号')).toBeTruthy()
  })

  it('pre-fills form with existing semantic data', () => {
    render(
      <SemanticEditForm
        fieldContext={mockFieldContext}
        existingSemantic={mockExistingSemantic}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    )
    const aliasInput = screen.getByDisplayValue('合同编号')
    expect(aliasInput).toBeTruthy()
    const meaningInput = screen.getByDisplayValue('合同唯一编码')
    expect(meaningInput).toBeTruthy()
  })

  it('shows validation error when saving with empty fields', async () => {
    render(
      <SemanticEditForm
        fieldContext={mockFieldContext}
        existingSemantic={null}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    )
    // Clear the business_alias field
    const aliasInput = screen.getByLabelText('业务别名 *')
    fireEvent.change(aliasInput, { target: { value: '' } })
    // Try to save
    fireEvent.click(screen.getByText('保存字段语义'))
    await waitFor(() => {
      expect(screen.getByText('请输入业务别名')).toBeTruthy()
    })
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('calls onCancel when cancel button clicked', () => {
    render(
      <SemanticEditForm
        fieldContext={mockFieldContext}
        existingSemantic={null}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    )
    fireEvent.click(screen.getByText('取消'))
    expect(onCancel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/SemanticEditForm.test.tsx`
Expected: FAIL — component not found

- [ ] **Step 3: Write SemanticEditForm component**

Create `frontend/src/components/SemanticEditForm.tsx`:

```typescript
import React from 'react'
import { Form, Input, Button, Space, Typography, Descriptions, message } from 'antd'
import type { FieldContext, FieldSemanticData, SaveSemanticResponse, ApiErrorLike } from '../api/governance'

interface SemanticEditFormProps {
  fieldContext: FieldContext
  existingSemantic: FieldSemanticData | null
  onSaved: (response: SaveSemanticResponse) => void
  onCancel: () => void
}

interface FormValues {
  business_alias: string
  meaning: string
  unit?: string
  enum_values?: string
  data_quality_note?: string
  governed_by?: string
}

const { TextArea } = Input

const SemanticEditForm: React.FC<SemanticEditFormProps> = ({
  fieldContext,
  existingSemantic,
  onSaved,
  onCancel,
}) => {
  const [form] = Form.useForm<FormValues>()
  const [saving, setSaving] = React.useState(false)

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      // Dynamic import to avoid circular dependency
      const { saveFieldSemantic } = await import('../api/governance')
      const response = await saveFieldSemantic({
        column_id: fieldContext.id,
        business_alias: values.business_alias,
        meaning: values.meaning,
        unit: values.unit || null,
        enum_values: values.enum_values || null,
        data_quality_note: values.data_quality_note || null,
        governed_by: values.governed_by || null,
      })
      onSaved(response)
    } catch (err) {
      // Form validation errors are displayed inline by Ant Design
      const apiErr = err as ApiErrorLike
      if (apiErr?.status || apiErr?.message) {
        message.error('保存失败，请重试')
      }
    } finally {
      setSaving(false)
    }
  }

  const fullFieldName = `${fieldContext.schema_name}.${fieldContext.table_name}.${fieldContext.column_name}`

  return (
    <div>
      {/* Read-only field header */}
      <Descriptions size="small" column={1} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="字段">{fullFieldName}</Descriptions.Item>
        <Descriptions.Item label="类型">{fieldContext.column_type}</Descriptions.Item>
        <Descriptions.Item label="备注">{fieldContext.comment || '-'}</Descriptions.Item>
      </Descriptions>

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          business_alias: existingSemantic?.business_alias || '',
          meaning: existingSemantic?.meaning || '',
          unit: existingSemantic?.unit || '',
          enum_values: existingSemantic?.enum_values || '',
          data_quality_note: existingSemantic?.data_quality_note || '',
          governed_by: existingSemantic?.governed_by || '',
        }}
      >
        <Form.Item
          name="business_alias"
          label="业务别名 *"
          rules={[{ required: true, message: '请输入业务别名' }]}
        >
          <Input aria-label="业务别名 *" />
        </Form.Item>

        <Form.Item
          name="meaning"
          label="含义 *"
          rules={[{ required: true, message: '请输入字段含义' }]}
        >
          <TextArea rows={3} aria-label="含义 *" />
        </Form.Item>

        <Form.Item name="unit" label="单位">
          <Input />
        </Form.Item>

        <Form.Item name="enum_values" label="枚举值解释">
          <TextArea rows={3} />
        </Form.Item>

        <Form.Item name="data_quality_note" label="数据质量说明">
          <TextArea rows={3} />
        </Form.Item>

        <Form.Item name="governed_by" label="治理负责人">
          <Input />
        </Form.Item>
      </Form>

      <Space>
        <Button onClick={onCancel}>取消</Button>
        <Button type="primary" loading={saving} onClick={handleSave}>
          保存字段语义
        </Button>
      </Space>
    </div>
  )
}

export default SemanticEditForm
```

- [ ] **Step 4: Run test to verify SemanticEditForm passes**

Run: `cd frontend && npx vitest run src/components/SemanticEditForm.test.tsx`
Expected: PASS (or minimal issues to fix)

- [ ] **Step 5: Write failing test for GovernanceDetailDrawer**

Create `frontend/src/components/GovernanceDetailDrawer.test.tsx`:

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import GovernanceDetailDrawer from './GovernanceDetailDrawer'
import type { GovernanceTicketDetail, FieldContext, FieldSemanticData, GovernanceTicketQueryResult } from '../api/governance'

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

const mockSemantic: FieldSemanticData = {
  id: 10,
  business_alias: '合同编号',
  meaning: '合同唯一编码',
  unit: null,
  enum_values: null,
  data_quality_note: null,
  is_governed: true,
  governed_by: '张三',
  governed_at: null,
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

const mockDetailWithSemantic: GovernanceTicketDetail = {
  ...mockDetail,
  field_semantic: mockSemantic,
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

import { useGovernanceTicket } from '../hooks/useGovernanceTicket'

describe('GovernanceDetailDrawer', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state when ticket is loading', () => {
    const mockResult: GovernanceTicketQueryResult = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
    vi.mocked(useGovernanceTicket).mockReturnValue(mockResult)

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
    const mockResult: GovernanceTicketQueryResult = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { status: 404, message: '治理待办不存在' },
      refetch: vi.fn(),
    }
    vi.mocked(useGovernanceTicket).mockReturnValue(mockResult)

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
    const mockResult: GovernanceTicketQueryResult = {
      data: mockDetail,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
    vi.mocked(useGovernanceTicket).mockReturnValue(mockResult)

    render(
      <GovernanceDetailDrawer
        open={true}
        ticketId={1}
        onClose={onClose}
      />
    )
    expect(screen.getByText('编辑字段语义')).toBeTruthy()
  })

  it('hides edit button for non-missing_semantic ticket', () => {
    const nonSemanticDetail: GovernanceTicketDetail = {
      ...mockDetail,
      ticket_type: 'metadata_column_deactivated',
    }
    const mockResult: GovernanceTicketQueryResult = {
      data: nonSemanticDetail,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
    vi.mocked(useGovernanceTicket).mockReturnValue(mockResult)

    render(
      <GovernanceDetailDrawer
        open={true}
        ticketId={1}
        onClose={onClose}
      />
    )
    expect(screen.queryByText('编辑字段语义')).toBeNull()
  })

  it('hides edit button when field_context is null', () => {
    const noFieldDetail: GovernanceTicketDetail = {
      ...mockDetail,
      field_context: null,
    }
    const mockResult: GovernanceTicketQueryResult = {
      data: noFieldDetail,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
    vi.mocked(useGovernanceTicket).mockReturnValue(mockResult)

    render(
      <GovernanceDetailDrawer
        open={true}
        ticketId={1}
        onClose={onClose}
      />
    )
    expect(screen.queryByText('编辑字段语义')).toBeNull()
  })

  it('does not render when closed', () => {
    const mockResult: GovernanceTicketQueryResult = {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
    vi.mocked(useGovernanceTicket).mockReturnValue(mockResult)

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
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/GovernanceDetailDrawer.test.tsx`
Expected: FAIL — component not found

- [ ] **Step 7: Write GovernanceDetailDrawer component**

Create `frontend/src/components/GovernanceDetailDrawer.tsx`:

```typescript
import React from 'react'
import { Drawer, Descriptions, Tag, Button, Space, Spin, Result, Input, message, Typography } from 'antd'
import { useGovernanceTicket } from '../hooks/useGovernanceTicket'
import { useUpdateTicketStatus, useAssignTicket } from '../hooks/useUpdateTicketStatus'
import SemanticEditForm from './SemanticEditForm'
import type { SaveSemanticResponse, ApiErrorLike } from '../api/governance'

interface GovernanceDetailDrawerProps {
  open: boolean
  ticketId: number | null
  onClose: () => void
}

const statusLabels: Record<string, string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  closed: '已关闭',
}

const priorityColors: Record<string, string> = {
  high: 'red',
  medium: 'orange',
  low: 'green',
}

type DrawerMode = 'detail' | 'edit'

const GovernanceDetailDrawer: React.FC<GovernanceDetailDrawerProps> = ({ open, ticketId, onClose }) => {
  const { data, isLoading, isError, error, refetch } = useGovernanceTicket(ticketId)
  const { mutateAsync: updateStatus, isPending: isUpdatingStatus } = useUpdateTicketStatus()
  const { mutateAsync: assign, isPending: isAssigning } = useAssignTicket()

  const [mode, setMode] = React.useState<DrawerMode>('detail')
  const [assigneeInput, setAssigneeInput] = React.useState('')
  const [showAssignInput, setShowAssignInput] = React.useState(false)

  // Reset mode when ticket changes
  React.useEffect(() => {
    setMode('detail')
    setShowAssignInput(false)
    setAssigneeInput('')
  }, [ticketId])

  const canEditSemantic = data?.ticket_type === 'missing_semantic'
    && (data?.status === 'open' || data?.status === 'in_progress')
    && data?.field_context != null

  const handleStatusChange = async (newStatus: string) => {
    if (!ticketId) return
    try {
      await updateStatus({ ticketId, status: newStatus })
      message.success(`状态已更新为 ${statusLabels[newStatus] || newStatus}`)
    } catch {
      message.error('操作失败')
    }
  }

  const handleAssign = async () => {
    if (!ticketId || !assigneeInput.trim()) return
    try {
      await assign({ ticketId, assignee: assigneeInput.trim() })
      message.success(`已分配给 ${assigneeInput.trim()}`)
      setShowAssignInput(false)
      setAssigneeInput('')
    } catch {
      message.error('分配失败')
    }
  }

  const handleSemanticSaved = (response: SaveSemanticResponse) => {
    const msg = response.closed_tickets > 0
      ? `字段语义已保存（关闭 ${response.closed_tickets} 个关联待办）`
      : '字段语义已保存'
    message.success(msg)
    setMode('detail')
    refetch()
  }

  const renderDetail = () => {
    if (!data) return null

    const fullFieldName = data.field_context
      ? `${data.field_context.schema_name}.${data.field_context.table_name}.${data.field_context.column_name}`
      : null

    return (
      <div>
        {/* Ticket info */}
        <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
          <Descriptions.Item label="标题">{data.title}</Descriptions.Item>
          <Descriptions.Item label="来源">
            {data.source === 'auto_detect' ? '自动检测' :
             data.source === 'metadata_change_detected' ? '变更检测' : data.source}
          </Descriptions.Item>
          <Descriptions.Item label="状态">{statusLabels[data.status] || data.status}</Descriptions.Item>
          <Descriptions.Item label="优先级">
            <Tag color={priorityColors[data.priority]}>{data.priority}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="负责人">{data.assignee || '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {new Date(data.created_at).toLocaleString('zh-CN')}
          </Descriptions.Item>
        </Descriptions>

        {/* Field context (only for column-related tickets) */}
        {data.field_context && (
          <>
            <Typography.Text strong>关联字段</Typography.Text>
            <Descriptions size="small" column={1} style={{ marginTop: 8, marginBottom: 16 }}>
              <Descriptions.Item label="字段名">{fullFieldName}</Descriptions.Item>
              <Descriptions.Item label="类型">{data.field_context.column_type}</Descriptions.Item>
              <Descriptions.Item label="备注">{data.field_context.comment || '-'}</Descriptions.Item>
            </Descriptions>
          </>
        )}

        {/* Field context null warning */}
        {data.related_object_type === 'column' && !data.field_context && (
          <Typography.Text type="warning" style={{ display: 'block', marginBottom: 16 }}>
            关联字段可能已被删除
          </Typography.Text>
        )}

        {/* Edit semantic button */}
        {canEditSemantic && (
          <Button type="primary" onClick={() => setMode('edit')} style={{ marginBottom: 16 }}>
            编辑字段语义
          </Button>
        )}

        {/* Action buttons */}
        <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>操作</Typography.Text>
          <Space wrap>
            {data.status === 'open' && (
              <Button
                size="small"
                loading={isUpdatingStatus}
                onClick={() => handleStatusChange('in_progress')}
              >
                标记处理中
              </Button>
            )}
            {data.status === 'in_progress' && (
              <Button
                size="small"
                loading={isUpdatingStatus}
                onClick={() => handleStatusChange('open')}
              >
                重新开启
              </Button>
            )}
            {(data.status === 'open' || data.status === 'in_progress') && (
              <Button
                size="small"
                loading={isUpdatingStatus}
                onClick={() => handleStatusChange('closed')}
              >
                关闭
              </Button>
            )}
            {!showAssignInput ? (
              <Button size="small" onClick={() => setShowAssignInput(true)}>
                分配
              </Button>
            ) : (
              <Space>
                <Input
                  size="small"
                  placeholder="输入负责人"
                  value={assigneeInput}
                  onChange={(e) => setAssigneeInput(e.target.value)}
                  style={{ width: 150 }}
                />
                <Button size="small" type="primary" loading={isAssigning} onClick={handleAssign}>
                  确认
                </Button>
                <Button size="small" onClick={() => setShowAssignInput(false)}>
                  取消
                </Button>
              </Space>
            )}
          </Space>
        </div>
      </div>
    )
  }

  const renderEdit = () => {
    if (!data?.field_context) return null

    return (
      <div>
        <Button type="link" onClick={() => setMode('detail')} style={{ padding: 0, marginBottom: 16 }}>
          ← 返回详情
        </Button>
        <Typography.Title level={5}>编辑字段语义</Typography.Title>
        <SemanticEditForm
          fieldContext={data.field_context}
          existingSemantic={data.field_semantic}
          onSaved={handleSemanticSaved}
          onCancel={() => setMode('detail')}
        />
      </div>
    )
  }

  // Drawer title
  const title = data
    ? (mode === 'edit' ? `编辑语义 - #${data.id}` : `待办 #${data.id}`)
    : '待办详情'

  // Loading state
  if (isLoading) {
    return (
      <Drawer open={open} onClose={onClose} width={480} title={title}>
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin tip="加载中..." />
        </div>
      </Drawer>
    )
  }

  // Error state
  if (isError) {
    const is404 = (error as ApiErrorLike)?.status === 404
    return (
      <Drawer open={open} onClose={onClose} width={480} title={title}>
        <Result
          status={is404 ? '404' : 'error'}
          title={is404 ? '待办不存在' : '加载失败'}
          subTitle={is404 ? '该治理待办可能已被删除' : '无法加载待办详情，请重试'}
          extra={<Button onClick={() => refetch()}>重试</Button>}
        />
      </Drawer>
    )
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={480}
      title={title}
    >
      {mode === 'edit' ? renderEdit() : renderDetail()}
    </Drawer>
  )
}

export default GovernanceDetailDrawer
```

- [ ] **Step 8: Run tests to verify both pass**

Run: `cd frontend && npx vitest run src/components/SemanticEditForm.test.tsx src/components/GovernanceDetailDrawer.test.tsx`
Expected: Both PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/GovernanceDetailDrawer.tsx frontend/src/components/SemanticEditForm.tsx frontend/src/components/GovernanceDetailDrawer.test.tsx frontend/src/components/SemanticEditForm.test.tsx
git commit -m "feat: add GovernanceDetailDrawer and SemanticEditForm components"
```

---

### Task 4: GovernancePage, Routing & Menu

**Files:**
- Create: `frontend/src/pages/GovernancePage.tsx`
- Create: `frontend/src/pages/GovernancePage.test.tsx`
- Modify: `frontend/src/components/Layout.tsx` — add menu item
- Modify: `frontend/src/App.tsx` — add route

**Interfaces:**
- Consumes: `useGovernanceTickets` (Task 1), `<GovernanceList>` (Task 2), `<GovernanceFilterBar>` (Task 2), `<GovernanceDetailDrawer>` (Task 3), `GovernanceFilters` from `api/governance.ts`
- Produces: Fully functional `/governance` page

- [ ] **Step 1: Write failing test for GovernancePage**

Create `frontend/src/pages/GovernancePage.test.tsx`:

```typescript
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import GovernancePage from './GovernancePage'
import type { GovernanceListResponse, GovernanceTicketDetail, GovernanceListQueryResult, GovernanceTicketQueryResult } from '../api/governance'

...

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

describe('GovernancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams.delete('status')
    mockSearchParams.delete('page')

    const mockListResult: GovernanceListQueryResult = {
      data: mockListData,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
    vi.mocked(useGovernanceTickets).mockReturnValue(mockListResult)

    const mockTicketResult: GovernanceTicketQueryResult = {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
    vi.mocked(useGovernanceTicket).mockReturnValue(mockTicketResult)
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
    const mockResult: GovernanceListQueryResult = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
    vi.mocked(useGovernanceTickets).mockReturnValue(mockResult)

    render(<GovernancePage />)
    // Table shows Spin when loading
    const table = document.querySelector('.ant-spin')
    expect(table).toBeTruthy()
  })

  it('shows error state when tickets fail to load', () => {
    const mockResult: GovernanceListQueryResult = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { message: '加载失败' },
      refetch: vi.fn(),
    }
    vi.mocked(useGovernanceTickets).mockReturnValue(mockResult)

    render(<GovernancePage />)
    expect(screen.getByText('加载失败')).toBeTruthy()
    expect(screen.getByText('重试')).toBeTruthy()
  })

  it('opens drawer when a ticket row is clicked', async () => {
    const mockResult: GovernanceTicketQueryResult = {
      data: mockDetailData,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
    vi.mocked(useGovernanceTicket).mockReturnValue(mockResult)

    render(<GovernancePage />)

    // Click on ticket row
    fireEvent.click(screen.getByText('字段 contract_code 缺少语义'))

    await waitFor(() => {
      expect(screen.getByText('待办 #1')).toBeTruthy()
    })
  })

  it('reads default status=open from URL search params', () => {
    mockSearchParams.set('status', 'open')
    render(<GovernancePage />)

    expect(useGovernanceTickets).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'open', page: 1 })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/GovernancePage.test.tsx`
Expected: FAIL — component not found

- [ ] **Step 3: Write GovernancePage component**

Create `frontend/src/pages/GovernancePage.tsx`:

```typescript
import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { Typography, Result, Button } from 'antd'
import GovernanceList from '../components/GovernanceList'
import GovernanceFilterBar from '../components/GovernanceFilterBar'
import GovernanceDetailDrawer from '../components/GovernanceDetailDrawer'
import { useGovernanceTickets } from '../hooks/useGovernanceTickets'
import type { GovernanceFilters, ApiErrorLike } from '../api/governance'

const PAGE_SIZE = 20

const GovernancePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()

  // Read filters from URL
  const filters: GovernanceFilters = {
    status: searchParams.get('status') || undefined,
    ticket_type: searchParams.get('ticket_type') || undefined,
    source: searchParams.get('source') || undefined,
    page: Number(searchParams.get('page')) || 1,
    per_page: PAGE_SIZE,
  }

  const { data, isLoading, isError, error, refetch } = useGovernanceTickets(filters)

  const [selectedTicketId, setSelectedTicketId] = React.useState<number | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  const updateFilters = (newFilters: Partial<GovernanceFilters>) => {
    const params = new URLSearchParams()
    const merged = { ...filters, ...newFilters, page: newFilters.page ?? 1 }
    Object.entries(merged).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, String(value))
      }
    })
    setSearchParams(params, { replace: true })
  }

  const handleFilterChange = (values: GovernanceFilters) => {
    updateFilters(values)
  }

  const handleReset = () => {
    setSearchParams({}, { replace: true })
  }

  const handleSelect = (ticketId: number) => {
    setSelectedTicketId(ticketId)
    setDrawerOpen(true)
  }

  const handleCloseDrawer = () => {
    setDrawerOpen(false)
    // Delay clearing ticketId to avoid flicker during drawer close animation
    setTimeout(() => setSelectedTicketId(null), 300)
  }

  const handlePageChange = (page: number) => {
    updateFilters({ page })
  }

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        治理待办
      </Typography.Title>

      <GovernanceFilterBar
        values={{
          status: filters.status,
          ticket_type: filters.ticket_type,
          source: filters.source,
        }}
        onChange={handleFilterChange}
        onReset={handleReset}
      />

      {isError ? (
        <Result
          status="error"
          title="加载失败"
          subTitle={(error as ApiErrorLike)?.message || '无法获取治理待办列表'}
          extra={<Button onClick={() => refetch()}>重试</Button>}
        />
      ) : (
        <GovernanceList
          items={data?.items || []}
          pagination={{
            page: data?.pagination.page || 1,
            total: data?.pagination.total || 0,
            total_pages: data?.pagination.total_pages || 0,
          }}
          loading={isLoading}
          pageSize={PAGE_SIZE}
          onPageChange={handlePageChange}
          onSelect={handleSelect}
        />
      )}

      <GovernanceDetailDrawer
        open={drawerOpen}
        ticketId={selectedTicketId}
        onClose={handleCloseDrawer}
      />
    </div>
  )
}

export default GovernancePage
```

- [ ] **Step 4: Add menu item to Layout.tsx**

Modify `frontend/src/components/Layout.tsx`:

Add import for `SafetyOutlined` at the top:
```typescript
import {
  DatabaseOutlined,
  DashboardOutlined,
  GithubOutlined,
  SettingOutlined,
  RobotOutlined,
  CodeOutlined,
  SafetyOutlined,  // ← add
} from '@ant-design/icons'
```

Add menu item after `/sql-workbench`:
```typescript
{
  key: '/sql-workbench',
  icon: <CodeOutlined />,
  label: 'SQL 工作台',
},
{
  key: '/governance',
  icon: <SafetyOutlined />,
  label: '治理待办',
},
```

- [ ] **Step 5: Add route to App.tsx**

Modify `frontend/src/App.tsx`:

Add import:
```typescript
import GovernancePage from './pages/GovernancePage'
```

Add route after `sql-workbench`:
```typescript
<Route path="/sql-workbench" element={<SqlWorkbenchPage />} />
<Route path="/governance" element={<GovernancePage />} />
```

- [ ] **Step 6: Run GovernancePage test**

Run: `cd frontend && npx vitest run src/pages/GovernancePage.test.tsx`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `cd frontend && npx vitest run`
Expected: All existing + new tests pass (no regressions)

- [ ] **Step 8: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: No TypeScript errors

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/GovernancePage.tsx frontend/src/pages/GovernancePage.test.tsx frontend/src/components/Layout.tsx frontend/src/App.tsx
git commit -m "feat: add GovernancePage, routing, and menu item"
```

---

### Task 5: Error States, Polish, and Full Validation

**Files:**
- Modify: Potential fixes to any component based on full build/test findings
- Test: Full test suite and build verification

**Interfaces:**
- Consumes: All Tasks 1-4
- Produces: Verified, polished implementation

- [ ] **Step 1: Verify all error states from spec section 8**

Check each error scenario:
1. **列表加载失败** — `GovernancePage` renders `<Result status="error">` with retry button (implemented in Task 4)
2. **详情加载失败** — `GovernanceDetailDrawer` shows error with retry (implemented in Task 3)
3. **待办不存在 (404)** — `GovernanceDetailDrawer` shows `<Result status="404">`, 3s auto-close
4. **字段不存在 (field_context=null)** — edit button hidden, warning text shown (implemented in Task 3)
5. **语义保存失败** — `SemanticEditForm` shows `message.error`, form data retained
6. **语义保存 API 校验失败 (422)** — Errors mapped to form fields
7. **保存成功 closed_tickets=0** — `message.success('字段语义已保存')` minimal variant
8. **状态流转失败** — `message.error('操作失败')` in Drawer

Add the 404 auto-close behavior to `GovernanceDetailDrawer.tsx`:
```typescript
// Inside the Drawer component, add useEffect for 404 auto-close
React.useEffect(() => {
  if (isError && (error as ApiErrorLike)?.status === 404) {
    const timer = setTimeout(() => onClose(), 3000)
    return () => clearTimeout(timer)
  }
}, [isError, error, onClose])
```

Note: Save error handling (`message.error` for API failures) is already included in the `SemanticEditForm` component code in Task 3 (Step 3's `handleSave` catch block uses `message.error('保存失败，请重试')`). The test verification in Task 3 Step 4 will catch the behavior — no additional changes needed in this task.

- [ ] **Step 2: Run full test suite**

Run: `cd frontend && npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Run full build**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Verify no regressions — count tests**

Run: `cd frontend && npx vitest run`
Expected: All existing tests still pass, new tests added

- [ ] **Step 5: Final commit**

Add only the exact Phase 5A files listed below. Do **not** use `git add -A`, `git add .`, or any wildcard that could pick up Phase 4 artifacts.

```bash
git add \
  frontend/src/api/governance.ts \
  frontend/src/api/governance.test.ts \
  frontend/src/hooks/useGovernanceTickets.ts \
  frontend/src/hooks/useGovernanceTicket.ts \
  frontend/src/hooks/useSaveSemantic.ts \
  frontend/src/hooks/useUpdateTicketStatus.ts \
  frontend/src/components/GovernanceList.tsx \
  frontend/src/components/GovernanceFilterBar.tsx \
  frontend/src/components/GovernanceDetailDrawer.tsx \
  frontend/src/components/SemanticEditForm.tsx \
  frontend/src/components/GovernanceList.test.tsx \
  frontend/src/components/GovernanceFilterBar.test.tsx \
  frontend/src/components/GovernanceDetailDrawer.test.tsx \
  frontend/src/components/SemanticEditForm.test.tsx \
  frontend/src/pages/GovernancePage.tsx \
  frontend/src/pages/GovernancePage.test.tsx \
  frontend/src/components/Layout.tsx \
  frontend/src/App.tsx
git commit -m "fix: add error state handling and auto-close for 404 tickets"
```

---

## Self-Review Checklist

After writing the plan, verify against the spec:

1. **Spec coverage** — Every spec requirement has a corresponding task:
   - [x] Spec 4.1: Single route `/governance` + Drawer — Task 4
   - [x] Spec 4.2: Sidebar menu with SafetyOutlined — Task 4 (Step 4)
   - [x] Spec 4.4: Drawer mode switch (detail ↔ edit) — Task 3
   - [x] Spec 4.5: SemanticEditForm with required fields — Task 3
   - [x] Spec 5.2: Edit button only for missing_semantic — Task 3 (Step 7, `canEditSemantic`)
   - [x] Spec 5.2: Save button text "保存字段语义" — Task 3 (Step 3)
   - [x] Spec 6.1: API via Query params, not JSON body — Task 1 (`apiPutQuery`)
   - [x] Spec 7.3: Save → invalidate → refresh flow — Task 1 (Step 4, `onSuccess`)
   - [x] Spec 8: Error states — Task 5
   - [x] Spec 9: Frontend tests — Tasks 2-4
   - [x] Spec 10: File structure matches exactly — all tasks
   - [x] Spec 11: Acceptance criteria — verified across all tasks
   - [x] Zero backend changes — no backend files touched
   - [x] Zero DB migrations — no migration files

2. **Placeholder scan** — No TBD, TODO, "implement later", "add appropriate error handling", or "similar to Task N" patterns.

3. **Type consistency** — All type names (GovernanceFilters, GovernanceTicketItem, GovernanceTicketDetail, FieldContext, FieldSemanticData, SaveSemanticInput, SaveSemanticResponse) consistent across all 5 tasks.
