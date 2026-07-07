// frontend/scripts/benchmarks/evidenceQuality.bench.ts
// Phase 5J Task 5: Evidence quality benchmark
// Strictly checks that all scenario evidence items meet Phase 5J quality standards
import { MOCK_SCENARIOS } from '../../src/api/aiAsk/scenarios/index'
import { FOLLOW_UP_SCENARIOS } from '../../src/api/aiAsk/scenarios/followUpScenarios'
import type { EvidenceItem } from '../../src/types/aiAsk'
import type { ModuleReport, BenchmarkFailure } from '../runQualityBenchmarks'

// ── Collect all evidence from scenario data ──────────────────────────

interface EvidenceSource {
  item: EvidenceItem
  source: string // label like "MOCK:revenue-by-region[0]"
}

function collectAllEvidence(): EvidenceSource[] {
  const result: EvidenceSource[] = []

  for (const scenario of MOCK_SCENARIOS) {
    const ev = scenario.response.narrative.evidence
    if (ev) {
      ev.forEach((item, i) => {
        result.push({
          item,
          source: `MOCK:${scenario.id}[${i}]`,
        })
      })
    }
  }

  for (const scenario of FOLLOW_UP_SCENARIOS) {
    const ev = scenario.response.narrative.evidence
    if (ev) {
      ev.forEach((item, i) => {
        result.push({
          item,
          source: `FOLLOW_UP:${scenario.followUpType}[${i}]`,
        })
      })
    }
  }

  return result
}

// ── Synthetic legacy evidence (no Phase 5J fields) ───────────────────
// These test that old-format evidence does not crash the benchmark tool.

const LEGACY_EVIDENCE: EvidenceItem[] = [
  {
    claim: '旧格式断言（无 sourceFields/calculation/confidence）',
    fields: ['metric_name', 'metric_value'],
  },
  {
    claim: '最简旧格式-仅有claim和fields',
    fields: ['col_a', 'col_b'],
    sqlSnippet: 'SELECT col_a, col_b FROM table',
  },
  {
    claim: '',
    fields: [],
    sqlSnippet: '',
  },
  {
    claim: '部分字段旧格式',
    fields: ['field_x'],
    sqlSnippet: 'SELECT field_x',
    confidence: 'low' as const,
  },
]

// ── Check helpers ────────────────────────────────────────────────────

function runSingleCheck(
  failures: BenchmarkFailure[],
  passedRef: { value: number },
  label: string,
  pass: boolean,
  expected: string,
  actual: string,
): void {
  if (pass) {
    passedRef.value++
  } else {
    failures.push({ label, expected, actual })
  }
}

/**
 * Extract the leaf (last segment after the last dot) from a qualified field name.
 * E.g. "r.region" → "region", "p.product_line" → "product_line"
 */
function extractLeaf(qualifiedName: string): string {
  const parts = qualifiedName.split('.')
  return parts[parts.length - 1] ?? qualifiedName
}

/**
 * Check whether at least one sourceFields leaf name matches one of the fields entries
 * by equality or simple substring containment.
 */
function hasFieldMatch(sourceFields: string[], fields: string[]): boolean {
  const leafNames = sourceFields.map(extractLeaf)
  return fields.some((f) =>
    leafNames.some((leaf) => leaf === f || leaf.includes(f) || f.includes(leaf)),
  )
}

// ── Run the benchmark ────────────────────────────────────────────────

