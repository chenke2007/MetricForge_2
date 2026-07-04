// frontend/src/api/aiAsk/validator.ts

export interface ValidationError {
  path: string
  message: string
  severity: 'error' | 'warning'
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: string[]
}

const VALID_CHART_TYPES = ['bar', 'line', 'pie', 'table', 'metric-card', 'combo']

export function validateAiAskResponse(response: unknown): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: string[] = []

  if (!response || typeof response !== 'object') {
    errors.push({ path: '', message: 'response 为 null 或非对象', severity: 'error' })
    return { valid: false, errors, warnings }
  }

  const r = response as Record<string, unknown>

  // question
  if (!r.question || typeof r.question !== 'string') {
    errors.push({ path: 'question', message: 'question 不能为空', severity: 'error' })
  }

  // intent
  if (!r.intent || typeof r.intent !== 'object') {
    errors.push({ path: 'intent', message: 'intent 不能为空', severity: 'error' })
  } else {
    const intent = r.intent as Record<string, unknown>
    const metrics = Array.isArray(intent.metrics) ? intent.metrics : []
    const dimensions = Array.isArray(intent.dimensions) ? intent.dimensions : []
    if (metrics.length === 0 && dimensions.length === 0) {
      warnings.push('intent 无 metrics 且无 dimensions，AI 未理解任何业务要素')
    }
  }

  // sqlPlan
  if (!r.sqlPlan || typeof r.sqlPlan !== 'object') {
    errors.push({ path: 'sqlPlan', message: 'sqlPlan 不能为空', severity: 'error' })
  } else {
    const plan = r.sqlPlan as Record<string, unknown>
    if (!plan.sql || typeof plan.sql !== 'string' || !plan.sql.trim()) {
      errors.push({ path: 'sqlPlan.sql', message: 'sql 不能为空', severity: 'error' })
    }
    if (!Array.isArray(plan.tables) || plan.tables.length === 0) {
      warnings.push('sqlPlan.tables 为空，SQL 可能缺少表引用')
    }
  }

  // chartSuggestions
  if (!Array.isArray(r.chartSuggestions) || r.chartSuggestions.length === 0) {
    warnings.push('chartSuggestions 为空，无图表建议')
  } else {
    for (let i = 0; i < r.chartSuggestions.length; i++) {
      const spec = r.chartSuggestions[i]
      if (!spec || typeof spec !== 'object') continue
      const s = spec as Record<string, unknown>
      if (!s.title || typeof s.title !== 'string') {
        errors.push({ path: `chartSuggestions[${i}].title`, message: '图表标题不能为空', severity: 'error' })
      }
      if (s.chartType && !VALID_CHART_TYPES.includes(s.chartType as string)) {
        warnings.push(`chartSuggestions[${i}].chartType "${s.chartType}" 不合法，fallback 为 bar`)
      }
    }
  }

  // narrative
  if (!r.narrative || typeof r.narrative !== 'object') {
    warnings.push('narrative 为空，无解读摘要')
  } else {
    const narrative = r.narrative as Record<string, unknown>
    if (!narrative.summary || typeof narrative.summary !== 'string') {
      warnings.push('narrative.summary 为空')
    }
  }

  // semanticGaps
  if (Array.isArray(r.semanticGaps)) {
    for (let i = 0; i < r.semanticGaps.length; i++) {
      const gap = r.semanticGaps[i]
      if (!gap || typeof gap !== 'object') continue
      const g = gap as Record<string, unknown>
      if (!g.field || typeof g.field !== 'string') {
        warnings.push(`semanticGaps[${i}].field 为空`)
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
