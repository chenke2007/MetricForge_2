// frontend/src/api/aiAsk/mockAdapter.ts
import type { AiAskAdapter, AiAskContext, ChartDataResult } from './adapter'
import type { AiAskResponse, AiChartSpec } from '../../types/aiAsk'
import type { FollowUpType } from '../../types/aiAsk'
import { AiAskError } from './errors'
import { validateAiAskResponse } from './validator'
import { simulateLlmFault } from './promptSimulation'
import { MOCK_SCENARIOS } from './scenarios'
import type { MockScenario } from './scenarios'
import { recommendCharts } from './recommendation'
import { detectFollowUpType } from './followUpDetector'
import { matchFollowUpScenario, FOLLOW_UP_SCENARIOS } from './scenarios/followUpScenarios'

export class MockAdapter implements AiAskAdapter {
  readonly name = 'MockAdapter'

  private constructor() {}

  static create(): MockAdapter {
    return new MockAdapter()
  }

  private matchScenario(question: string): MockScenario {
    for (const scenario of MOCK_SCENARIOS) {
      if (scenario.match.test(question)) {
        return scenario
      }
    }
    return MOCK_SCENARIOS[MOCK_SCENARIOS.length - 1] // default
  }

  private getPreviousResponse(messageHistory?: AiAskContext['messageHistory']): AiAskResponse | null {
    if (!messageHistory || messageHistory.length === 0) return null
    const lastAssistant = [...messageHistory].reverse().find(m => m.role === 'assistant')
    if (!lastAssistant?.responseJson) return null
    return lastAssistant.responseJson as unknown as AiAskResponse
  }

  private async analyzeFollowUp(
    question: string,
    context: AiAskContext,
    previousResponse: AiAskResponse,
  ): Promise<AiAskResponse> {
    const forceType = context.options?.forceFollowUpType
    const followUp = forceType
      ? { type: forceType as FollowUpType, confidence: 'high' as const, inferenceReason: `forceFollowUpType override: ${forceType}` }
      : detectFollowUpType(question, previousResponse)

    const scenario = this.matchScenario(previousResponse.question)
    const followUpData = matchFollowUpScenario(scenario.id, followUp.type, question)

    // Base: inherit from previous response
    const response: AiAskResponse = {
      question,
      intent: previousResponse.intent,
      sqlPlan: {
        ...previousResponse.sqlPlan,
        ...(context.datasourceId ? { datasourceId: context.datasourceId } : {}),
        ...(context.datasourceName ? { datasourceName: context.datasourceName } : {}),
      },
      resultSummary: previousResponse.resultSummary,
      chartSuggestions: previousResponse.chartSuggestions,
      narrative: previousResponse.narrative,
      semanticGaps: previousResponse.semanticGaps,
      followUp,
    }

    if (followUpData) {
      // Use follow-up scenario data to override
      response.intent = followUpData.response.intent
      response.sqlPlan = {
        ...followUpData.response.sqlPlan,
        ...(context.datasourceId ? { datasourceId: context.datasourceId } : {}),
        ...(context.datasourceName ? { datasourceName: context.datasourceName } : {}),
      }
      response.resultSummary = followUpData.response.resultSummary
      response.narrative = followUpData.response.narrative

      // Use recommendCharts for follow-up scenarios too
      const chartData = followUpData.chartData ?? scenario.chartData
      const recommended = recommendCharts({
        columns: chartData.columns,
        sampleRows: chartData.rows.slice(0, 5),
        question,
        intent: followUpData.response.intent,
      })
      response.chartSuggestions = recommended
      response.contextSummary = followUpData.contextSummary
    } else {
      // No specific follow-up data — reuse previous response but mark as follow-up
      response.contextSummary = `基于上一轮 "${previousResponse.question}" 继续分析`
    }

    // Fault injection (Phase 5K): only trigger when explicitly requested.
    const fault = context.options?.simulateResponseFault
    if (fault) {
      if (fault === 'timeout') {
        throw new AiAskError('模拟分析超时', 'ANALYSIS_TIMEOUT')
      }
      const simulated = simulateLlmFault(response, fault) as AiAskResponse
      const validation = validateAiAskResponse(simulated)
      if (!validation.valid) {
        throw new AiAskError('Mock adapter produced invalid follow-up response', 'INVALID_RESPONSE', {
          errors: validation.errors,
          simulatedFault: fault,
        })
      }
      return simulated
    }

    // Validate
    const validation = validateAiAskResponse(response)
    if (!validation.valid) {
      throw new AiAskError('Mock adapter produced invalid follow-up response', 'INVALID_RESPONSE', {
        errors: validation.errors,
      })
    }

    return response
  }