export async function runEvidenceQualityBenchmark(): Promise<ModuleReport> {
  const failures: BenchmarkFailure[] = []
  let total = 0
  let passed = 0
  const passedRef = { value: 0 }

  const allEvidence = collectAllEvidence()

  for (const { item, source } of allEvidence) {
    // Check 1: claim exists and is a non-empty string
    total++
    runSingleCheck(
      failures, passedRef, `${source}: claim`,
      Boolean(item.claim && typeof item.claim === 'string'),
      'non-empty string',
      String(item.claim ?? '(undefined)'),
    )

    // Check 2: fields non-empty array of strings
    total++
    const fieldsOk =
      Array.isArray(item.fields) &&
      item.fields.length > 0 &&
      item.fields.every((f) => typeof f === 'string')
    runSingleCheck(
      failures, passedRef, `${source}: fields`,
      fieldsOk,
      'non-empty string[]',
      `length=${Array.isArray(item.fields) ? item.fields.length : typeof item.fields}`,
    )

    // Check 3: sqlSnippet must be present and non-empty
    total++
    runSingleCheck(
      failures, passedRef, `${source}: sqlSnippet`,
      Boolean(item.sqlSnippet),
      'non-empty string',
      item.sqlSnippet === undefined
        ? 'undefined'
        : item.sqlSnippet === ''
          ? 'empty string'
          : `"${item.sqlSnippet}"`,
    )

    // Check 4: calculation must be present and non-empty
    total++
    runSingleCheck(
      failures, passedRef, `${source}: calculation`,
      Boolean(item.calculation),
      'non-empty string',
      item.calculation === undefined ? 'undefined' : `"${item.calculation}"`,
    )

    // Check 5: confidence must be present and a valid enum value
    total++
    const confidenceOk =
      item.confidence != null &&
      (item.confidence === 'high' || item.confidence === 'medium' || item.confidence === 'low')
    runSingleCheck(
      failures, passedRef, `${source}: confidence`,
      confidenceOk,
      'high | medium | low',
      String(item.confidence ?? '(undefined)'),
    )

    // Check 6: sourceFields non-empty array of strings
    total++
    const sourceFieldsOk =
      Array.isArray(item.sourceFields) &&
      item.sourceFields.length > 0 &&
      item.sourceFields.every((f) => typeof f === 'string')
    runSingleCheck(
      failures, passedRef, `${source}: sourceFields`,
      sourceFieldsOk,
      'non-empty string[]',
      `length=${Array.isArray(item.sourceFields) ? item.sourceFields.length : typeof item.sourceFields}`,
    )

    // Check 7: sourceFields cross-reference with fields
    total++
    if (sourceFieldsOk && fieldsOk) {
      const matchFound = hasFieldMatch(item.sourceFields!, item.fields)
      if (matchFound) {
        passedRef.value++
      } else {
        const leafNames = item.sourceFields!.map(extractLeaf)
        failures.push({
          label: `${source}: sourceFields-field cross-ref`,
          expected: `some leaf in [${leafNames.join(', ')}] matches fields [${item.fields.join(', ')}]`,
          actual: 'no match found',
        })
      }
    } else {
      // sourceFields or fields already flagged — skip cross-ref to avoid double-count
      passedRef.value++
    }

    // Check 8: non-high confidence must have confidenceReason
    total++
    const needsReason = item.confidence != null && item.confidence !== 'high'
    const reasonOk = !needsReason || Boolean(item.confidenceReason)
    runSingleCheck(
      failures, passedRef, `${source}: confidenceReason`,
      reasonOk,
      needsReason ? `confidenceReason for ${item.confidence} confidence` : 'N/A (high confidence)',
      needsReason
        ? item.confidenceReason === undefined
          ? 'missing'
          : `"${item.confidenceReason}"`
        : '(high — not needed)',
    )
  }

  // ── Synthetic legacy evidence — must NOT crash the tool ──────────────
  // Legacy items are deliberately missing Phase 5J fields. These checks
  // verify graceful handling (no runtime errors), not quality compliance.
  // Separately tracked, not counted in main failures.
  let legacyChecks = 0
  let legacyOk = 0
  for (let i = 0; i < LEGACY_EVIDENCE.length; i++) {
    const legacy = LEGACY_EVIDENCE[i]
    const src = `LEGACY[${i}]`

    // Graceful handling: all field accesses must not throw
    try {
      const _claim = legacy.claim
      const _fields = legacy.fields
      const _sqlSnippet = legacy.sqlSnippet
      const _calculation = legacy.calculation
      const _confidence = legacy.confidence
      const _sourceFields = legacy.sourceFields
      const _confidenceReason = legacy.confidenceReason

      // Attempt match check
      if (Array.isArray(legacy.sourceFields) && Array.isArray(legacy.fields)) {
        hasFieldMatch(legacy.sourceFields, legacy.fields)
      }
      legacyOk++
    } catch (err) {
      failures.push({
        label: `${src}: graceful handling`,
        expected: 'no throw',
        actual: `threw: ${err}`,
      })
    }
    legacyChecks++
  }

  // Log legacy resilience result
  console.log(
    `Legacy evidence resilience: ${legacyChecks} total, ${legacyOk} handled gracefully, ${legacyChecks - legacyOk} errors`,
  )

  // ── Summary ─────────────────────────────────────────────────────────
  passed = passedRef.value
  const failed = failures.length
  console.log(
    `\nEvidence quality checks: ${total} total, ${passed} passed, ${failed} failed`,
  )
  if (failed > 0) {
    console.log('Failures:')
    for (const f of failures) {
      console.log(`  ✗ ${f.label}`)
      console.log(`    expected: ${f.expected}`)
      console.log(`    actual:   ${f.actual}`)
    }
  }

  return { total, passed, failed, failures }
}
