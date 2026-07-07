# Phase 5K：Adapter Contract & Prompt Simulation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在真实 LLM 接入前，硬化 `AiAskAdapter` 输入/输出契约、扩展响应校验器、提供 LLM 失败模拟 fixtures，并新增本地质量基准模块。

**Architecture:** 在 `frontend/src/api/aiAsk` 内新增 `promptSimulation.ts` 纯函数模块，扩展 `validator.ts` 与 `mockAdapter.ts` 的 fault-injection 路径，并通过 `frontend/scripts/benchmarks` 下新增 `adapterContract.bench.ts` 与 `promptSimulation.bench.ts` 接入现有 `runQualityBenchmarks.ts`。不引入真实 LLM、不改动后端、不改动用户主流程 UI。

**Tech Stack:** React 18 + TypeScript + Vite + Vitest + Ant Design；benchmark 脚本使用 `tsx` 本地运行。

## Global Constraints

- **不接真实 LLM**：所有异常响应由 transform 函数生成，不调用任何 LLM provider。
- **不新增后端 API / DB / migration**：全部逻辑在 `frontend/` 内完成。
- **不新增 Playwright / Cypress / E2E**：仅单元测试与 benchmark 脚本。
- **不引入 zod**：手写扩展 `validateAiAskResponse`。
- **不新增用户可见 UI 页面/弹窗/侧边栏**：默认不改 `AskWorkbenchPage` 主流程；仅允许组件级 1-2 行防御性改动。
- **不处理历史 untracked docs / `.venv`**：维持现有 untracked 状态。
- **不接入 CI / GitHub Actions**：benchmark 仍通过本地 `npx tsx` 运行。
- **不修改 `AiAskErrorCode` 与 `AiAskError` 构造函数签名**：仍保持 `new AiAskError(message, code, details?)`。
- **`ProcessInsight.mappingChain` 不属于 `AiAskResponse`**：不纳入 adapter response contract / validator。
- **输入长度上限**：`MAX_INPUT_LENGTH` 从 500 调整为 1000（不是 2000）。
- **每个 Task 完成后必须停下等待 reviewer 授权，禁止自动进入下一 Task。**
- **不 push、不 PR、不 merge。**

---

## 文件结构总览

| 文件 | 职责 |
|---|---|
| `frontend/src/api/aiAsk/inputGuard.ts` | 调整 `MAX_INPUT_LENGTH` 为 1000，更新错误提示。 |
| `frontend/src/api/aiAsk/inputGuard.test.ts` | 更新 1000 字符边界测试。 |
| `frontend/scripts/benchmarks/inputGuard.bench.ts` | 更新 1000 字符边界 case。 |
| `frontend/src/api/aiAsk/validator.ts` | 扩展 `validateAiAskResponse`，覆盖 TypeScript 必填字段缺失/类型错误为 error，空数组/质量问题为 warning。 |
| `frontend/src/api/aiAsk/validator.test.ts` | 覆盖新增 error/warning 规则；不包含 `mappingChain`。 |
| `frontend/src/api/aiAsk/promptSimulation.ts` | 新增 `LlmResponseFaultType` 与 `simulateLlmFault(baseResponse, fault): unknown`。 |
| `frontend/src/api/aiAsk/promptSimulation.test.ts` | 覆盖每个 fault 分支的返回值特征。 |
| `frontend/src/api/aiAsk/adapter.ts` | 在 `AiAskContext.options` 中新增 `simulateResponseFault?: LlmResponseFaultType`。 |
| `frontend/src/api/aiAsk/mockAdapter.ts` | 当 `context.options.simulateResponseFault` 存在时触发 simulation；`timeout` 直接抛 `ANALYSIS_TIMEOUT`，其余 fault 经 `simulateLlmFault` + `validateAiAskResponse` 后抛 `INVALID_RESPONSE`。 |
| `frontend/src/api/aiAsk/mockAdapter.test.ts` | 扩展测试覆盖 fault injection 路径。 |
| `frontend/scripts/benchmarks/adapterContract.bench.ts` | 新增：遍历 `MOCK_SCENARIOS` 与 `FOLLOW_UP_SCENARIOS` 的 response，断言全部通过 `validateAiAskResponse`。 |
| `frontend/scripts/benchmarks/promptSimulation.bench.ts` | 新增：对每个 `LlmResponseFaultType`（除 `timeout`）断言 `simulateLlmFault + validateAiAskResponse` 能识别异常；对 `timeout` 断言 `MockAdapter` 抛 `ANALYSIS_TIMEOUT`。 |
| `frontend/scripts/runQualityBenchmarks.ts` | 接入 `adapterContract` 与 `promptSimulation` 两个模块，扩展 `QualityBenchmarkReport.modules`。 |