  async analyze(question: string, context: AiAskContext): Promise<AiAskResponse> {
    const previousResponse = this.getPreviousResponse(context.messageHistory)

    if (previousResponse) {
      // Multi-turn path — completely independent from single-turn logic
      return this.analyzeFollowUp(question, context, previousResponse)
    }

    // Single-turn path (existing logic)
    const { mockDelay, mockFailureRate } = context.options ?? {}

    // simulated delay
    if (mockDelay !== undefined) {
      const [min, max] = mockDelay
      const delay = min + Math.random() * (max - min)
      await new Promise((r) => setTimeout(r, delay))
    } else {
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 900))
    }

    // simulate failure
    if (mockFailureRate !== undefined && Math.random() < mockFailureRate) {
      throw new AiAskError('模拟分析超时', 'ANALYSIS_TIMEOUT')
    }

    const scenario = this.matchScenario(question)

    // Build response with question override
    const response: AiAskResponse = {
      ...scenario.response,
      question,
      sqlPlan: {
        ...scenario.response.sqlPlan,
        ...(context.datasourceId ? { datasourceId: context.datasourceId } : {}),
        ...(context.datasourceName ? { datasourceName: context.datasourceName } : {}),
      },
    }

    // --- recommendCharts integration ---
    // Use rule-based recommendation to generate dynamic chartSuggestions.
    // Different questions → different scenarios → different intentInfo → different chart types.
    const recommended = recommendCharts({
      columns: scenario.chartData.columns,
      sampleRows: scenario.chartData.rows.slice(0, 5),
      question,
      intent: scenario.intentInfo,
    })

    // Append metric-card as the last chart suggestion (if scenario has metricCards)
    if (scenario.metricCards && scenario.metricCards.length > 0) {
      recommended.push({
        title: '核心指标',
        chartType: 'metric-card',
        yFields: [],
        metricCards: scenario.metricCards as any,
        rationale: '核心经营指标一览',
        limitations: [],
      })
    }

    response.chartSuggestions = recommended

    // Fault injection (Phase 5K): only trigger when explicitly requested.
    const fault = context.options?.simulateResponseFault
    if (fault) {
      if (fault === 'timeout') {
        throw new AiAskError('模拟分析超时', 'ANALYSIS_TIMEOUT')
      }
      const simulated = simulateLlmFault(response, fault) as AiAskResponse
      const validation = validateAiAskResponse(simulated)
      if (!validation.valid) {
        throw new AiAskError('Mock adapter produced invalid response', 'INVALID_RESPONSE', {
          errors: validation.errors,
          simulatedFault: fault,
        })
      }
      return simulated
    }

    // validate
    const validation = validateAiAskResponse(response)
    if (!validation.valid) {
      throw new AiAskError('Mock adapter produced invalid response', 'INVALID_RESPONSE', {
        errors: validation.errors,
      })
    }

    return response
  }

  getChartData(spec: AiChartSpec, response: AiAskResponse): ChartDataResult {
    // Check for follow-up scenario chart data — search directly through FOLLOW_UP_SCENARIOS
    if (response.followUp) {
      for (const fus of FOLLOW_UP_SCENARIOS) {
        if (fus.followUpType !== response.followUp.type) continue
        if (!fus.chartData) continue
        for (const pattern of fus.matchPatterns) {
          if (pattern.test(response.question)) {
            return {
              columns: fus.chartData.columns,
              rows: fus.chartData.rows,
              isEmpty: fus.chartData.rows.length === 0,
            }
          }
        }
      }
    }

    const scenario = this.matchScenario(response.question)

    // Check if spec yFields match chart data columns
    const allFields = new Set(scenario.chartData.columns)
    const hasMatchingFields = spec.yFields.some((f) => allFields.has(f))

    if (!hasMatchingFields) {
      return {
        columns: scenario.chartData.columns,
        rows: scenario.chartData.rows,
        isEmpty: scenario.chartData.rows.length === 0,
      }
    }

    return {
      columns: scenario.chartData.columns,
      rows: scenario.chartData.rows,
      isEmpty: scenario.chartData.rows.length === 0,
    }
  }

  isAvailable(): boolean {
    return true
  }
}
