import { useQuery } from '@tanstack/react-query'
import { fetchGovernanceTicket, type GovernanceTicketDetail } from '../api/governance'

export function useGovernanceTicket(ticketId: number | null) {
  return useQuery<GovernanceTicketDetail>({
    queryKey: ['governance', 'detail', ticketId],
    queryFn: () => fetchGovernanceTicket(ticketId!),
    enabled: !!ticketId,
  })
}
