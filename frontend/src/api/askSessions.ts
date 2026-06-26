import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'

/* ─── Types ─── */

export interface AskSession {
  id: number
  title: string
  created_at: string
  updated_at: string
  message_count?: number
}

export interface ToolCallRecord {
  id: number
  message_id: number
  tool_name: string
  arguments: string
  result: string | null
  status: string
  error_message: string | null
  created_at: string
}

export interface AskMessage {
  id: number
  session_id: number
  role: 'user' | 'assistant'
  content: string
  status: string
  error_message?: string | null
  tokens_prompt?: number | null
  tokens_completion?: number | null
  created_at: string
  tool_calls?: ToolCallRecord[]
}

export interface CreateSessionInput {
  title?: string
}

export interface CreateMessageInput {
  sessionId: number
  content: string
}

export interface CreateMessageResult {
  user_message: AskMessage
  assistant_message: AskMessage
}

/* ─── Fetchers ─── */

function fetchSessions(): Promise<AskSession[]> {
  return apiFetch<AskSession[]>('/ask/sessions')
}

function fetchSession(id: number) {
  return apiFetch<AskSession>(`/ask/sessions/${id}`)
}

function fetchMessages(sessionId: number) {
  return apiFetch<AskMessage[]>(`/ask/sessions/${sessionId}/messages`)
}

function createMessage(data: CreateMessageInput): Promise<CreateMessageResult> {
  return apiFetch<CreateMessageResult>(
    `/ask/sessions/${data.sessionId}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ content: data.content }),
    }
  )
}

function deleteSession(id: number): Promise<void> {
  return apiFetch<void>(`/ask/sessions/${id}`, {
    method: 'DELETE',
  })
}

/* ─── Hooks ─── */

export function useAskSessions() {
  return useQuery({
    queryKey: ['askSessions'],
    queryFn: fetchSessions,
  })
}

export function useAskSession(id: number | null) {
  return useQuery({
    queryKey: ['askSessions', id],
    queryFn: () => fetchSession(id!),
    enabled: !!id,
  })
}

export function useAskMessages(sessionId: number | null) {
  return useQuery({
    queryKey: ['askSessions', sessionId, 'messages'],
    queryFn: () => fetchMessages(sessionId!),
    enabled: !!sessionId,
  })
}

export function useCreateSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data?: CreateSessionInput) =>
      apiFetch<AskSession>('/ask/sessions', {
        method: 'POST',
        body: JSON.stringify({ title: data?.title || '新对话' }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['askSessions'] })
    },
  })
}

export function useCreateMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createMessage,
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['askSessions', variables.sessionId] })
      qc.invalidateQueries({
        queryKey: ['askSessions', variables.sessionId, 'messages'],
      })
    },
  })
}

export function useDeleteSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteSession,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['askSessions'] })
    },
  })
}