---

### Task 1：Input Guard 上限从 500 调整到 1000

**目标：** 将 AI Ask 输入长度上限从 500 字符提升到 1000 字符，并同步更新测试与 benchmark。

**文件：**
- 修改：`frontend/src/api/aiAsk/inputGuard.ts`
- 修改：`frontend/src/api/aiAsk/inputGuard.test.ts`
- 修改：`frontend/scripts/benchmarks/inputGuard.bench.ts`

**变更点：**
- 在 `inputGuard.ts` 中将 `MAX_INPUT_LENGTH` 从 `500` 改为 `1000`。
- 将 `TOO_LONG` 错误提示从 `"问题过长，请缩短到 500 字以内"` 改为 `"问题过长，请缩短到 1000 字以内"`。
- 在 `inputGuard.test.ts` 中：
  - 将 `returns TOO_LONG for 501 characters` 改为 `returns TOO_LONG for 1001 characters`。
  - 将 `accepts exactly 500 characters` 改为 `accepts exactly 1000 characters`。
- 在 `inputGuard.bench.ts` 中保持总 case 数不变，将三个边界 case 替换为新的 1000 字符边界：
  - 原 `你好`.repeat(250) / `刚好 500 字符` 改为 `{ input: '你好'.repeat(500), label: '刚好 1000 字符（中文）', expectedValid: true }`。
  - 原 `你好`.repeat(251) / `超 1 个字符（502）` 改为 `{ input: '1'.repeat(1001), label: '超 1 个字符（1001）', expectedValid: false, expectedCode: 'TOO_LONG' }`。
  - 原 `1`.repeat(1000) / `1000 字符超长` 改为 `{ input: '1'.repeat(1000), label: '刚好 1000 字符（ASCII）', expectedValid: true }`。
  - 总用例数因边界调整保持不变。

**测试命令：**
```bash
cd frontend && npx vitest run src/api/aiAsk/inputGuard.test.ts
```

**预期结果：**
- `inputGuard.test.ts` 全部通过。

**回归命令：**
```bash
cd frontend && npx tsx scripts/runQualityBenchmarks.ts
```

**预期结果：**
- `inputGuard` 模块 100% 通过；总用例数因边界调整保持不变。

**Commit message：**
```text
feat(phase-5k): raise AI ask input limit from 500 to 1000

- Update MAX_INPUT_LENGTH in inputGuard.ts
- Update error message copy
- Sync unit test and benchmark boundary cases
```

**Review gate：** 完成后停下，等待 reviewer 授权再进入 Task 2。

---

### Task 2：Validator Contract Hardening

**目标：** 扩展 `validateAiAskResponse`，把 TypeScript 必填字段缺失/类型错误判为 error，空数组/质量问题判为 warning；明确不校验 `ProcessInsight.mappingChain`。

**文件：**
- 修改：`frontend/src/api/aiAsk/validator.ts`
- 修改：`frontend/src/api/aiAsk/validator.test.ts`

**变更点（validator.ts）：**
- 保持返回类型 `ValidationResult` 不变（`valid`、`errors`、`warnings`）。
- `question`：保持非空 string，error。
- `intent`：
  - 缺失或非 object → error。
  - `metrics` / `dimensions` / `filters` 不是 string 数组 → error。
  - `metrics` 与 `dimensions` 同时为空 → warning。
- `sqlPlan`：
  - 缺失或非 object → error。
  - `datasourceId` 不是 number → error。
  - `datasourceName` 缺失或非 string → error；空 string → warning。
  - `sql` 缺失或非空 string → error。
  - `tables` / `fields` 缺失或非数组 → error；空数组 → warning。
  - `assumptions` / `safetyWarnings` 缺失或非数组 → error；空数组 → 合法。
- `chartSuggestions`：
  - 缺失或非数组 → error；空数组 → warning。
  - 保留现有 chart spec title/chartType 检查。
- `narrative`：
  - 缺失或非 object → error。
  - `summary` 缺失或非空 string → error。
  - `keyFindings` 缺失或非数组 → error；空数组 → warning。
  - `evidence` 缺失或非空数组 → error。
  - `risks` / `nextQuestions` 缺失或非数组 → error；空数组 → 合法。
