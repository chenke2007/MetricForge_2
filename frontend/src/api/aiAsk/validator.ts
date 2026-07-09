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
const VALID_CONFIDENCE = ['high', 'medium', 'low']
const VALID_GAP_REASONS = ['not_found', 'ambiguous', 'incomplete']
const VALID_NARRATIVE_LEVELS = ['sql_pending', 'executed']
const VALID_FOLLOW_UP_TYPES = [
  'why_down',
  'drill_down',
  'switch_metric',
  'top_n',
  'explain_anomaly',
  'time_shift',
  'general_followup',
]

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    isStringArray(value) &&
    value.length > 0 &&
    value.every((item) => item.trim().length > 0)
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function validateAiAskResponse(response: unknown): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: string[] = []

  if (!isObject(response)) {
    errors.push({ path: '', message: 'response 为 null 或非对象', severity: 'error' })
    return { valid: false, errors, warnings }
  }

  // question
  if (!isNonEmptyString(response.question)) {
    errors.push({ path: 'question', message: 'question 不能为空', severity: 'error' })
  }

  // intent
  if (!isObject(response.intent)) {
    errors.push({ path: 'intent', message: 'intent 不能为空', severity: 'error' })
  } else {
    const intent = response.intent
    const metrics = isStringArray(intent.metrics) ? intent.metrics : []
    const dimensions = isStringArray(intent.dimensions) ? intent.dimensions : []

    if (!isStringArray(intent.metrics)) {
      errors.push({ path: 'intent.metrics', message: 'intent.metrics 必须为 string 数组', severity: 'error' })
    }
    if (!isStringArray(intent.dimensions)) {
      errors.push({ path: 'intent.dimensions', message: 'intent.dimensions 必须为 string 数组', severity: 'error' })
    }
    if (!isStringArray(intent.filters)) {
      errors.push({ path: 'intent.filters', message: 'intent.filters 必须为 string 数组', severity: 'error' })
    }

    if (metrics.length === 0 && dimensions.length === 0) {
      warnings.push('intent 无 metrics 且无 dimensions，AI 未理解任何业务要素')
    }
  }

  // sqlPlan
  if (!isObject(response.sqlPlan)) {
    errors.push({ path: 'sqlPlan', message: 'sqlPlan 不能为空', severity: 'error' })
  } else {
    const plan = response.sqlPlan

    if (typeof plan.datasourceId !== 'number') {
      errors.push({ path: 'sqlPlan.datasourceId', message: 'sqlPlan.datasourceId 必须为 number', severity: 'error' })
    }

    if (!('datasourceName' in plan) || typeof plan.datasourceName !== 'string') {
      errors.push({ path: 'sqlPlan.datasourceName', message: 'sqlPlan.datasourceName 不能为空', severity: 'error' })
    } else if (plan.datasourceName.trim().length === 0) {
      warnings.push('sqlPlan.datasourceName 为空字符串')
    }

    if (!isNonEmptyString(plan.sql)) {
      errors.push({ path: 'sqlPlan.sql', message: 'sqlPlan.sql 不能为空', severity: 'error' })
    }

    if (!Array.isArray(plan.tables)) {
      errors.push({ path: 'sqlPlan.tables', message: 'sqlPlan.tables 必须为数组', severity: 'error' })
    } else if (plan.tables.length === 0) {
      warnings.push('sqlPlan.tables 为空，SQL 可能缺少表引用')
    }

    if (!Array.isArray(plan.fields)) {
      errors.push({ path: 'sqlPlan.fields', message: 'sqlPlan.fields 必须为数组', severity: 'error' })
    } else if (plan.fields.length === 0) {
      warnings.push('sqlPlan.fields 为空，SQL 可能缺少字段引用')
    }

    if (!Array.isArray(plan.assumptions)) {
      errors.push({ path: 'sqlPlan.assumptions', message: 'sqlPlan.assumptions 必须为数组', severity: 'error' })
    }

    if (!Array.isArray(plan.safetyWarnings)) {
      errors.push({ path: 'sqlPlan.safetyWarnings', message: 'sqlPlan.safetyWarnings 必须为数组', severity: 'error' })
    }
  }

  // resultSummary
  if (!isObject(response.resultSummary)) {
    warnings.push('resultSummary 缺失')
  }

  // chartSuggestions
  if (!Array.isArray(response.chartSuggestions)) {
    errors.push({ path: 'chartSuggestions', message: 'chartSuggestions 必须为数组', severity: 'error' })
  } else {
    if (response.chartSuggestions.length === 0) {
      warnings.push('chartSuggestions 为空，无图表建议')
    }

    for (let i = 0; i < response.chartSuggestions.length; i++) {
      const spec = response.chartSuggestions[i]
      if (!isObject(spec)) {
        errors.push({ path: `chartSuggestions[${i}]`, message: '图表建议项必须为对象', severity: 'error' })
        continue
      }
      if (!isNonEmptyString(spec.title)) {
        errors.push({ path: `chartSuggestions[${i}].title`, message: '图表标题不能为空', severity: 'error' })
      }
      if (spec.chartType && !VALID_CHART_TYPES.includes(spec.chartType as string)) {
        warnings.push(`chartSuggestions[${i}].chartType "${spec.chartType}" 不合法，fallback 为 bar`)
      }
    }
  }

  // narrative
  if (!isObject(response.narrative)) {
    errors.push({ path: 'narrative', message: 'narrative 不能为空', severity: 'error' })
  } else {
    const narrative = response.narrative

    if (!isNonEmptyString(narrative.summary)) {
      errors.push({ path: 'narrative.summary', message: 'narrative.summary 不能为空', severity: 'error' })
    }

    if (!Array.isArray(narrative.keyFindings)) {
      errors.push({ path: 'narrative.keyFindings', message: 'narrative.keyFindings 必须为数组', severity: 'error' })
    } else if (narrative.keyFindings.length === 0) {
      warnings.push('narrative.keyFindings 为空')
    }

    if (!Array.isArray(narrative.evidence) || narrative.evidence.length === 0) {
      errors.push({ path: 'narrative.evidence', message: 'narrative.evidence 必须为非空数组', severity: 'error' })
    } else {
      for (let i = 0; i < narrative.evidence.length; i++) {
        const item = narrative.evidence[i]
        if (!isObject(item)) {
          errors.push({ path: `narrative.evidence[${i}]`, message: 'evidence 项必须为对象', severity: 'error' })
          continue
        }

        if (!isNonEmptyString(item.claim)) {
          errors.push({ path: `narrative.evidence[${i}].claim`, message: 'evidence.claim 不能为空', severity: 'error' })
        }

        if (!isNonEmptyStringArray(item.fields)) {
          errors.push({ path: `narrative.evidence[${i}].fields`, message: 'evidence.fields 必须为非空 string 数组', severity: 'error' })
        }

        if (!isNonEmptyString(item.sqlSnippet)) {
          warnings.push(`narrative.evidence[${i}].sqlSnippet 缺失或为空`)
        }

        if (!isNonEmptyString(item.calculation)) {
          warnings.push(`narrative.evidence[${i}].calculation 缺失或为空`)
        }

        if (!isNonEmptyStringArray(item.sourceFields)) {
          warnings.push(`narrative.evidence[${i}].sourceFields 缺失或为空`)
        }

        if (item.confidence && !VALID_CONFIDENCE.includes(item.confidence as string)) {
          warnings.push(`narrative.evidence[${i}].confidence "${item.confidence}" 不合法`)
        }

        const confidence = item.confidence as string | undefined
        if (confidence && confidence !== 'high' && !isNonEmptyString(item.confidenceReason)) {
          warnings.push(`narrative.evidence[${i}].confidenceReason 缺失，confidence 为 ${confidence}`)
        }

        if (isObject(item.relatedIntent)) {
          const related = item.relatedIntent
          if (!isStringArray(related.metrics) || !isStringArray(related.dimensions)) {
            warnings.push(`narrative.evidence[${i}].relatedIntent 必须包含 metrics 与 dimensions 数组`)
          }
        }
      }
    }

    if (!Array.isArray(narrative.risks)) {
      errors.push({ path: 'narrative.risks', message: 'narrative.risks 必须为数组', severity: 'error' })
    }

    if (!Array.isArray(narrative.nextQuestions)) {
      errors.push({ path: 'narrative.nextQuestions', message: 'narrative.nextQuestions 必须为数组', severity: 'error' })
    }

    if (!isNonEmptyString(narrative.conclusion)) {
      warnings.push('narrative.conclusion 缺失或为空')
    }
  }

  // semanticGaps
  if (!Array.isArray(response.semanticGaps)) {
    errors.push({ path: 'semanticGaps', message: 'semanticGaps 必须为数组', severity: 'error' })
  } else {
    const intentMetrics = isObject(response.intent) && isStringArray(response.intent.metrics)
      ? response.intent.metrics
      : []

    for (let i = 0; i < response.semanticGaps.length; i++) {
      const gap = response.semanticGaps[i]
      if (!isObject(gap)) {
        errors.push({ path: `semanticGaps[${i}]`, message: 'semanticGap 项必须为对象', severity: 'error' })
        continue
      }

      if (!isNonEmptyString(gap.field)) {
        warnings.push(`semanticGaps[${i}].field 为空`)
      } else if (intentMetrics.includes(gap.field)) {
        warnings.push(`semanticGaps[${i}].field "${gap.field}" 与 intent.metrics 冲突`)
      }

      if (gap.reason && !VALID_GAP_REASONS.includes(gap.reason as string)) {
        warnings.push(`semanticGaps[${i}].reason "${gap.reason}" 不合法`)
      }
    }
  }

  // followUp
  if (response.followUp !== undefined) {
    if (!isObject(response.followUp)) {
      errors.push({ path: 'followUp', message: 'followUp 必须为对象', severity: 'error' })
    } else {
      const followUp = response.followUp
      if (!VALID_FOLLOW_UP_TYPES.includes(followUp.type as string)) {
        errors.push({ path: 'followUp.type', message: 'followUp.type 不合法', severity: 'error' })
      }
      if (!VALID_CONFIDENCE.includes(followUp.confidence as string)) {
        errors.push({ path: 'followUp.confidence', message: 'followUp.confidence 不合法', severity: 'error' })
      }
    }
  }

  // narrativeLevel — Phase 5M: optional, only check if present
  if (response.narrativeLevel !== undefined) {
    if (!VALID_NARRATIVE_LEVELS.includes(response.narrativeLevel as string)) {
      errors.push({ path: 'narrativeLevel', message: `narrativeLevel 只能为 sql_pending 或 executed`, severity: 'error' })
    }
  }

  // sqlValidation — Phase 5M: optional, no content validation
  if (response.sqlValidation !== undefined) {
    if (!isObject(response.sqlValidation)) {
      errors.push({ path: 'sqlValidation', message: 'sqlValidation 必须为对象', severity: 'error' })
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
