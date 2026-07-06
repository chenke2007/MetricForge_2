import { describe, it, expect } from 'vitest'
import { FOLLOW_UP_SCENARIOS, matchFollowUpScenario } from './followUpScenarios'

describe('FOLLOW_UP_SCENARIOS', () => {
  it('has at least 4 scenarios', () => {
    expect(FOLLOW_UP_SCENARIOS.length).toBeGreaterThanOrEqual(4)
  })

  it('each scenario has required fields', () => {
    for (const s of FOLLOW_UP_SCENARIOS) {
      expect(s.parentScenarioId).toBeDefined()
      expect(s.followUpType).toBeDefined()
      expect(s.matchPatterns.length).toBeGreaterThan(0)
      expect(s.response).toBeDefined()
      expect(s.response.narrative).toBeDefined()
      expect(s.contextSummary).toBeTruthy()
    }
  })

  it('each scenario has narrative with summary', () => {
    for (const s of FOLLOW_UP_SCENARIOS) {
      expect(s.response.narrative.summary).toBeTruthy()
    }
  })
})

describe('matchFollowUpScenario', () => {
  it('matches drill_down scenario by parent + type + pattern', () => {
    const result = matchFollowUpScenario('revenue-by-region', 'drill_down', '华东的详细数据')
    expect(result).not.toBeNull()
    expect(result!.followUpType).toBe('drill_down')
  })

  it('matches why_down scenario', () => {
    const result = matchFollowUpScenario('revenue-by-region', 'why_down', '为什么下降了')
    expect(result).not.toBeNull()
    expect(result!.followUpType).toBe('why_down')
  })

  it('matches top_n scenario with wildcard parent', () => {
    const result = matchFollowUpScenario('trend-over-time', 'top_n', '看 TOP5')
    expect(result).not.toBeNull()
    expect(result!.followUpType).toBe('top_n')
  })

  it('returns null when no pattern matches', () => {
    const result = matchFollowUpScenario('revenue-by-region', 'drill_down', '随便说说')
    expect(result).toBeNull()
  })
})
