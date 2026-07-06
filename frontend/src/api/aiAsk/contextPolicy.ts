// frontend/src/api/aiAsk/contextPolicy.ts
import type { AiAskResponse } from '../../types/aiAsk'
import type { AiAskContext } from './adapter'

export interface ContextPolicyConfig {
  maxHistoryLength: number
  compressionLevel: 'none' | 'light' | 'full'
  retainFields: string[]
}

export const DEFAULT_CONTEXT_CONFIG: ContextPolicyConfig = {
  maxHistoryLength: 1,
  compressionLevel: 'none',
  retainFields: [],
}

export function buildMessageHistory(
  currentResponse: AiAskResponse | null,
  config?: Partial<ContextPolicyConfig>
): AiAskContext['messageHistory'] | undefined {
  const effectiveConfig = { ...DEFAULT_CONTEXT_CONFIG, ...config }
  if (!currentResponse || effectiveConfig.maxHistoryLength < 1) {
    return undefined
  }

  return [
    { role: 'user' as const, content: currentResponse.question },
    {
      role: 'assistant' as const,
      content: '',
      responseJson: currentResponse as unknown as Record<string, unknown>,
    },
  ]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function compressResponse(
  response: AiAskResponse,
  level: 'light' | 'full'
): AiAskResponse {
  if (level === 'light') {
    const compressed = clone(response)
    compressed.chartSuggestions = []
    compressed.narrative = {
      summary: response.narrative.summary,
      conclusion: response.narrative.conclusion,
      keyFindings: [],
      evidence: [],
      risks: [],
      nextQuestions: [],
    }
    compressed.sqlPlan = {
      ...clone(response.sqlPlan),
      sql: response.sqlPlan.sql.slice(0, 200),
    }
    return compressed
  }

  return {
    question: response.question,
    intent: clone(response.intent),
    sqlPlan: {
      datasourceId: response.sqlPlan.datasourceId,
      datasourceName: response.sqlPlan.datasourceName,
      tables: clone(response.sqlPlan.tables),
      fields: clone(response.sqlPlan.fields),
      sql: '',
      assumptions: [],
      safetyWarnings: [],
    },
    resultSummary: response.resultSummary ? clone(response.resultSummary) : undefined,
    chartSuggestions: [],
    narrative: {
      summary: response.narrative.summary.slice(0, 200),
      conclusion: response.narrative.conclusion,
      keyFindings: [],
      evidence: [],
      risks: [],
      nextQuestions: [],
    },
    semanticGaps: [],
    followUp: response.followUp ? clone(response.followUp) : undefined,
    contextSummary: response.contextSummary,
  }
}

export interface CompressHistoryOptions {
  level?: 'light' | 'full'
  retainFields?: string[]
}

export function compressHistory(
  history: AiAskContext['messageHistory'],
  options: CompressHistoryOptions = {}
): AiAskContext['messageHistory'] | undefined {
  if (!history || history.length === 0) {
    return undefined
  }

  const { level = 'full' } = options
  return history.map((message) => {
    if (message.role === 'assistant' && message.responseJson) {
      return {
        ...message,
        responseJson: compressResponse(
          message.responseJson as unknown as AiAskResponse,
          level
        ) as unknown as Record<string, unknown>,
      }
    }
    return message
  })
}

export function truncateHistory(
  history: AiAskContext['messageHistory'],
  maxTurns: number
): AiAskContext['messageHistory'] | undefined {
  if (!history || history.length === 0 || maxTurns < 1) {
    return undefined
  }

  // Normalize odd-length histories that end with an unmatched user message.
  let normalizedHistory = history
  if (history.length % 2 !== 0 && history[history.length - 1]?.role === 'user') {
    normalizedHistory = history.slice(0, -1)
  }

  const maxMessages = maxTurns * 2
  if (normalizedHistory.length <= maxMessages) {
    return normalizedHistory
  }

  return normalizedHistory.slice(-maxMessages)
}
