import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { useSearchSchema } from './sqlWorkbench'

function Wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return React.createElement(
    QueryClientProvider,
    { client: queryClient },
    children,
  )
}

describe('useSearchSchema', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('calls /api/sql/schema/search (apiFetch prefixed path)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        {
          match_type: 'table',
          matched_on: 'table_name',
          schema_name: 'DW',
          table_name: 'T_ORDER',
          table_comment: '订单表',
          column_name: null,
          table_id: 1,
        },
      ]),
    })

    const { result } = renderHook(() => useSearchSchema(2, 'order'), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/sql/schema/search?datasource_id=2&q=order',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    )
  })

  it('does not fetch when datasourceId is null', () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })

    renderHook(() => useSearchSchema(null, 'order'), { wrapper: Wrapper })

    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not fetch when query is empty', () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })

    renderHook(() => useSearchSchema(2, ''), { wrapper: Wrapper })

    expect(fetch).not.toHaveBeenCalled()
  })
})
