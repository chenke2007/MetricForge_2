// frontend/src/api/aiAsk/adapter.ts
import type { AiAskResponse, AiChartSpec } from '../../types/aiAsk'

export interface AiAskContext {
  datasourceId: number | null
  datasourceName: string | null
  selectedTables: string[]
  messageHistory?: Array<{
    role: 'user' | 'assistant'
    content: string
    responseJson?: Record<string, unknown>
  }>
  options?: {
    mockDelay?: [number, number]
    mockFailureRate?: number
    forceFollowUpType?: import('../../types/aiAsk').FollowUpType
    simulateResponseFault?: import('./promptSimulation').LlmResponseFaultType
  }
}

export interface ChartDataResult {
  columns: string[]
  rows: any[][]
  isEmpty: boolean
  error?: string
}

export interface AiAskAdapter {
  analyze(question: string, context: AiAskContext): Promise<AiAskResponse>
  getChartData(spec: AiChartSpec, response: AiAskResponse): ChartDataResult
  isAvailable(): boolean
  readonly name: string
}
