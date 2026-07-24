// frontend/src/api/aiAsk/chartFieldMatch.ts
// Shared field-matching utility used by both RealLlmAdapter.getChartData()
// and AiChartBoard to ensure consistent case-insensitive field matching.

import type { AiChartSpec } from '../../types/aiAsk'

export interface ChartFieldMatchResult {
  match: boolean
  missingFields: string[]
}

/**
 * Check whether a chart suggestion's xField and yFields all exist in the
 * given columns list (case-insensitive).
 */
export function matchChartFields(
  spec: Pick<AiChartSpec, 'xField' | 'yFields'>,
  columns: string[],
): ChartFieldMatchResult {
  const colLower = columns.map((c) => c.toLowerCase())
  const missingFields: string[] = []

  if (spec.xField) {
    if (!colLower.includes(spec.xField.toLowerCase())) {
      missingFields.push(spec.xField)
    }
  }
  for (const yf of spec.yFields) {
    if (!colLower.includes(yf.toLowerCase())) {
      missingFields.push(yf)
    }
  }

  return { match: missingFields.length === 0, missingFields }
}

/**
 * Filter chartSuggestions to only those whose fields match the given columns.
 */
export function filterMatchingCharts(
  chartSuggestions: AiChartSpec[] | null | undefined,
  columns: string[],
): AiChartSpec[] {
  if (!chartSuggestions) return []
  return chartSuggestions.filter((spec) => matchChartFields(spec, columns).match)
}

// ── Phase 5N Task 6.5D follow-up: canonical field resolver ────────────

/**
 * Resolve a field name to the actual column name (correct casing) from the
 * given columns list, using case-insensitive matching.
 * Returns undefined when no column matches.
 */
export function resolveCanonicalField(field: string, columns: string[]): string | undefined {
  const lower = field.toLowerCase()
  return columns.find((c) => c.toLowerCase() === lower)
}

/**
 * Canonicalize a chart spec: map xField, yFields, and sort.field to the
 * actual column names from the given columns list (case-insensitive).
 * Fields that don't match any column are left as-is (filter handles exclusion).
 * Returns a new object; does not mutate the original spec.
 */
export function canonicalizeSpec(spec: AiChartSpec, columns: string[]): AiChartSpec {
  const resolve = (f: string) => resolveCanonicalField(f, columns) ?? f
  return {
    ...spec,
    xField: spec.xField ? resolve(spec.xField) : spec.xField,
    yFields: spec.yFields.map(resolve),
    sort: spec.sort ? { ...spec.sort, field: resolve(spec.sort.field) } : spec.sort,
  }
}
