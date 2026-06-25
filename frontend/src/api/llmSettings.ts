import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'

export interface LlmSetting {
  id: number
  name: string
  base_url: string
  api_key_masked: string
  model_name: string
  is_active: boolean
  last_tested_at: string | null
  last_tested_ok: boolean | null
  created_at: string
  updated_at: string
}

export interface CreateLlmSettingData {
  name: string
  base_url: string
  api_key: string
  model_name: string
}

export interface UpdateLlmSettingData {
  name?: string
  base_url?: string
  api_key?: string
  model_name?: string
}

export interface TestConnectionResult {
  ok: boolean
  model: string | null
  latency_ms: number | null
  error: string | null
}

export function useLlmSettings() {
  return useQuery<LlmSetting[]>({
    queryKey: ['llmSettings'],
    queryFn: () => apiFetch<LlmSetting[]>('/llm-settings'),
  })
}

export function useLlmSetting(id: number) {
  return useQuery<LlmSetting>({
    queryKey: ['llmSettings', id],
    queryFn: () => apiFetch<LlmSetting>(`/llm-settings/${id}`),
    enabled: !!id,
  })
}

export function useCreateLlmSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateLlmSettingData) =>
      apiFetch<LlmSetting>('/llm-settings', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['llmSettings'] }),
  })
}

export function useUpdateLlmSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateLlmSettingData }) =>
      apiFetch<LlmSetting>(`/llm-settings/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['llmSettings'] }),
  })
}

export function useDeleteLlmSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ ok: boolean }>(`/llm-settings/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['llmSettings'] }),
  })
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<TestConnectionResult>(`/llm-settings/${id}/test`, { method: 'POST' }),
  })
}

export function useActivateLlmSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<LlmSetting>(`/llm-settings/${id}/activate`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['llmSettings'] }),
  })
}
