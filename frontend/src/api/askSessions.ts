import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'

/* ─── Types ─── */

export interface AskSession {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count?: number
}

export interface AskMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface CreateSessionInput {
  title?: string
}

export interface CreateMessageInput {
  sessionId: string
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

function fetchSession(id: string): Promise<AskSession> {
  return apiFetch<AskSession>(`/ask/sessions/${id}`)
}

function fetchMessages(sessionId: string): Promise<AskMessage[]> {
  return apiFetch<AskMessage[]>(`/ask/sessions/${sessionId}/messages`)
}

function createSession(data: CreateSessionInput): Promise<AskSession> {
  return apiFetch<AskSession>('/ask/sessions', {
    method: 'POST',
    body: JSON.stringify({ title: data.title || '新对话' }),
  })
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

function deleteSession(id: string): Promise<void> {
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

export function useAskSession(id: string | null) {
  return useQuery({
    queryKey: ['askSessions', id],
    queryFn: () => fetchSession(id!),
    enabled: !!id,
  })
}

export function useAskMessages(sessionId: string | null) {
  return useQuery({
    queryKey: ['askSessions', sessionId, 'messages'],
    queryFn: () => fetchMessages(sessionId!),
    enabled: !!sessionId,
  })
}

export function useCreateSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createSession,
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
