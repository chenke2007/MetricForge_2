// frontend/scripts/runQualityBenchmarks.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInputGuardBenchmark } from './benchmarks/inputGuard.bench'
import { runContextPolicyBenchmark } from './benchmarks/contextPolicy.bench'
import { runFollowUpBenchmark } from './benchmarks/followUpDetector.bench'
import { runAdapterBenchmark } from './benchmarks/adapter.bench'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface BenchmarkFailure {
  label: string
  expected: string
  actual: string
  detail?: string
}

export interface ModuleReport {
  total: number
  passed: number
  failed: number
  failures: BenchmarkFailure[]
}

export interface QualityBenchmarkReport {
  timestamp: string
  duration: number
  modules: {
    inputGuard: ModuleReport
    contextPolicy: ModuleReport
    followUpDetector: ModuleReport
    adapter: ModuleReport
  }
}

async function main(): Promise<void> {
  const start = Date.now()
  const timestamp = new Date().toISOString()

  console.log('Running quality benchmarks...\n')

  const [inputGuard, contextPolicy, followUpDetector, adapter] = await Promise.all([
    runInputGuardBenchmark(),
    runContextPolicyBenchmark(),
    runFollowUpBenchmark(),
    runAdapterBenchmark(),
  ])

  const report: QualityBenchmarkReport = {
    timestamp,
    duration: Date.now() - start,
    modules: { inputGuard, contextPolicy, followUpDetector, adapter },
  }

  const outDir = path.join(__dirname, 'benchmark-results')
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }
  const filename = `${timestamp.replace(/[:.]/g, '-')}.json`
  const outPath = path.join(outDir, filename)
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8')

  console.log('='.repeat(60))
  console.log('QUALITY BENCHMARK REPORT')
  console.log('='.repeat(60))
  console.log(JSON.stringify(report, null, 2))

  const totalCases = Object.values(report.modules).reduce((sum, m) => sum + m.total, 0)
  const totalPassed = Object.values(report.modules).reduce((sum, m) => sum + m.passed, 0)
  const totalFailed = Object.values(report.modules).reduce((sum, m) => sum + m.failed, 0)
  const passRate = totalCases > 0 ? ((totalPassed / totalCases) * 100).toFixed(2) : '0.00'

  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`  Total cases:  ${totalCases}`)
  console.log(`  Passed:       ${totalPassed}`)
  console.log(`  Failed:       ${totalFailed}`)
  console.log(`  Pass rate:    ${passRate}%`)
  console.log(`  Duration:     ${report.duration}ms`)
  console.log(`  Report:       ${outPath}`)

  if (totalFailed > 0) {
    console.error(`\n${totalFailed} benchmark assertion(s) failed`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