- `EvidenceItem`：
  - `claim` 缺失或空 → error。
  - `fields` 缺失或非空 string[] → error。
  - `sqlSnippet` / `sourceFields` / `calculation` 缺失 → warning。
  - `confidence` 非法枚举 → warning。
  - `confidence` 非 `high` 且 `confidenceReason` 缺失 → warning。
  - `relatedIntent` 存在但缺少 `metrics`/`dimensions` → warning。
- `semanticGaps`：
  - 缺失或非数组 → error；空数组 → 合法。
  - `field` 缺失或空 → warning。
  - `reason` 非法枚举 → warning。
  - `gap.field` 出现在 `intent.metrics` 中 → warning（semantic gap 冲突）。
- `followUp`（存在时）：
  - `type` 非法枚举 → error。
  - `confidence` 非法枚举 → error。

**变更点（validator.test.ts）：**
- 补充每个新增 error 规则的测试用例（必填字段缺失、类型错误）。
- 补充每个新增 warning 规则的测试用例（空数组、空字符串、confidence 缺失/非法、semantic gap 冲突）。
- 保持现有测试通过；不加入 `mappingChain` 相关测试。

**测试命令：**
```bash
cd frontend && npx vitest run src/api/aiAsk/validator.test.ts
```

**预期结果：**
- 全部新增与既有测试通过。

**回归命令：**
```bash
cd frontend && npx vitest run src/api/aiAsk
```

**预期结果：**
- `inputGuard` 与 `validator` 相关测试全部通过。

**Commit message：**
```text
feat(phase-5k): harden ai ask response validator contract

- Distinguish TypeScript required-field errors from quality warnings
- Add checks for evidence, followUp, semantic gaps, and sqlPlan fields
- Keep ProcessInsight.mappingChain out of AiAskResponse validation
```

**Review gate：** 完成后停下，等待 reviewer 授权再进入 Task 3。

---

### Task 3：Prompt Simulation 纯函数

**目标：** 新增 `promptSimulation.ts`，提供 `LlmResponseFaultType` 与 `simulateLlmFault`，用于生成真实 LLM 常见异常响应，但不调用真实 LLM。

**文件：**
- 创建：`frontend/src/api/aiAsk/promptSimulation.ts`
- 创建：`frontend/src/api/aiAsk/promptSimulation.test.ts`

**变更点（promptSimulation.ts）：**
- 导出类型：
  ```typescript
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
  ```
- 导出函数：
  ```typescript
  export function simulateLlmFault(
    baseResponse: AiAskResponse,
    fault: LlmResponseFaultType,
  ): unknown
  ```
- 实现要点：
  - 对 `baseResponse` 深拷贝后按 fault 修改。
  - `missing_top_level_fields`：删除 `question`、`intent`、`sqlPlan` 中的若干顶层字段。
  - `wrong_field_types`：将某些 string 字段改为 number，数组改为 string 等。
  - `incomplete_narrative`：将 `narrative.summary` 置空、`narrative.evidence` 置空数组。
  - `incomplete_evidence`：将第一个 `evidence[0].claim` 与 `evidence[0].fields` 置空。
  - `invalid_followup_confidence`：将 `followUp.confidence` 改为非法值。
  - `missing_sql_plan_tables`：删除 `sqlPlan.tables` 与 `sqlPlan.fields` 字段，或将其改为非数组值，使 validator 报 error（而非仅 warning）。
  - `semantic_gap_conflict`：在 `intent.metrics` 中加入 `semanticGaps[0].field` 的值，制造冲突。
  - `empty_response`：返回 `null`。
  - `unparseable_response`：返回非对象值（如 `string` 或 `number`）。
  - `timeout`：返回 `baseResponse` 的深拷贝，不破坏原始对象，也不产生 invalid response；timeout 的错误路径只在 `MockAdapter` 中处理。

**变更点（promptSimulation.test.ts）：**
- 对每个 fault type（除 `timeout`）测试 `simulateLlmFault` 返回的值与 `baseResponse` 不同，且经 `validateAiAskResponse` 后产生预期的 error path（例如 `missing_sql_plan_tables` 必须触发 `sqlPlan.tables` 或 `sqlPlan.fields` 的 error，不能仅产生 warning）。
- 对 `timeout` 测试 `simulateLlmFault(baseResponse, 'timeout')` 返回 `baseResponse` 的深拷贝，且原始 `baseResponse` 未被修改。
- timeout 对应的 `AiAskError('模拟分析超时', 'ANALYSIS_TIMEOUT')` 抛出测试放在 `mockAdapter.test.ts`。
- 不测试 `ProcessInsight.mappingChain`。

