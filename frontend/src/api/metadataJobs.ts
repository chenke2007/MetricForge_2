import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'

export interface MetadataCollectionJob {
  id: number
  datasource_id: number
  status: string
  triggered_by: string | null
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  tables_count: number
  columns_count: number
  indexes_count: number
  constraints_count: number
  tables_added_count: number
  tables_deactivated_count: number
  columns_added_count: number
  columns_deactivated_count: number
  columns_type_changed_count: number
  columns_comment_changed_count: number
  governance_tickets_created_count: number
  change_summary: string | null
  error_message: string | null
  error_details: string | null
  datasource_name?: string
}

export interface MetadataJobsParams {
  datasource_id?: number
  status?: string
  limit?: number
}

export function useMetadataJobs(params?: MetadataJobsParams) {
  const searchParams = new URLSearchParams()
  if (params?.datasource_id) searchParams.set('datasource_id', String(params.datasource_id))
  if (params?.status) searchParams.set('status', params.status)
  if (params?.limit) searchParams.set('limit', String(params.limit))
  const qs = searchParams.toString()

  return useQuery<MetadataCollectionJob[]>({
    queryKey: ['metadataJobs', params],
    queryFn: () => apiFetch<MetadataCollectionJob[]>(`/metadata/jobs${qs ? `?${qs}` : ''}`),
  })
}

export function useMetadataJob(jobId: number) {
  return useQuery<MetadataCollectionJob>({
    queryKey: ['metadataJob', jobId],
    queryFn: () => apiFetch<MetadataCollectionJob>(`/metadata/jobs/${jobId}`),
    enabled: !!jobId,
  })
}
