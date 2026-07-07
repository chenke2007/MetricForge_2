// frontend/scripts/benchmarks/promptSimulation.bench.ts
import { MockAdapter } from '../../src/api/aiAsk/mockAdapter'
import { AiAskError } from '../../src/api/aiAsk/errors'
import { simulateLlmFault } from '../../src/api/aiAsk/promptSimulation'
import type { LlmResponseFaultType } from '../../src/api/aiAsk/promptSimulation'
import { validateAiAskResponse } from '../../src/api/aiAsk/validator'
import { MOCK_SCENARIOS } from '../../src/api/aiAsk/scenarios'
import type { ModuleReport, BenchmarkFailure } from '../runQualityBenchmarks'

const BASE_RESPONSE = MOCK_SCENARIOS.find((s) => s.id === 'revenue-by-region')!.response

const ERROR_FAULTS: {
  fault: Exclude<LlmResponseFaultType, 'timeout' | 'semantic_gap_conflict'>
  expectedPaths: string[]
}[] = [
  {
    fault: 'missing_top_level_fields',
    expectedPaths: ['question', 'intent', 'sqlPlan', 'narrative', 'semanticGaps'],
  },
  {
    fault: 'wrong_field_types',
    expectedPaths: ['question', 'intent', 'sqlPlan', 'chartSuggestions', 'narrative', 'semanticGaps'],
  },
  {
    fault: 'incomplete_narrative',
    expectedPaths: ['narrative.summary', 'narrative.evidence'],
  },
  {
    fault: 'incomplete_evidence',
    expectedPaths: ['narrative.evidence[0].claim', 'narrative.evidence[0].fields'],
  },
  {
    fault: 'invalid_followup_confidence',
    expectedPaths: ['followUp.confidence'],
  },
  {
    fault: 'missing_sql_plan_tables',
    expectedPaths: ['sqlPlan.tables', 'sqlPlan.fields'],
  },
  { fault: 'empty_response', expectedPaths: [] },
  { fault: 'unparseable_response', expectedPaths: [] },
]

export async function runPromptSimulationBenchmark(): Promise<ModuleReport> {
  const failures: BenchmarkFailure[] = []

  for (const { fault, expectedPaths } of ERROR_FAULTS) {
    const simulated = simulateLlmFault(BASE_RESPONSE, fault)
    const validation = validateAiAskResponse(simulated)

    if (validation.valid) {
      failures.push({
        label: fault,
        expected: 'valid === false',
        actual: 'valid === true',
      })
      continue
    }

    if (expectedPaths.length > 0) {
      const paths = validation.errors.map((e) => e.path)
      const missing = expectedPaths.filter((p) => !paths.includes(p))
      if (missing.length > 0) {
        failures.push({
          label: `${fault}: expected error paths`,
          expected: missing.join(', '),
          actual: paths.join(', ') || '(no errors)',
        })
      }
    }
  }

  // semantic_gap_conflict is warning-only and must remain contract-valid.
  {
    const simulated = simulateLlmFault(BASE_RESPONSE, 'semantic_gap_conflict')
    const validation = validateAiAskResponse(simulated)
    if (!validation.valid) {
      failures.push({
        label: 'semantic_gap_conflict',
        expected: 'valid === true',
        actual: `valid === false: ${validation.errors.map((e) => e.path).join(', ')}`,
      })
    } else if (validation.errors.length !== 0) {
      failures.push({
        label: 'semantic_gap_conflict',
        expected: 'errors.length === 0',
        actual: `errors.length === ${validation.errors.length}`,
      })
    } else if (!validation.warnings.some((w) => w.includes('冲突'))) {
      failures.push({
        label: 'semantic_gap_conflict',
        expected: 'warning contains 冲突',
        actual: `warnings: ${validation.warnings.join('; ') || '(none)'}`,
      })
    }
  }

  // timeout is handled by MockAdapter, not the transform.
  {
    const adapter = MockAdapter.create()
    try {
      await adapter.analyze('各区域销售额', {
        datasourceId: null,
        datasourceName: null,
        selectedTables: [],
        options: { simulateResponseFault: 'timeout', mockDelay: [0, 0] },
      })
      failures.push({
        label: 'timeout',
        expected: 'throws ANALYSIS_TIMEOUT',
        actual: 'no error thrown',
      })
    } catch (err) {
      if (!(err instanceof AiAskError) || err.code !== 'ANALYSIS_TIMEOUT') {
        failures.push({
          label: 'timeout',
          expected: 'AiAskError ANALYSIS_TIMEOUT',
          actual: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  const total = ERROR_FAULTS.length + 2 // + semantic_gap_conflict + timeout
  return {
    total,
    passed: total - failures.length,
    failed: failures.length,
    failures,
  }
}