**测试命令：**
```bash
cd frontend && npx vitest run src/api/aiAsk/promptSimulation.test.ts
```

**预期结果：**
- 全部测试通过。

**回归命令：**
```bash
cd frontend && npx tsc --noEmit
```

**预期结果：**
- 0 类型错误。

**Commit message：**
```text
feat(phase-5k): add prompt simulation fixtures for LLM failure modes

- Introduce LlmResponseFaultType and simulateLlmFault pure function
- Cover missing fields, wrong types, incomplete narrative/evidence,
  invalid enums, empty/unparseable responses, and semantic gap conflicts
- timeout is handled by MockAdapter, not the transform
```

**Review gate：** 完成后停下，等待 reviewer 授权再进入 Task 4。

---

### Task 4：MockAdapter Fault Injection

**目标：** 扩展 `AiAskContext.options` 与 `MockAdapter.analyze`，仅在显式指定 `simulateResponseFault` 时触发 simulation，并正确抛出 `AiAskError`。

**文件：**
- 修改：`frontend/src/api/aiAsk/adapter.ts`
- 修改：`frontend/src/api/aiAsk/mockAdapter.ts`
- 修改：`frontend/src/api/aiAsk/mockAdapter.test.ts`

**变更点（adapter.ts）：**
- 在 `AiAskContext.options` 中新增：
  ```typescript
  simulateResponseFault?: import('./promptSimulation').LlmResponseFaultType
  ```

**变更点（mockAdapter.ts）：**
- 在 `analyzeFollowUp` 与 `analyze` 的默认路径中，生成正常 `response` 后：
  - 读取 `context.options?.simulateResponseFault`。
  - 若 fault 为 `timeout`：直接 `throw new AiAskError('模拟分析超时', 'ANALYSIS_TIMEOUT')`。
  - 若 fault 存在且非 `timeout`：
    - 调用 `simulateLlmFault(response, fault)` 得到 `simulated`。
    - 调用 `validateAiAskResponse(simulated)`。
    - 若校验失败，抛出 `new AiAskError('Mock adapter produced invalid response', 'INVALID_RESPONSE', { errors: validation.errors, simulatedFault: fault })`（follow-up 路径消息可保留 `'Mock adapter produced invalid follow-up response'`）。
  - 无 fault 时保持原有正常路径不变。
- 确保默认用户主流程不受影响；`AskWorkbenchPage` 不读取 `simulateResponseFault`。

**变更点（mockAdapter.test.ts）：**
- 新增测试：
  - `simulateResponseFault: 'missing_top_level_fields'` 抛 `AiAskError` 且 `code === 'INVALID_RESPONSE'`。
  - `simulateResponseFault: 'timeout'` 抛 `AiAskError` 且 `code === 'ANALYSIS_TIMEOUT'`。
  - `simulateResponseFault: 'empty_response'` 抛 `AiAskError` 且 `code === 'INVALID_RESPONSE'`。
  - 无 `simulateResponseFault` 时正常返回 `AiAskResponse`。
- 验证抛出的 `AiAskError.details` 包含 `simulatedFault`。

**测试命令：**
```bash
cd frontend && npx vitest run src/api/aiAsk/mockAdapter.test.ts
```

**预期结果：**
- 全部测试通过。

**回归命令：**
```bash
cd frontend && npx vitest run src/api/aiAsk
```

**预期结果：**
- `inputGuard`、`validator`、`promptSimulation`、`mockAdapter` 相关测试全部通过。

**Commit message：**
```text
feat(phase-5k): wire prompt simulation into MockAdapter via options

- Add simulateResponseFault to AiAskContext.options
- MockAdapter throws ANALYSIS_TIMEOUT for timeout fault
- Other faults go through simulateLlmFault + validateAiAskResponse,
  then throw INVALID_RESPONSE with simulatedFault detail
```

**Review gate：** 完成后停下，等待 reviewer 授权再进入 Task 5。

---

### Task 5：Benchmark 扩展

**目标：** 新增 `adapterContract.bench.ts` 与 `promptSimulation.bench.ts`，并接入 `runQualityBenchmarks.ts`。

