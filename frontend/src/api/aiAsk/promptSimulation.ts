// frontend/src/api/aiAsk/promptSimulation.ts

import type { AiAskResponse } from '../../types/aiAsk'

export type LlmResponseFaultType =
  | 'missing_top_level_fields'
  | 'wrong_field_types'
  | 'incomplete_narrative'
  | 'incomplete_evidence'
  | 'invalid_followup_confidence'
  | 'missing_sql_plan_tables'
  | 'semantic_gap_conflict'
  | 'empty_response'
  | 'unparseable_response'
  | 'timeout'

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export function simulateLlmFault(
  baseResponse: AiAskResponse,
  fault: LlmResponseFaultType
): unknown {
  switch (fault) {
    case 'timeout':
      return deepClone(baseResponse)

    case 'empty_response':
      return null

    case 'unparseable_response':
      return 'this is not a valid response object'

    case 'missing_top_level_fields': {
      const clone = deepClone(baseResponse) as unknown as Record<string, unknown>
      delete clone.question
      delete clone.intent
      delete clone.sqlPlan
      delete clone.narrative
      delete clone.semanticGaps
      return clone
    }

    case 'wrong_field_types': {
      const clone = deepClone(baseResponse) as unknown as Record<string, unknown>
      clone.question = 12345
      clone.intent = 'intent-as-string'
      clone.sqlPlan = ['table-a']
      clone.chartSuggestions = 'bar'
      clone.narrative = null
      clone.semanticGaps = { field: 'x' }
      return clone
    }

    case 'incomplete_narrative': {
      const clone = deepClone(baseResponse)
      clone.narrative.summary = ''
      clone.narrative.keyFindings = []
      clone.narrative.evidence = []
      return clone
    }

    case 'incomplete_evidence': {
      const clone = deepClone(baseResponse)
      clone.narrative.evidence = [
        {
          claim: '',
          fields: [''],
          sourceFields: [''],
        },
      ]
      return clone
    }

    case 'invalid_followup_confidence': {
      const clone = deepClone(baseResponse)
      clone.followUp = {
        type: 'drill_down',
        confidence: 'invalid' as any,
      }
      return clone
    }

    case 'missing_sql_plan_tables': {
      const clone = deepClone(baseResponse)
      const plan = clone.sqlPlan as Record<string, unknown>
      delete plan.tables
      plan.fields = 'not-an-array'
      return clone
    }

    case 'semantic_gap_conflict': {
      const clone = deepClone(baseResponse)
      clone.intent.metrics = ['销售额']
      clone.semanticGaps = [{ field: '销售额', reason: 'not_found' }]
      return clone
    }

    default:
      return deepClone(baseResponse)
  }
}
