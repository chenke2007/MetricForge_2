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
