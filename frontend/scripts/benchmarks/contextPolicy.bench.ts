// frontend/scripts/benchmarks/contextPolicy.bench.ts
import { buildMessageHistory, compressResponse } from '../../src/api/aiAsk/contextPolicy'
import { REVENUE_BY_REGION_RESPONSE } from '../fixtures/multiRoundHistory'
import type { ModuleReport, BenchmarkFailure } from '../runQualityBenchmarks'

function approximateBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf-8')
}

export async function runContextPolicyBenchmark(): Promise<ModuleReport> {
  const failures: BenchmarkFailure[] = []

  const scenarios = [
    { name: '1 轮 none', turnCount: 1, level: 'none' as const },
    { name: '3 轮 light', turnCount: 3, level: 'light' as const },
    { name: '5 轮 full', turnCount: 5, level: 'full' as const },
    { name: '10 轮 full', turnCount: 10, level: 'full' as const },
  ]

  const reports = scenarios.map((s) => {
    const history = Array.from({ length: s.turnCount })
      .map(() => buildMessageHistory(REVENUE_BY_REGION_RESPONSE))
      .flat()
      .filter((h): h is NonNullable<typeof h> => h !== undefined)

    const compressed = history
      .filter((h) => h.role === 'assistant' && h.responseJson != null)
      .map((h) => ({
        ...h,
        responseJson: compressResponse(h.responseJson as Parameters<typeof compressResponse>[0], s.level),
      }))
    const originalBytes = approximateBytes(history)
    const compressedBytes = approximateBytes(compressed)
    return { name: s.name, originalBytes, compressedBytes, ratio: (compressedBytes / originalBytes).toFixed(2) }
  })

  console.log('Context policy compression reports:', reports)

  const history = buildMessageHistory(REVENUE_BY_REGION_RESPONSE)
  if (!history || history.length !== 2) {
    failures.push({
      label: 'buildMessageHistory shape',
      expected: '2 messages',
      actual: String(history?.length ?? 'undefined'),
    })
  }

  const light = compressResponse(REVENUE_BY_REGION_RESPONSE, 'light')
  if (light.chartSuggestions.length !== 0) {
    failures.push({
      label: 'light removes chartSuggestions',
      expected: '0',
      actual: String(light.chartSuggestions.length),
    })
  }

  const full = compressResponse(REVENUE_BY_REGION_RESPONSE, 'full')
  if (full.narrative.keyFindings.length !== 0 || full.semanticGaps.length !== 0) {
    failures.push({
      label: 'full removes narrative details and semanticGaps',
      expected: 'removed',
      actual: 'kept',
    })
  }

  return {
    total: scenarios.length + 3,
    passed: scenarios.length + 3 - failures.length,
    failed: failures.length,
    failures,
  }
}
