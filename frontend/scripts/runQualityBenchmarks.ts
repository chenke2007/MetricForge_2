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

export interface BenchmarkSummary {
  totalCases: number
  passed: number
  failed: number
  passRate: number
}

export interface QualityBenchmarkReport {
  timestamp: string
  duration: number
  summary: BenchmarkSummary
  modules: {
    inputGuard: ModuleReport
    contextPolicy: ModuleReport
    followUpDetector: ModuleReport
    adapter: ModuleReport
  }
}

function computeSummary(modules: QualityBenchmarkReport['modules']): BenchmarkSummary {
  const totalCases = Object.values(modules).reduce((sum, m) => sum + m.total, 0)
  const passed = Object.values(modules).reduce((sum, m) => sum + m.passed, 0)
  const failed = Object.values(modules).reduce((sum, m) => sum + m.failed, 0)
  const passRate = totalCases > 0 ? Number(((passed / totalCases) * 100).toFixed(2)) : 0
  return { totalCases, passed, failed, passRate }
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

  const modules = { inputGuard, contextPolicy, followUpDetector, adapter }
  const summary = computeSummary(modules)

  const report: QualityBenchmarkReport = {
    timestamp,
    duration: Date.now() - start,
    summary,
    modules,
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

  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`  Total cases:  ${summary.totalCases}`)
  console.log(`  Passed:       ${summary.passed}`)
  console.log(`  Failed:       ${summary.failed}`)
  console.log(`  Pass rate:    ${summary.passRate}%`)
  console.log(`  Duration:     ${report.duration}ms`)
  console.log(`  Report:       ${outPath}`)

  if (summary.failed > 0) {
    console.error(`\n${summary.failed} benchmark assertion(s) failed`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
