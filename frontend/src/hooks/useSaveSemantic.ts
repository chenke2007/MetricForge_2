import { useMutation, useQueryClient } from '@tanstack/react-query'
import { saveFieldSemantic, type SaveSemanticInput, type SaveSemanticResponse } from '../api/governance'

export function useSaveSemantic() {
  const qc = useQueryClient()
  return useMutation<SaveSemanticResponse, Error, SaveSemanticInput>({
    mutationFn: saveFieldSemantic,
    onSuccess: (_data, _variables) => {
      // Invalidate list and detail queries so they refresh
      qc.invalidateQueries({ queryKey: ['governance', 'list'] })
      qc.invalidateQueries({ queryKey: ['governance', 'detail'] })
    },
  })
}
