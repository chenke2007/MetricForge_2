import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'
import type { ChartConfig } from '../stores/sqlWorkbenchStore'

/* ─── Types ─── */

export interface ChartDraft {
  id: number
  title: string
  sqlText: string
  datasourceId: number | null
  chartConfig: ChartConfig
  datasourceAvailable: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateChartDraftInput {
  title?: string
  sqlText: string
  datasourceId?: number | null
  chartConfig: ChartConfig
}

export interface UpdateChartDraftInput {
  title?: string
  sqlText?: string
  datasourceId?: number | null
  chartConfig?: ChartConfig
}

/* ─── Field mapping ─── */

const camelToSnake: Record<string, string> = {
  // Only keys that differ between camelCase and snake_case need mapping.
  // `title` is identical in both and passes through unchanged.
  sqlText: 'sql_text',
  datasourceId: 'datasource_id',
  chartConfig: 'chart_config',
}

function toSnakeCase<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [camelToSnake[key] ?? key, value]),
  )
}

function toChartDraft(raw: Record<string, unknown>): ChartDraft {
  return {
    id: raw.id as number,
    title: raw.title as string,
    sqlText: raw.sql_text as string,
    datasourceId: (raw.datasource_id as number | null) ?? null,
    chartConfig: raw.chart_config as ChartConfig,
    datasourceAvailable: (raw.datasource_available as boolean) ?? false,
    createdAt: raw.created_at as string,
    updatedAt: raw.updated_at as string,
  }
}

/* ─── Fetchers ─── */

function fetchChartDrafts(): Promise<ChartDraft[]> {
  return apiFetch<Record<string, unknown>[]>('/chart-drafts').then((list) =>
    list.map(toChartDraft),
  )
}

function fetchChartDraft(id: number): Promise<ChartDraft> {
  return apiFetch<Record<string, unknown>>(`/chart-drafts/${id}`).then(toChartDraft)
}

function createChartDraft(input: CreateChartDraftInput): Promise<ChartDraft> {
  return apiFetch<Record<string, unknown>>('/chart-drafts', {
    method: 'POST',
    body: JSON.stringify(toSnakeCase(input as unknown as Record<string, unknown>)),
  }).then(toChartDraft)
}

function updateChartDraft(
  id: number,
  input: UpdateChartDraftInput,
): Promise<ChartDraft> {
  return apiFetch<Record<string, unknown>>(`/chart-drafts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(toSnakeCase(input as unknown as Record<string, unknown>)),
  }).then(toChartDraft)
}

function deleteChartDraft(id: number): Promise<void> {
  return apiFetch<void>(`/chart-drafts/${id}`, { method: 'DELETE' })
}

/* ─── Hooks ─── */

export function useChartDrafts() {
  return useQuery({
    queryKey: ['chart-drafts'],
    queryFn: fetchChartDrafts,
  })
}

export function useChartDraft(id: number | null) {
  return useQuery({
    queryKey: ['chart-drafts', id],
    queryFn: () => fetchChartDraft(id!),
    enabled: id !== null,
  })
}

export function useCreateChartDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createChartDraft,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chart-drafts'] })
    },
  })
}

export function useUpdateChartDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & UpdateChartDraftInput) =>
      updateChartDraft(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chart-drafts'] })
    },
  })
}

export function useDeleteChartDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteChartDraft,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chart-drafts'] })
    },
  })
}