**文件：**
- 创建：`frontend/scripts/benchmarks/adapterContract.bench.ts`
- 创建：`frontend/scripts/benchmarks/promptSimulation.bench.ts`
- 修改：`frontend/scripts/runQualityBenchmarks.ts`

**变更点（adapterContract.bench.ts）：**
- 导入 `MOCK_SCENARIOS` 与 `FOLLOW_UP_SCENARIOS`。
- 对每个 scenario 的 `response` 调用 `validateAiAskResponse`。
- 断言 `valid === true`（当前 scenario 数据是干净的）。
- 允许 warning 存在，但需记录；新增 warning 必须被 reviewer 审查。
- 返回 `ModuleReport`。

**变更点（promptSimulation.bench.ts）：**
- 选择一个干净 scenario response 作为 `baseResponse`。
- 对每个 `LlmResponseFaultType`（除 `timeout`）：
  - 调用 `simulateLlmFault(baseResponse, fault)` + `validateAiAskResponse`。
  - 断言 `valid === false`，且 `errors` 包含预期的 path（例如 `missing_sql_plan_tables` 必须触发 `sqlPlan.tables` 或 `sqlPlan.fields` 的 error，而不是仅 warning）。
- 对 `timeout`：
  - 使用 `MockAdapter.analyze` 并设置 `options: { simulateResponseFault: 'timeout' }`。
  - 断言抛出 `AiAskError` 且 `code === 'ANALYSIS_TIMEOUT'`。
- 返回 `ModuleReport`。

**变更点（runQualityBenchmarks.ts）：**
- 新增 import：
  ```typescript
  import { runAdapterContractBenchmark } from './benchmarks/adapterContract.bench'
  import { runPromptSimulationBenchmark } from './benchmarks/promptSimulation.bench'
  ```
- 扩展 `QualityBenchmarkReport.modules`：
  ```typescript
  modules: {
    inputGuard: ModuleReport
    contextPolicy: ModuleReport
    followUpDetector: ModuleReport
    adapter: ModuleReport
    evidenceQuality: ModuleReport
    adapterContract: ModuleReport
    promptSimulation: ModuleReport
  }
  ```
- 在 `Promise.all` 与 `modules` 对象中加入两个新模块。
- 保持 JSON 顶层结构兼容（只新增 `modules` key）。

**测试命令：**
```bash
cd frontend && npx tsx scripts/runQualityBenchmarks.ts
```

**预期结果：**
- 全部模块 100% 通过。
- 报告输出包含 `adapterContract` 与 `promptSimulation`。
- JSON 文件写入 `frontend/scripts/benchmark-results/`。

**Commit message：**
```text
feat(phase-5k): add adapterContract and promptSimulation benchmarks

- adapterContract.bench validates all scenario responses against contract
- promptSimulation.bench verifies every fault type is detected
- Wire both modules into runQualityBenchmarks.ts
```

**Review gate：** 完成后停下，等待 reviewer 授权再进入 Task 6。

---

### Task 6：最终验证与约束检查

**目标：** 运行完整回归验证，确认 Phase 5K 未引入禁止项，且所有测试/构建/类型检查通过。

**文件：**
- 不修改代码，仅执行验证命令。

**验证命令与预期结果：**

1. 前端单元测试
   ```bash
   cd frontend && npm test
   ```
   预期：`PASS`，测试总数不少于 Task 1-5 改动前的基线。

2. 前端类型检查
   ```bash
   cd frontend && npx tsc --noEmit
   ```
   预期：`0` 类型错误。

3. 前端构建
   ```bash
   cd frontend && npm run build
   ```
   预期：`PASS`；允许既有 chunk size warning。

4. 本地质量基准
   ```bash
   cd frontend && npx tsx scripts/runQualityBenchmarks.ts
   ```
   预期：`adapterContract` 与 `promptSimulation` 100% 通过；总通过率 100%。

5. 后端回归
   ```bash
   python -m pytest tests/ -q
   ```
   预期：`299 passed`（与 Phase 5J 基线一致，允许 warnings 数量变化）。

**约束检查清单（必须全部通过）：**

