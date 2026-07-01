import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useChartDrafts,
  useChartDraft,
  useCreateChartDraft,
  useUpdateChartDraft,
  useDeleteChartDraft,
} from './chartDrafts'
import type { ChartDraft, CreateChartDraftInput, UpdateChartDraftInput } from './chartDrafts'

const mockFetch = vi.fn()
const originalFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = mockFetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  mockFetch.mockReset()
})

function createWrapper() {
  return ({ children }: { children: React.ReactNode }) => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return React.createElement(QueryClientProvider, { client: qc }, children)
  }
}

const mockChartDraftResponse = {
  id: 1,
  title: 'Test Chart',
  sql_text: 'SELECT 1',
  datasource_id: null,
  chart_config: { chartType: 'bar', xColumn: 'a', yColumn: 'b' },
  datasource_available: false,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
}

describe('chartDrafts API', () => {
  /* ─── useChartDrafts (list) ─── */
  describe('useChartDrafts', () => {
    it('fetches chart drafts and maps snake_case to camelCase', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [mockChartDraftResponse],
      })

      const { result } = renderHook(() => useChartDrafts(), {
        wrapper: createWrapper(),
      })
      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      const drafts = result.current.data as ChartDraft[]
      expect(drafts).toHaveLength(1)
      expect(drafts[0].id).toBe(1)
      expect(drafts[0].title).toBe('Test Chart')
      expect(drafts[0].sqlText).toBe('SELECT 1')
      expect(drafts[0].datasourceId).toBeNull()
      expect(drafts[0].chartConfig).toEqual({ chartType: 'bar', xColumn: 'a', yColumn: 'b' })
      expect(drafts[0].datasourceAvailable).toBe(false)
      expect(drafts[0].createdAt).toBe('2026-07-01T00:00:00Z')
      expect(drafts[0].updatedAt).toBe('2026-07-01T00:00:00Z')
    })

    it('calls the correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })

      renderHook(() => useChartDrafts(), { wrapper: createWrapper() })
      await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
        '/api/chart-drafts',
        expect.any(Object),
      ))
    })
  })

  /* ─── useChartDraft (single) ─── */
  describe('useChartDraft', () => {
    it('fetches a single chart draft by id', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockChartDraftResponse,
      })

      const { result } = renderHook(() => useChartDraft(1), {
        wrapper: createWrapper(),
      })
      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      const draft = result.current.data as ChartDraft
      expect(draft.id).toBe(1)
      expect(draft.sqlText).toBe('SELECT 1')
      expect(draft.datasourceAvailable).toBe(false)
    })

    it('calls the correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockChartDraftResponse,
      })

      renderHook(() => useChartDraft(1), { wrapper: createWrapper() })
      await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
        '/api/chart-drafts/1',
        expect.any(Object),
      ))
    })
  })

  /* ─── useCreateChartDraft ─── */
  describe('useCreateChartDraft', () => {
    it('creates a chart draft and maps camelCase input to snake_case payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockChartDraftResponse,
      })

      const { result } = renderHook(() => useCreateChartDraft(), {
        wrapper: createWrapper(),
      })

      const input: CreateChartDraftInput = {
        title: 'New Chart',
        sqlText: 'SELECT 2',
        datasourceId: 3,
        chartConfig: { chartType: 'line', xColumn: 'x', yColumn: 'y' },
      }

      result.current.mutate(input)
      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/chart-drafts',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            title: 'New Chart',
            sql_text: 'SELECT 2',
            datasource_id: 3,
            chart_config: { chartType: 'line', xColumn: 'x', yColumn: 'y' },
          }),
        }),
      )

      const draft = result.current.data as ChartDraft
      expect(draft.sqlText).toBe('SELECT 1')
      expect(draft.datasourceAvailable).toBe(false)
    })
  })

  /* ─── useUpdateChartDraft ─── */
  describe('useUpdateChartDraft', () => {
    it('updates a chart draft and maps camelCase input to snake_case payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...mockChartDraftResponse,
          title: 'Updated',
          sql_text: 'SELECT 3',
        }),
      })

      const { result } = renderHook(() => useUpdateChartDraft(), {
        wrapper: createWrapper(),
      })

      const input: UpdateChartDraftInput = {
        title: 'Updated',
        sqlText: 'SELECT 3',
      }

      result.current.mutate({ id: 1, ...input })
      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/chart-drafts/1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            title: 'Updated',
            sql_text: 'SELECT 3',
          }),
        }),
      )

      const draft = result.current.data as ChartDraft
      expect(draft.title).toBe('Updated')
      expect(draft.sqlText).toBe('SELECT 3')
    })
  })

  /* ─── useDeleteChartDraft ─── */
  describe('useDeleteChartDraft', () => {
    it('deletes a chart draft', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })

      const { result } = renderHook(() => useDeleteChartDraft(), {
        wrapper: createWrapper(),
      })

      result.current.mutate(1)
      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/chart-drafts/1',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
  })

  /* ─── Type-level checks ─── */
  describe('types', () => {
    it('ChartDraft has camelCase fields and datasource_available', () => {
      const draft: ChartDraft = {
        id: 1,
        title: 'T',
        sqlText: 'SELECT 1',
        datasourceId: null,
        chartConfig: { chartType: 'bar', xColumn: 'a', yColumn: 'b' },
        datasourceAvailable: false,
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
      }
      expect(draft.sqlText).toBe('SELECT 1')
      expect(draft.datasourceAvailable).toBe(false)
      expect(draft.chartConfig.chartType).toBe('bar')
    })

    it('CreateChartDraftInput has camelCase fields', () => {
      const input: CreateChartDraftInput = {
        title: 'T',
        sqlText: 'SELECT 1',
        datasourceId: 1,
        chartConfig: { chartType: 'pie', xColumn: 'a', yColumn: 'b' },
      }
      expect(input.sqlText).toBe('SELECT 1')
      expect(input.datasourceId).toBe(1)
    })

    it('UpdateChartDraftInput has optional camelCase fields', () => {
      const input: UpdateChartDraftInput = {
        chartConfig: { chartType: 'line', xColumn: 'x', yColumn: 'y' },
      }
      expect(input.chartConfig?.chartType).toBe('line')
    })
  })
})
