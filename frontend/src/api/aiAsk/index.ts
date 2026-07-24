// frontend/src/api/aiAsk/index.ts
import { MockAdapter } from './mockAdapter'
import { RealLlmAdapter } from './realLlmAdapter'
import { AiAskError, getAiAskErrorMessage } from './errors'
import { validateAiAskResponse } from './validator'

export type { AiAskAdapter, AiAskContext, ChartDataResult } from './adapter'
export { AiAskError }
export type { AiAskErrorCode } from './errors'
export { getAiAskErrorMessage }
export { validateAiAskResponse }
export type { ValidationResult, ValidationError } from './validator'
export { MockAdapter }
export { RealLlmAdapter }
export { detectFollowUpType } from './followUpDetector'
export type { FollowUpQuestion, FollowUpType, ProcessInsight } from '../../types/aiAsk'
export { validateAiAskInput } from './inputGuard'
export type { InputValidationResult, InputGuardErrorCode } from './inputGuard'
export { buildMessageHistory, compressResponse, compressHistory, truncateHistory, DEFAULT_CONTEXT_CONFIG } from './contextPolicy'
export type { ContextPolicyConfig, CompressHistoryOptions } from './contextPolicy'
export { executeSql } from './executeApi'
export type { ExecuteSqlResponse } from './executeApi'

export function useAiAskService() {
  const adapter = RealLlmAdapter.create()
  return {
    analyze: adapter.analyze.bind(adapter),
    getChartData: adapter.getChartData.bind(adapter),
    isAvailable: adapter.isAvailable.bind(adapter),
    name: adapter.name,
    validate: validateAiAskResponse,
  }
}
