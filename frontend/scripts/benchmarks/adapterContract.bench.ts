// frontend/scripts/benchmarks/adapterContract.bench.ts
import { validateAiAskResponse } from '../../src/api/aiAsk/validator'
import { MOCK_SCENARIOS } from '../../src/api/aiAsk/scenarios'
import { FOLLOW_UP_SCENARIOS } from '../../src/api/aiAsk/scenarios/followUpScenarios'
import type { AiAskResponse } from '../../src/types/aiAsk'
import type { ModuleReport, BenchmarkFailure } from '../runQualityBenchmarks'

export async function runAdapterContractBenchmark(): Promise<ModuleReport> {
  const failures: BenchmarkFailure[] = []
  const labels: string[] = []

  for (const scenario of MOCK_SCENARIOS) {
    const label = `mock:${scenario.id}`
    labels.push(label)
    const validation = validateAiAskResponse(scenario.response)
    if (!validation.valid) {
      failures.push({
        label,
        expected: 'valid',
        actual: `invalid: ${validation.errors.map((e) => e.path).join(', ')}`,
        detail: validation.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
      })
    }
  }

  for (const scenario of FOLLOW_UP_SCENARIOS) {
    const parent =
      MOCK_SCENARIOS.find((s) => s.id === scenario.parentScenarioId) ?? MOCK_SCENARIOS[0]

    const response: AiAskResponse = {
      ...parent.response,
      question: '追问示例',
      intent: scenario.response.intent,
      sqlPlan: scenario.response.sqlPlan,
      resultSummary: scenario.response.resultSummary ?? parent.response.resultSummary,
      chartSuggestions: scenario.response.chartSuggestions,
      narrative: scenario.response.narrative,
      semanticGaps: parent.response.semanticGaps,
      contextSummary: scenario.contextSummary,
    }

    const label = `followUp:${scenario.parentScenarioId}:${scenario.followUpType}`
    labels.push(label)
    const validation = validateAiAskResponse(response)
    if (!validation.valid) {
      failures.push({
        label,
        expected: 'valid',
        actual: `invalid: ${validation.errors.map((e) => e.path).join(', ')}`,
        detail: validation.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
      })
    }
  }

  return {
    total: labels.length,
    passed: labels.length - failures.length,
    failed: failures.length,
    failures,
  }
}
