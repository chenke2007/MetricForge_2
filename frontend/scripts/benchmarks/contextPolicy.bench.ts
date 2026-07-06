// frontend/scripts/benchmarks/contextPolicy.bench.ts
import { buildMessageHistory, compressResponse } from '../../src/api/aiAsk/contextPolicy'
import { REVENUE_BY_REGION_RESPONSE } from '../fixtures/multiRoundHistory'
import type { ModuleReport, BenchmarkFailure } from '../runQualityBenchmarks'

function approximateBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf-8')
}

type CompressionLevel = 'none' | 'light' | 'full'

/**
 * Apply compression to a full messageHistory, preserving the full structure.
 * For 'none' level the history is returned unchanged (deep clone to match
 * the measurement pattern used by light/full).
 */
function compressFullHistory(
  history: NonNullable<ReturnType<typeof buildMessageHistory>>,
  level: CompressionLevel,
): NonNullable<ReturnType<typeof buildMessageHistory>> {
  if (level === 'none') {
    return JSON.parse(JSON.stringify(history)) as typeof history
  }
  return history.map((msg) => {
    if (msg.role === 'assistant' && msg.responseJson) {
      return {
        ...msg,
        responseJson: compressResponse(
          msg.responseJson as Parameters<typeof compressResponse>[0],
          level,
        ) as unknown as Record<string, unknown>,
      }
    }
    return msg
  })
}

interface Scenario {
  name: string
  turnCount: number
  level: CompressionLevel
}

export async function runContextPolicyBenchmark(): Promise<ModuleReport> {
  const failures: BenchmarkFailure[] = []

  const scenarios: Scenario[] = [
    { name: '1 轮 none', turnCount: 1, level: 'none' },
    { name: '3 轮 light', turnCount: 3, level: 'light' },
    { name: '5 轮 full', turnCount: 5, level: 'full' },
    { name: '10 轮 full', turnCount: 10, level: 'full' },
  ]

  const compressionReports: Array<{
    name: string
    originalBytes: number
    compressedBytes: number
    ratio: string
  }> = []

  let scenarioAssertions = 0

  for (const s of scenarios) {
    const history = Array.from({ length: s.turnCount })
      .map(() => buildMessageHistory(REVENUE_BY_REGION_RESPONSE))
      .flat()
      .filter((h): h is NonNullable<typeof h> => h !== undefined)

    const originalBytes = approximateBytes(history)
    const compressed = compressFullHistory(history, s.level)
    const compressedBytes = approximateBytes(compressed)
    const ratio = compressedBytes / originalBytes

    compressionReports.push({
      name: s.name,
      originalBytes,
      compressedBytes,
      ratio: ratio.toFixed(2),
    })

    // --- Assertions for each scenario ---
    if (s.level === 'none') {
      // none: compressed must be identical-sized (same content, only clone overhead)
      scenarioAssertions++
      if (compressedBytes !== originalBytes) {
        failures.push({
          label: `${s.name} ratio 1.00`,
          expected: `${originalBytes}`,
          actual: `${compressedBytes}`,
          detail: `none compression should preserve original bytes, got ratio ${ratio.toFixed(4)}`,
        })
      }
    } else {
      // light/full: compressed must be strictly smaller than original
      scenarioAssertions++
      if (compressedBytes >= originalBytes) {
        failures.push({
          label: `${s.name} compression reduces size`,
          expected: `compressedBytes < ${originalBytes}`,
          actual: `${compressedBytes}`,
          detail: `${s.level} compression did not reduce size (ratio ${ratio.toFixed(4)})`,
        })
      }
    }
  }

  console.log('Context policy compression reports:', compressionReports)

  // --- Functional assertions ---

  // buildMessageHistory returns 2 entries (user + assistant)
  const history = buildMessageHistory(REVENUE_BY_REGION_RESPONSE)
  if (!history || history.length !== 2) {
    failures.push({
      label: 'buildMessageHistory shape',
      expected: '2 messages',
      actual: String(history?.length ?? 'undefined'),
    })
  }

  // light compression removes chartSuggestions
  const light = compressResponse(REVENUE_BY_REGION_RESPONSE, 'light')
  if (light.chartSuggestions.length !== 0) {
    failures.push({
      label: 'light removes chartSuggestions',
      expected: '0',
      actual: String(light.chartSuggestions.length),
    })
  }

  // full compression removes narrative details and semanticGaps
  const full = compressResponse(REVENUE_BY_REGION_RESPONSE, 'full')
  if (full.narrative.keyFindings.length !== 0 || full.semanticGaps.length !== 0) {
    failures.push({
      label: 'full removes narrative details and semanticGaps',
      expected: 'removed',
      actual: 'kept',
    })
  }

  // full compression empties sql text
  if (full.sqlPlan.sql !== '') {
    failures.push({
      label: 'full removes sql text',
      expected: 'empty string',
      actual: `"${full.sqlPlan.sql}"`,
    })
  }

  // total functional assertions: buildMessageHistory shape, light removes charts,
  // full removes narrative+semanticGaps, full removes sql text = 4
  const functionalAssertions = 4

  return {
    total: scenarioAssertions + functionalAssertions,
    passed: scenarioAssertions + functionalAssertions - failures.length,
    failed: failures.length,
    failures,
  }
}
