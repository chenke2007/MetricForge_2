// frontend/src/api/aiAsk/index.ts
import { MockAdapter } from './mockAdapter'
import { AiAskError, getAiAskErrorMessage } from './errors'
import { validateAiAskResponse } from './validator'

export type { AiAskAdapter, AiAskContext, ChartDataResult } from './adapter'
export { AiAskError }
export type { AiAskErrorCode } from './errors'
export { getAiAskErrorMessage }
export { validateAiAskResponse }
export type { ValidationResult, ValidationError } from './validator'
export { MockAdapter }
export { detectFollowUpType } from './followUpDetector'
export type { FollowUpQuestion, FollowUpType, ProcessInsight } from '../../types/aiAsk'

export function useAiAskService() {
  const adapter = MockAdapter.create()
  return {
    analyze: adapter.analyze.bind(adapter),
    getChartData: adapter.getChartData.bind(adapter),
    isAvailable: adapter.isAvailable.bind(adapter),
    name: adapter.name,
    validate: validateAiAskResponse,
  }
}
