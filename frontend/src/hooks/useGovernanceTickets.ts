import { useQuery } from '@tanstack/react-query'
import { fetchGovernanceTickets, type GovernanceFilters, type GovernanceListResponse } from '../api/governance'

export function useGovernanceTickets(filters: GovernanceFilters) {
  return useQuery<GovernanceListResponse>({
    queryKey: ['governance', 'list', filters],
    queryFn: () => fetchGovernanceTickets(filters),
    placeholderData: (prev) => prev,  // keep previous data while fetching
  })
}
