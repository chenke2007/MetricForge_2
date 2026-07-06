// frontend/scripts/benchmarks/inputGuard.bench.ts
import { validateAiAskInput, MAX_INPUT_LENGTH } from '../../src/api/aiAsk/inputGuard'
import type { ModuleReport, BenchmarkFailure } from '../runQualityBenchmarks'

interface InputGuardCase {
  input: string
  label: string
  expectedValid: boolean
  expectedCode?: string
}

const TEST_CASES: InputGuardCase[] = [
  { input: '', label: '空字符串', expectedValid: false, expectedCode: 'EMPTY_INPUT' },
  { input: '   ', label: '纯空格', expectedValid: false, expectedCode: 'EMPTY_INPUT' },
  { input: '你好'.repeat(250), label: '刚好 500 字符', expectedValid: true },
  { input: '你好'.repeat(251), label: '超 1 个字符（502）', expectedValid: false, expectedCode: 'TOO_LONG' },
  { input: '1'.repeat(1000), label: '1000 字符超长', expectedValid: false, expectedCode: 'TOO_LONG' },
  { input: '，，，', label: '中文标点', expectedValid: false, expectedCode: 'PUNCTUATION_ONLY' },
  { input: '!@#$%^&*()_+', label: '英文符号', expectedValid: false, expectedCode: 'PUNCTUATION_ONLY' },
  { input: '\n\t\n', label: '仅换行与制表符', expectedValid: false, expectedCode: 'EMPTY_INPUT' },
  { input: 'abc\x00def', label: '含空字符', expectedValid: false, expectedCode: 'INVALID_CHARS' },
  { input: '各区域近30天销售额', label: '正常业务问题', expectedValid: true },
  { input: '为什么华东最高', label: '正常追问', expectedValid: true },
  { input: '请分析2024年各区域销售额TOP10客户的分布情况并按产品线拆解毛利率变化趋势', label: '长句但合法', expectedValid: true },
]

export async function runInputGuardBenchmark(): Promise<ModuleReport> {
  const failures: BenchmarkFailure[] = []
  for (const tc of TEST_CASES) {
    const result = validateAiAskInput(tc.input)
    const actualCode = result.valid ? 'valid' : result.error!.code
    const passed = result.valid === tc.expectedValid && actualCode === (tc.expectedCode ?? 'valid')
    if (!passed) {
      failures.push({
        label: tc.label,
        expected: tc.expectedValid ? 'valid' : tc.expectedCode!,
        actual: actualCode,
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
