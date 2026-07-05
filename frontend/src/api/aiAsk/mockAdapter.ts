// frontend/src/api/aiAsk/mockAdapter.ts
import type { AiAskAdapter, AiAskContext, ChartDataResult } from './adapter'
import type { AiAskResponse, AiChartSpec } from '../../types/aiAsk'
import { AiAskError } from './errors'
import { validateAiAskResponse } from './validator'
import { MOCK_SCENARIOS } from './scenarios'
import type { MockScenario } from './scenarios'
import { recommendCharts } from './recommendation'

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

  async analyze(question: string, context: AiAskContext): Promise<AiAskResponse> {
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
