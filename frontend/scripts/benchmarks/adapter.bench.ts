// frontend/scripts/benchmarks/adapter.bench.ts
import { MockAdapter } from '../../src/api/aiAsk/mockAdapter'
import { REVENUE_BY_REGION_RESPONSE } from '../fixtures/multiRoundHistory'
import type { AiAskContext } from '../../src/api/aiAsk/adapter'
import type { ModuleReport, BenchmarkFailure } from '../runQualityBenchmarks'

function makeContext(previousResponse: typeof REVENUE_BY_REGION_RESPONSE): AiAskContext {
  return {
    datasourceId: null,
    datasourceName: null,
    selectedTables: [],
    messageHistory: [
      { role: 'user', content: '各区域销售额' },
      { role: 'assistant', content: '', responseJson: previousResponse as unknown as Record<string, unknown> },
    ],
  }
}

export async function runAdapterBenchmark(): Promise<ModuleReport> {
  const adapter = MockAdapter.create()
  const failures: BenchmarkFailure[] = []

  const cases = [
    { question: '为什么华东最高', expectedType: 'drill_down', expectedDegraded: false },
    { question: '随便说说其他事', expectedType: 'general_followup', expectedDegraded: true },
  ]

  for (const tc of cases) {
    const result = await adapter.analyze(tc.question, makeContext(REVENUE_BY_REGION_RESPONSE))
    if (result.followUp?.type !== tc.expectedType) {
      failures.push({
        label: tc.question,
        expected: tc.expectedType,
        actual: result.followUp?.type ?? 'undefined',
      })
      continue
    }
    const degraded = result.followUp?.type === 'general_followup' && result.followUp?.confidence === 'low'
    if (degraded !== tc.expectedDegraded) {
      failures.push({
        label: `${tc.question} degraded flag`,
        expected: String(tc.expectedDegraded),
        actual: String(degraded),
      })
    }
  }

  const drillDownResult = await adapter.analyze('为什么华东最高', makeContext(REVENUE_BY_REGION_RESPONSE))
  if (drillDownResult.chartSuggestions.length === 0) {
    failures.push({
      label: 'drill_down has chart suggestions',
      expected: '>0',
      actual: '0',
    })
  }

  return {
    total: cases.length + 1,
    passed: cases.length + 1 - failures.length,
    failed: failures.length,
    failures,
  }
}