- [ ] 未引入 `zod` 依赖（检查 `frontend/package.json` 与 `package-lock.json`）。
- [ ] 未接入真实 LLM（无新增 provider/SDK import，无网络调用）。
- [ ] 未新增后端 API / DB / migration（backend 目录无新增文件/改动）。
- [ ] 未新增 Playwright / Cypress。
- [ ] 未改动 `AskWorkbenchPage` 主流程（除非有 reviewer 批准的 1-2 行防御性改动）。
- [ ] 未引入 `ProcessInsight.mappingChain` 到 `AiAskResponse` contract 或 `validateAiAskResponse`。
- [ ] `MAX_INPUT_LENGTH === 1000`（不是 2000）。
- [ ] `AiAskError` 构造函数签名未被修改。
- [ ] `simulateResponseFault` 未被业务组件读取，仅出现在 `adapter.ts`、`mockAdapter.ts`、测试与 benchmark 中。
- [ ] 未处理历史 untracked docs / `.venv`。
- [ ] 未接入 CI / GitHub Actions。

**回归通过标准：**
- 上述 5 条命令全部通过。
- 约束检查清单全部勾选。

**最终报告：**
- Task 6 不创建 commit。
- 将验证结果与约束检查清单写入 `.superpowers/sdd/task-6-final-review.md`。
  - 若该路径已被 `.gitignore` 忽略，不要强行 `git add`。
  - 报告内容包含：每条命令的实际输出摘要、`adapterContract`/`promptSimulation` 通过率、约束检查清单勾选结果、发现的任何异常。
- 只输出验证结果与约束检查，不 push、不 PR、不 merge。

**Review gate：** 完成后停下，输出 Phase 5K 完成报告，等待 reviewer 最终确认。

---

## Plan Self-Review

### 1. Spec 覆盖检查

| Spec 章节 | 覆盖 Task |
|---|---|
| §5.2 输入 Contract / `MAX_INPUT_LENGTH = 1000` | Task 1 |
| §5.3 输出 Contract / TypeScript 必填字段 error | Task 2 |
| §5.3.7 `SemanticGap` / mappingChain 边界说明 | Task 2（不校验 mappingChain） |
| §6 `LlmResponseFaultType` / `simulateLlmFault` | Task 3 |
| §6.3.2 MockAdapter Fault Injection | Task 4 |
| §7.2 扩展现有 `validateAiAskResponse` | Task 2 |
| §8 Benchmark 扩展 | Task 5 |
| §10 测试策略 / 回归验证 | Task 6 |
| §11 实施风险与回滚 | 隐含于各 Task 测试与 Task 6 约束检查 |

**未发现遗漏。**

### 2. Placeholder / TODO 扫描

- 检查 `TBD`、`TODO`、`implement later`、`fill in details`、`add appropriate error handling`、`write tests for the above`：
  - 结果：无占位符；每个 Task 均给出明确文件、变更点、命令与预期结果。

### 3. Type 一致性检查

- `AiAskContext.options.simulateResponseFault` 类型在 Task 4 中引用 Task 3 的 `LlmResponseFaultType`。
- `validateAiAskResponse` 在 Task 2 扩展后，Task 3/4/5 均使用同一函数。
- `QualityBenchmarkReport.modules` 在 Task 5 中扩展的两个 key 与 runner 中 `Promise.all` 顺序一致。

### 4. 禁止项检查

- **zod**：未引入。
- **真实 LLM**：未引入。
- **后端 API / DB / migration**：未新增后端文件。
- **Playwright / Cypress**：未新增。
- **ProcessInsight.mappingChain 进入 validator**：Task 2 明确不校验；测试也不覆盖。
- **用户主流程改动**：Task 4 明确仅通过 `options` 触发，UI 不读取。
- **CI / GitHub Actions**：未接入。
- **历史 untracked docs / `.venv`**：未处理。

### 5. 命令路径统一性

- 所有前端命令统一以 `cd frontend && ...` 开头。
- 后端命令使用 `python -m pytest tests/ -q`。
- benchmark 命令使用 `cd frontend && npx tsx scripts/runQualityBenchmarks.ts`。

### 6. Review Gate 检查

- 每个 Task 末尾均明确要求“完成后停下，等待 reviewer 授权再进入下一 Task”。
- Task 6 末尾要求输出完成报告并等待最终确认。

---

## 执行方式选择

Plan complete and saved to `docs/superpowers/plans/2026-07-07-phase-5k-adapter-contract-prompt-simulation-plan.md`.

**当前状态：** Plan 尚未 commit，等待用户审阅。

请审阅 plan。如有修改意见请告知；如无问题，可授权开始 Task 1 实施。
