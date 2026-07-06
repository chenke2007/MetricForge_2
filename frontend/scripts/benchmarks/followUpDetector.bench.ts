// frontend/scripts/benchmarks/followUpDetector.bench.ts
import { detectFollowUpType } from '../../src/api/aiAsk/followUpDetector'
import type { FollowUpType } from '../../src/types/aiAsk'
import { REVENUE_BY_REGION_RESPONSE } from '../fixtures/multiRoundHistory'
import type { ModuleReport, BenchmarkFailure } from '../runQualityBenchmarks'

interface FollowUpCase {
  question: string
  expectedType: FollowUpType
  expectedConfidence: 'high' | 'medium' | 'low'
}

const TEST_CASES: FollowUpCase[] = [
  { question: '为什么销售额下降', expectedType: 'why_down', expectedConfidence: 'high' },
  { question: '下降的原因是什么', expectedType: 'why_down', expectedConfidence: 'high' },
  { question: '为什么华东最高', expectedType: 'drill_down', expectedConfidence: 'high' },
  { question: '按产品线拆分', expectedType: 'drill_down', expectedConfidence: 'medium' },
  { question: '看 TOP10 客户', expectedType: 'top_n', expectedConfidence: 'high' },
  { question: '去年同期的数据', expectedType: 'time_shift', expectedConfidence: 'high' },
  { question: '换成毛利率来看', expectedType: 'switch_metric', expectedConfidence: 'medium' },
  { question: '为什么这个月突然下降', expectedType: 'why_down', expectedConfidence: 'high' },
  { question: '再说说', expectedType: 'general_followup', expectedConfidence: 'low' },
  { question: '还有吗', expectedType: 'general_followup', expectedConfidence: 'low' },
]

export async function runFollowUpBenchmark(): Promise<ModuleReport> {
  const failures: BenchmarkFailure[] = []
  for (const tc of TEST_CASES) {
    const result = detectFollowUpType(tc.question, REVENUE_BY_REGION_RESPONSE)
    const passed = result.type === tc.expectedType && result.confidence === tc.expectedConfidence
    if (!passed) {
      failures.push({
        label: tc.question,
        expected: `${tc.expectedType}:${tc.expectedConfidence}`,
        actual: `${result.type}:${result.confidence}`,
      })
    }
  }
  return {
    total: TEST_CASES.length,
    passed: TEST_CASES.length - failures.length,
    failed: failures.length,
    failures,
  }
}
