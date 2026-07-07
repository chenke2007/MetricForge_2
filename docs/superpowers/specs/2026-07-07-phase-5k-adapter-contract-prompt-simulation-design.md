# Phase 5K：AI 问数 Adapter Contract & Prompt Simulation Hardening

**日期**: 2026-07-07  
**状态**: 设计稿待审阅  
**范围**: 纯前端，围绕 `frontend/src/api/aiAsk` 与质量基准脚本  
**方向**: 在真实 LLM 接入前，把 Adapter 协议、校验器、失败模拟、质量基准打磨到可直接对接真实 LLM 的程度。

---

## 1. 目标与定位

Phase 5K 是真实 LLM 接入前的“工程化收口”阶段。本阶段不接入真实 LLM，也不改动用户主流程，而是：

1. 明确 `AiAskAdapter` 的输入/输出契约，定义哪些字段对真实 LLM 是“必须”、哪些是“可选”。
2. 扩展纯函数 `validateAiAskResponse`，覆盖 Phase 5H/5J 新增字段的完整性、一致性检查。
3. 提供一组“真实 LLM 常见失败”的模拟 fixtures，用于本地 benchmark 和单元测试。
4. 新增 `adapterContract` 与 `promptSimulation` 两个 benchmark 模块，接入现有的 `runQualityBenchmarks.ts`。

最终交付物应让后续真实 LLM Adapter 的实现者有清晰的输入/输出约束、现成的回归测试集合，以及可复用的降级路径。

---

## 2. 边界与非目标

### 2.1 明确边界

| 类别 | 是否允许 | 说明 |
|---|---|---|
| 真实 LLM 调用 | ❌ 不允许 | 只做协议与模拟，不接入任何 LLM provider。 |
| 后端 API / DB / migration | ❌ 不允许 | 全部逻辑在 `frontend/` 内完成。 |
| 运行时网络调用 | ❌ 不允许 | 模拟数据由 fixture/transform 产生。 |
| Playwright / Cypress / E2E | ❌ 不允许 | 仅单元测试与 benchmark 脚本。 |
| 会话持久化（localStorage 等） | ❌ 不允许 | 不在 Phase 5K 范围内。 |
| 报告生成 Agent | ❌ 不允许 | 不导出 Markdown / PDF / 报告 UI。 |
| SQL Workbench 主逻辑 | ❌ 不允许改动 | 只可能在 `AskWorkbenchPage` 做极小防御性展示。 |
| 历史 untracked docs / `.venv` | ❌ 不处理 | 维持现有 untracked 状态。 |
| CI / GitHub Actions | ❌ 不新增 | benchmark 仍通过本地 `npx tsx` 运行。 |

### 2.2 非目标

- 不重构 prompt 模板工程。
- 不引入生产监控看板。
- 不做后端数据存储或会话管理。
- 不生成用户可见的新页面或大段 UI。

---

## 3. 术语

| 术语 | 含义 |
|---|---|
| **Adapter Contract** | `AiAskAdapter.analyze(question, context)` 的输入与 `AiAskResponse` 输出的字段规则集合。 |
| **Contract Validator** | 纯函数 `validateAiAskResponse(response)`，返回 `ValidationResult`（不抛错）。 |
| **Prompt Simulation** | 不调用 LLM，仅通过 transform 函数把“正常响应”改成“真实 LLM 可能返回的异常响应”。 |
| **Fault Injection** | 在 `MockAdapter.analyze` 中通过 `context.options.simulateResponseFault` 触发指定异常响应。 |
| **Degradation Path** | 当响应不符合 contract 时，系统如何降级：保留有效字段、给出 warning、或抛出 `AiAskError`。 |

---

## 4. 当前 Adapter 协议现状

### 4.1 Adapter 接口

文件：`frontend/src/api/aiAsk/adapter.ts`

```typescript
export interface AiAskContext {
  datasourceId: number | null
  datasourceName: string | null
  selectedTables: string[]
  messageHistory?: Array<{
    role: 'user' | 'assistant'
    content: string
    responseJson?: Record<string, unknown>
  }>
  options?: {
    mockDelay?: [number, number]
    mockFailureRate?: number
    forceFollowUpType?: FollowUpType
  }
}

export interface ChartDataResult {
  columns: string[]
  rows: any[][]
  isEmpty: boolean
  error?: string
}

export interface AiAskAdapter {
  analyze(question: string, context: AiAskContext): Promise<AiAskResponse>
  getChartData(spec: AiChartSpec, response: AiAskResponse): ChartDataResult
  isAvailable(): boolean
  readonly name: string
}
```

### 4.2 错误协议

文件：`frontend/src/api/aiAsk/errors.ts`

```typescript
export type AiAskErrorCode =
  | 'ANALYSIS_TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'NO_DATA'
  | 'ADAPTER_UNAVAILABLE'
  | 'CONTEXT_TOO_LARGE'
  | 'UNKNOWN'

export class AiAskError extends Error {
  constructor(
    message: string,
    public code: AiAskErrorCode,
    public details?: Record<string, unknown>
  ) { ... }
}
```

Phase 5K **不修改** `AiAskErrorCode`，也不改变 `AiAskError` 结构。validator 发现 contract 失败时，仍由调用方（如 `MockAdapter`）包装成 `INVALID_RESPONSE` 抛出。

### 4.3 校验器现状

文件：`frontend/src/api/aiAsk/validator.ts`

当前 `validateAiAskResponse(response: unknown)` 已检查：

- `question` 必须为 string 且非空（error）。
- `intent` 必须为 object（error）；若 `metrics` 与 `dimensions` 同时为空则 warning。
- `sqlPlan.sql` 必须为 string 且非空（error）；`sqlPlan.tables` 为空则 warning。
- `chartSuggestions` 为空 warning；每个 spec 的 `title` 缺失为 error；`chartType` 不合法为 warning。
- `narrative` 缺失为 warning；`narrative.summary` 缺失为 warning。
- `semanticGaps` 中每个 `field` 缺失为 warning。

返回类型：

```typescript
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
```

### 4.4 Benchmark Runner 现状

文件：`frontend/scripts/runQualityBenchmarks.ts`

当前包含 5 个模块：

- `inputGuard`
- `contextPolicy`
- `followUpDetector`
- `adapter`
- `evidenceQuality`

Phase 5K 将新增：

- `adapterContract`
- `promptSimulation`

### 4.5 Phase 5J Evidence 字段现状

文件：`frontend/src/types/aiAsk.ts`

`EvidenceItem` 已扩展以下可选字段：

- `sourceFields?: string[]`
- `calculation?: string`
- `confidence?: 'high' | 'medium' | 'low'`
- `confidenceReason?: string`
- `relatedIntent?: { metrics: string[]; dimensions: string[]; filters?: string[]; timeRange?: string }`
- `displayValue?: string`

`AiInsightNarrative` 新增 `evidenceSummary?: string`。  
`ProcessInsight` 新增 `mappingChain?: Array<{ step; label; detail?; fields? }>`。

这些字段全部是**可选字段**，Phase 5K 保持向后兼容。

---

## 5. Adapter Contract

### 5.1 设计原则

1. **向后兼容**：所有 Phase 5H/5J 新增字段保持可选；Phase 5K 只增加“校验规则”，不破坏既有 mock scenario。
2. **最小必要**：真实 LLM 必须返回的核心字段列为 error 级；增强体验字段列为 warning 级。
3. **不耦合 UI**：contract 只描述数据，不描述展示方式。

### 5.2 输入 Contract

`analyze(question: string, context: AiAskContext)` 的输入约束：

| 字段 | 规则 | 级别 |
|---|---|---|
| `question` | 非空字符串；长度 ≤ 1000 字符，与 Phase 5K 调整后的 Input Guard 保持一致 | error |
| `context.datasourceId` | `number \| null`；非 null 时代表真实数据源 | — |
| `context.datasourceName` | `string \| null` | — |
| `context.selectedTables` | `string[]` | — |
| `context.messageHistory` | 可选；每项必须含 `role`、`content`；`responseJson` 可选 | warning（格式异常时） |
| `context.options` | 可选；仅用于 mock/test 场景 | — |
| `context.options.simulateResponseFault` | **Phase 5K 新增**；可选枚举，用于注入 LLM 失败模拟 | — |

> 当前 `frontend/src/api/aiAsk/inputGuard.ts` 中 `MAX_INPUT_LENGTH = 500`，错误提示为“问题过长，请缩短到 500 字以内”。Phase 5K 授权将其调整为 **1000**，原因是 Adapter Contract / 真实 LLM 前准备需要支持更完整的业务问题描述；同时明确不使用 2000，避免用户粘贴长文档导致 prompt / context 边界失控。所有相关单元测试、错误提示文案、`inputGuard.bench.ts` 的边界 case 都应同步更新到 1000。

Phase 5K 将把 `context.options` 扩展一个字段：

```typescript
options?: {
  mockDelay?: [number, number]
  mockFailureRate?: number
  forceFollowUpType?: FollowUpType
  simulateResponseFault?: LlmResponseFaultType
}
```

`LlmResponseFaultType` 见第 6 节。

### 5.3 输出 Contract：`AiAskResponse`

#### 5.3.1 顶层字段规则

| 字段 | 类型 | 必填 | 规则 | 校验级别 |
|---|---|---|---|---|
| `question` | `string` | ✅ | 非空 string | error |
| `intent` | `object` | ✅ | 见下 | error |
| `sqlPlan` | `object` | ✅ | 见下 | error |
| `resultSummary` | `object` | ❌ | `rowCount`、`durationMs`、`truncated?` | warning（缺失） |
| `chartSuggestions` | `AiChartSpec[]` | ✅ | 缺失或非数组：error；空数组：warning | error / warning |
| `narrative` | `object` | ✅ | 至少含 `summary` 与 `evidence` | error（缺失对象或必填字段） |
| `semanticGaps` | `SemanticGap[]` | ✅ | 缺失或非数组：error；空数组：合法 | error / — |
| `followUp` | `FollowUpQuestion` | ❌ | 追问上下文时提供 | — |
| `contextSummary` | `string` | ❌ | 多轮压缩摘要 | — |

> **TypeScript 类型边界说明**：`AiAskResponse` 类型中 `chartSuggestions` 与 `semanticGaps` 都是必填数组字段，因此 validator 对“缺失或非数组”判为 error。真实 LLM 返回的 raw partial response 必须先 normalize 成符合 TypeScript 类型的 `AiAskResponse`，再交给 UI；Phase 5K 不实现完整 normalizer，仅提供 validator + simulation。

#### 5.3.2 `intent` 字段规则

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `metrics` | `string[]` | ✅ | 至少一个，当 `dimensions` 为空时尤为重要 |
| `dimensions` | `string[]` | ✅ | 可为空数组 |
| `filters` | `string[]` | ✅ | 可为空数组 |
| `timeRange` | `string` | ❌ | 可选 |

#### 5.3.3 `sqlPlan` 字段规则

| 字段 | 类型 | 必填 | 规则 | 级别 |
|---|---|---|---|---|
| `datasourceId` | `number` | ✅ | 必须存在 | error |
| `datasourceName` | `string` | ✅ | 缺失或非 string：error；空 string：warning | error / warning |
| `sql` | `string` | ✅ | 非空字符串 | error |
| `tables` | `string[]` | ✅ | 缺失或非数组：error；空数组：warning | error / warning |
| `fields` | `string[]` | ✅ | 缺失或非数组：error；空数组：warning | error / warning |
| `assumptions` | `string[]` | ✅ | 缺失或非数组：error；空数组：允许 | error / — |
| `safetyWarnings` | `string[]` | ✅ | 缺失或非数组：error；空数组：允许 | error / — |

#### 5.3.4 `narrative` 字段规则

| 字段 | 类型 | 必填 | 规则 | 级别 |
|---|---|---|---|---|
| `summary` | `string` | ✅ | 非空 | error |
| `keyFindings` | `string[]` | ✅ | 缺失或非数组：error；空数组：warning | error / warning |
| `evidence` | `EvidenceItem[]` | ✅ | 非空数组 | error |
| `risks` | `Array<string \| RiskItem>` | ✅ | 缺失或非数组：error；空数组：允许 | error / — |
| `nextQuestions` | `Array<string \| NextQuestion>` | ✅ | 缺失或非数组：error；空数组：允许 | error / — |
| `conclusion` | `string` | ❌ | 推荐存在 | warning（缺失） |
| `evidenceSummary` | `string` | ❌ | 可选 | — |

#### 5.3.5 `EvidenceItem` 字段规则

| 字段 | 类型 | 必填 | 规则 | 级别 |
|---|---|---|---|---|
| `claim` | `string` | ✅ | 非空 | error |
| `fields` | `string[]` | ✅ | 非空 | error |
| `sqlSnippet` | `string` | ❌ | 推荐非空 | warning（缺失） |
| `value` | `string` | ❌ | 可选 | — |
| `significance` | `string` | ❌ | 可选 | — |
| `sourceFields` | `string[]` | ❌ | 推荐非空 | warning（缺失） |
| `calculation` | `string` | ❌ | 推荐非空 | warning（缺失） |
| `confidence` | `'high' \| 'medium' \| 'low'` | ❌ | 推荐存在；非法值 warning | warning |
| `confidenceReason` | `string` | 条件 | `confidence` 非 `high` 时推荐 | warning（缺失且 confidence 非 high） |
| `relatedIntent` | `object` | ❌ | 若存在，必须含 `metrics` 与 `dimensions` | warning |
| `displayValue` | `string` | ❌ | 可选 | — |

#### 5.3.6 `FollowUpQuestion` 字段规则

| 字段 | 类型 | 必填 | 规则 | 级别 |
|---|---|---|---|---|
| `type` | `FollowUpType` | ✅ | 必须属于合法枚举 | error |
| `confidence` | `'high' \| 'medium' \| 'low'` | ✅ | 必须属于合法枚举 | error |
| `targetFields` | `string[]` | ❌ | 可选 | — |
| `targetDimension` | `string` | ❌ | 可选 | — |
| `targetValue` | `string` | ❌ | 可选 | — |
| `relatedMetrics` | `string[]` | ❌ | 可选 | — |
| `relatedDimensions` | `string[]` | ❌ | 可选 | — |
| `relatedFilter` | `string` | ❌ | 可选 | — |
| `timeRangeShift` | `string` | ❌ | 可选 | — |
| `inferenceReason` | `string` | ❌ | 可选 | — |

#### 5.3.7 `SemanticGap`

| 字段 | 类型 | 必填 | 规则 | 级别 |
|---|---|---|---|---|
| `field` | `string` | ✅ | 非空 | warning（缺失） |
| `reason` | `GapReason` | ❌ | 推荐存在；非法值 warning | warning |
| `candidates` | `string[]` | ❌ | 可选 | — |
| `suggestion` | `string` | ❌ | 可选 | — |

> **ProcessInsight / mappingChain 边界说明**：`ProcessInsight` 与 `mappingChain` **不属于** `AiAskResponse`。`mappingChain` 是 `AskWorkbenchPage` 通过 `buildProcessInsight(response, prevChain)` 派生出的 UI 状态，不是 Adapter 返回 contract 的一部分。Phase 5K 不把它纳入 `validateAiAskResponse`，也不修改 `buildProcessInsight` / `ProcessPanel` 主流程。如需覆盖 `mappingChain`，继续依赖现有 Phase 5J 组件测试。

### 5.4 向后兼容策略与 TypeScript 类型边界

- 所有新增 Phase 5H/5J 字段保持可选。
- **TypeScript 必填字段**（如 `question`、`intent`、`sqlPlan`、`chartSuggestions`、`semanticGaps`、`narrative.summary`、`narrative.evidence`、`narrative.keyFindings`、`narrative.risks`、`narrative.nextQuestions`、`sqlPlan.datasourceId`、`sqlPlan.datasourceName`、`sqlPlan.tables` 等）缺失或类型错误时，validator 判为 `error`。
- **质量缺陷**（如空数组、空字符串、confidence 非 high 却缺少 reason）判为 `warning`。
- 如果未来真实 LLM 返回 raw partial response，必须先通过 normalizer 补全成符合 `AiAskResponse` TypeScript 类型的对象，再交给 UI。Phase 5K 不实现完整 normalizer，只定义 contract、扩展 validator、并提供 failure simulation fixtures。
- `validateAiAskResponse` 的返回结构不变；调用方可通过 `warnings` 数组决定是否展示提示，而不改变既有组件的 props。
- 任何导致 `errors.length > 0` 的校验失败，仍由 adapter 包装成 `new AiAskError('AI 返回结果异常，请重试', 'INVALID_RESPONSE', { errors })`；UI 侧的错误边界与 loading 逻辑无需修改。
- Phase 5K **不修改** `AiAskErrorCode` 与 `AiAskError` 构造函数签名，仍保持 `new AiAskError(message, code, details?)`。

---

## 6. Prompt Simulation

### 6.1 设计原则

- **不调用真实 LLM**：所有异常响应由 transform 函数对正常 scenario response 做字段删减/篡改生成。
- **可复用**：模拟函数返回 `Partial<AiAskResponse>` 或完整 `AiAskResponse`，可被 benchmark、单元测试复用。
- **不侵入主流程**：默认 `MockAdapter` 不启用 simulation；仅当 `context.options.simulateResponseFault` 显式设置时才触发。
- **覆盖真实 LLM 典型失败**：缺字段、类型错误、不完整 narrative/evidence、非法枚举、sqlPlan 缺失、semantic gap 冲突、超时/空/不可解析响应。

### 6.2 Fault 类型定义

```typescript
export type LlmResponseFaultType =
  | 'missing_top_level_fields'      // 删除 question / intent / sqlPlan
  | 'wrong_field_types'             // 把 string 改成 number，数组改成 string 等
  | 'incomplete_narrative'          // narrative.summary / evidence 为空
  | 'incomplete_evidence'           // evidence 中 claim / fields 缺失
  | 'invalid_followup_confidence'   // followUp.confidence 为非法值
  | 'missing_sql_plan_tables'       // sqlPlan.tables / fields 为空
  | 'semantic_gap_conflict'         // semantic gap 与 intent 冲突（如 gap.field 出现在 intent.metrics）
  | 'empty_response'                // response 为 null
  | 'unparseable_response'          // response 为非对象 / 含循环结构模拟
  | 'timeout'                       // 模拟 ANALYSIS_TIMEOUT
```

### 6.3 Simulation 实现方式

#### 6.3.1 Fixture Transform 函数

新增文件：`frontend/src/api/aiAsk/promptSimulation.ts`

核心函数：

```typescript
export function simulateLlmFault(
  baseResponse: AiAskResponse,
  fault: LlmResponseFaultType,
): unknown
```

返回值类型为 `unknown`，以模拟真实 LLM 返回的不可信数据。

实现要点：

- 对 `baseResponse` 做深拷贝后，按 `fault` 类型修改。
- `timeout` 不通过 transform 实现，而是由 `MockAdapter` 直接抛出 `new AiAskError('模拟分析超时', 'ANALYSIS_TIMEOUT')`。
- `empty_response` 返回 `null`。
- `unparseable_response` 返回非对象值，如 `string` 或 `number`。

#### 6.3.2 MockAdapter Fault Injection

在 `MockAdapter.analyze` 中：

1. 正常匹配 scenario 并生成 `response`。
2. 若 `context.options.simulateResponseFault` 存在，则：
   - 若 fault 为 `timeout`，直接抛出 `new AiAskError('模拟分析超时', 'ANALYSIS_TIMEOUT')`。
   - 否则调用 `simulateLlmFault(response, fault)` 得到异常响应。
   - 把异常响应传给 `validateAiAskResponse`。
   - 由于 validator 返回 `valid: false` 与 errors，`MockAdapter` 抛出 `new AiAskError('Mock adapter produced invalid follow-up response', 'INVALID_RESPONSE', { errors, simulatedFault: fault })`。
3. 默认路径（无 fault）保持不变，仍校验并返回正常响应。

这样，测试代码可以写：

```typescript
await expect(
  adapter.analyze('任意问题', {
    ...context,
    options: { simulateResponseFault: 'missing_top_level_fields' },
  })
).rejects.toThrow(AiAskError)
```

### 6.4 Simulation 与 Contract Validator 的关系

- `simulateLlmFault` 只负责**生成异常输入**。
- `validateAiAskResponse` 只负责**检测异常**。
- `MockAdapter` 负责把 detection 结果转成 `AiAskError` 抛出。
- benchmark 可以直接调用 `simulateLlmFault + validateAiAskResponse`，不经过 adapter。

### 6.5 Simulation 不进入用户主流程

- `AskWorkbenchPage`、`aiAskStore`、`ProcessPanel`、`AiNarrative` 等用户主流程代码**不读取** `simulateResponseFault`。
- 该字段仅出现在 `MockAdapter` 与测试/脚本中。
- 生产构建中 tree-shaking 可移除这些模拟逻辑，因为它们只通过 `options` 触发且被明确标记为 dev-only。

---

## 7. Contract Validator

### 7.1 设计原则

- **纯函数**：输入 `unknown`，输出 `ValidationResult`。
- **不抛错**：即使 response 为空对象，也返回包含 errors 的 `ValidationResult`。
- **不改返回协议**：不新增或删除 `AiAskResponse` 字段。
- **错误与警告分离**：error 阻断响应可用性；warning 仅提示质量缺陷。
- **向后兼容**：旧格式 `EvidenceItem`（缺少 Phase 5J 字段）不产生 error，只产生 warning。

### 7.2 扩展现有 `validateAiAskResponse`

在 `frontend/src/api/aiAsk/validator.ts` 中扩展，新增检查项：

| 检查项 | 说明 | 级别 |
|---|---|---|
| `question` 非空 string | 只校验 response.question，不校验与输入是否一致 | error |
| `intent` 存在且为 object | TypeScript 必填 | error |
| `intent.metrics` / `intent.dimensions` 类型 | 必须为 string 数组 | error |
| `intent.metrics` 与 `intent.dimensions` 同时为空 | 视为理解失败 | warning |
| `sqlPlan` 存在且为 object | TypeScript 必填 | error |
| `sqlPlan.datasourceId` | 必须为 number | error |
| `sqlPlan.datasourceName` | 缺失或非 string：error；空 string：warning | error / warning |
| `sqlPlan.sql` 非空 string | 必须 | error |
| `sqlPlan.tables` | 缺失或非数组：error；空数组：warning | error / warning |
| `sqlPlan.fields` | 缺失或非数组：error；空数组：warning | error / warning |
| `sqlPlan.assumptions` / `safetyWarnings` | 缺失或非数组：error；空数组：允许 | error / — |
| `chartSuggestions` | 缺失或非数组：error；空数组：warning | error / warning |
| `narrative` 存在且为 object | TypeScript 必填 | error |
| `narrative.summary` 非空 | 必须 | error |
| `narrative.keyFindings` | 缺失或非数组：error；空数组：warning | error / warning |
| `narrative.evidence` 非空数组 | 必须 | error |
| `narrative.risks` / `narrative.nextQuestions` | 缺失或非数组：error；空数组：允许 | error / — |
| `narrative.evidence[i].claim` 非空 | 必须 | error |
| `narrative.evidence[i].fields` 非空 string[] | 必须 | error |
| `narrative.evidence[i].confidence` 合法枚举 | `'high' \| 'medium' \| 'low'` | warning |
| `narrative.evidence[i].confidenceReason` | 非 high 时推荐 | warning |
| `narrative.evidence[i].relatedIntent` | 若存在必须含 `metrics` 与 `dimensions` | warning |
| `semanticGaps` | 缺失或非数组：error；空数组：合法 | error / — |
| `semanticGaps[i].field` 非空 | 推荐 | warning |
| `semanticGaps[i].reason` 合法枚举 | `'not_found' \| 'ambiguous' \| 'incomplete'` | warning |
| `semantic gap 与 intent 冲突` | `gap.field` 不应出现在 `intent.metrics` 中 | warning |
| `followUp.type` 合法枚举 | 必须 | error（当 followUp 存在时） |
| `followUp.confidence` 合法枚举 | 必须 | error（当 followUp 存在时） |

### 7.3 降级路径

- 若 validator 返回 `valid: true`：响应直接交给 UI。
- 若 validator 返回 `valid: false`：
  - `MockAdapter` 抛出 `new AiAskError('Mock adapter produced invalid response', 'INVALID_RESPONSE', { errors: validation.errors })`。
  - 真实 LLM Adapter 未来可在此基础上选择：
    - 直接抛出错误让用户重试。
    - 或进入“部分渲染”模式：过滤掉不可信字段，只展示验证通过的部分。
  - Phase 5K 只定义 contract 与 validator，不实现真实 LLM Adapter 的降级策略。

### 7.4 zod 依赖决策

Phase 5K **默认不引入 zod**。原因：

- 现有 validator 是手写轻量函数，已覆盖 90% 的 contract 检查。
- 新增字段规则多为 warning 级，并需要语义级检查（如 sourceFields 与 fields 交叉引用、semantic gap 与 intent 冲突），这些用 zod 并不能显著简化。
- 项目当前无 zod 依赖；新增依赖会增加 `package-lock.json`、CI 安装时间与学习成本。

**若后续 Phase 需要对接 3+ 个真实 LLM provider 且返回结构差异大**，可重新评估 zod：

| 方案 | 收益 | 成本 |
|---|---|---|
| 继续手写 validator | 零依赖；与现有 `ValidationResult` 结构完全兼容；warning/error 自定义灵活 | 字段多时代码冗长 |
| 引入 zod | 类型与运行时校验统一；schema 自文档化；复杂嵌套对象校验更短 | 新增依赖；warning/error 自定义需适配；与 `ValidationResult` 转换有胶水代码 |

结论：Phase 5K 手写扩展；在 spec 中保留“zod 可选评估”记录，但不引入。

---

## 8. Benchmark 扩展

### 8.1 新增模块

#### 8.1.1 `frontend/scripts/benchmarks/adapterContract.bench.ts`

目标：验证所有 scenario response 都满足扩展后的 contract。

测试内容：

1. 遍历 `MOCK_SCENARIOS` 与 `FOLLOW_UP_SCENARIOS` 的 `response`。
2. 对每个 response 调用 `validateAiAskResponse`。
3. 断言 `valid === true`（因为当前 scenario 数据是干净的）。
4. 对每个 warning 进行基线记录：当前 scenario 允许存在 warning，但新增 warning 必须被审查。

输出：`ModuleReport`。

#### 8.1.2 `frontend/scripts/benchmarks/promptSimulation.bench.ts`

目标：验证 prompt simulation 产生的异常响应都能被 validator 正确识别。

测试内容：

1. 选择一个干净的 scenario response 作为 base。
2. 对每个 `LlmResponseFaultType`（除 `timeout` 外）调用 `simulateLlmFault` + `validateAiAskResponse`。
3. 断言 validator 返回 `valid: false` 或至少包含预期 warning/error path。
4. 对 `timeout` 直接断言 `MockAdapter` 抛出 `new AiAskError('模拟分析超时', 'ANALYSIS_TIMEOUT')`。

输出：`ModuleReport`。

### 8.2 接入 `runQualityBenchmarks.ts`

修改 `frontend/scripts/runQualityBenchmarks.ts`：

```typescript
import { runAdapterContractBenchmark } from './benchmarks/adapterContract.bench'
import { runPromptSimulationBenchmark } from './benchmarks/promptSimulation.bench'

interface QualityBenchmarkReport {
  ...
  modules: {
    inputGuard: ModuleReport
    contextPolicy: ModuleReport
    followUpDetector: ModuleReport
    adapter: ModuleReport
    evidenceQuality: ModuleReport
    adapterContract: ModuleReport
    promptSimulation: ModuleReport
  }
}
```

运行方式保持本地脚本：

```bash
cd frontend && npx tsx scripts/runQualityBenchmarks.ts
```

### 8.3 报告格式兼容

新增的 `adapterContract` 与 `promptSimulation` 模块复用现有 `ModuleReport` 接口，不改动 JSON schema 的顶层结构，只扩展 `modules` 对象的 key 集合。

---

## 9. UI / 运行时影响

### 9.1 默认不新增用户可见 UI

- 不新增页面、弹窗、侧边栏、按钮。
- 不改 `AskWorkbenchPage` 主流程。
- 不改 `ProcessPanel`、`AiNarrative` 的 props 与渲染逻辑。

### 9.2 可能的极小防御性改动

如果 Phase 5K 的 validator 在运行时发现某些 mock scenario 存在 warnings，现有 UI 已能正常渲染（因为字段均为可选）。

仅在以下情况允许做 1-2 行的防御性改动：

- `ProcessPanel.tsx` 中对 `mappingChain` 的 normalization 已在 Phase 5J 完成，Phase 5K 保持。
- 若在 validator 扩展后发现组件存在运行时崩溃风险，可在对应组件加可选链或 fallback，但须经审查且不得影响主流程。

### 9.3 性能影响

- validator 为纯函数，单次响应校验对象大小 < 50KB，耗时 < 1ms。
- benchmark 脚本仅在本地开发/发布前运行，不影响生产运行时。

---

## 10. 测试策略

### 10.1 单元测试

新增或扩展以下测试文件：

| 文件 | 覆盖内容 |
|---|---|
| `frontend/src/api/aiAsk/validator.test.ts` | 覆盖所有 error/warning 规则，包括 Phase 5K 新增规则（evidence 完整性、followUp 枚举、semantic gap 冲突）。`ProcessInsight.mappingChain` 不属于 `AiAskResponse`，不在 validator 测试范围内。 |
| `frontend/src/api/aiAsk/promptSimulation.test.ts` | 覆盖每个 `simulateLlmFault` 分支，验证返回值的异常路径正确。 |
| `frontend/src/api/aiAsk/mockAdapter.test.ts` 或扩展现有测试 | 覆盖 `options.simulateResponseFault` 触发 `AiAskError` 的路径。 |

此外，`frontend/src/api/aiAsk/inputGuard.ts`、`frontend/src/api/aiAsk/inputGuard.test.ts` 与 `frontend/scripts/benchmarks/inputGuard.bench.ts` 中的 `MAX_INPUT_LENGTH`、边界 case、错误提示文案需从 500 同步更新到 1000。

### 10.2 Benchmark 测试

- 本地运行 `npx tsx scripts/runQualityBenchmarks.ts` 时，`adapterContract` 与 `promptSimulation` 必须 100% 通过。
- 新增 benchmark 不接入 CI，但需要在 Phase 5K 完成报告中记录运行结果。

### 10.3 回归验证

Phase 5K 完成后必须运行：

```bash
cd frontend && npm test               # 现有 447+ 测试仍需通过
cd frontend && npx tsc --noEmit       # 0 类型错误
cd frontend && npm run build          # 构建成功
cd frontend && npx tsx scripts/runQualityBenchmarks.ts  # 新增模块后 100% 通过
python -m pytest tests/ -q            # 后端 0 改动，仍需 299 passed
```

---

## 11. 实施风险与回滚

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 扩展 validator 导致现有 scenario 出现新 warning | benchmark/测试失败 | 保持新规则为 warning；对 scenario 数据做最小补齐，不破坏向后兼容。 |
| `simulateResponseFault` 意外进入生产代码 | 用户可能触发异常 | 该字段只在 `options` 中，UI 不暴露；搜索代码确保无业务组件读取。 |
| benchmark 报告 JSON schema 变更 | 若有外部脚本解析旧格式会失败 | 只新增 `modules` key，不删除旧 key；在报告中记录新增模块。 |
| 过度设计真实 LLM 接入策略 | 超出当前阶段 | Phase 5K 只做 contract 与 simulation，不实现真实 LLM Adapter。 |

回滚策略：若任何扩展导致主流程异常，可直接回退 `validator.ts` 的变更并移除新增 benchmark 模块；`AiAskResponse` 类型与 `AiAskError` 协议保持不变。

---

## 12. 依赖决策：zod

- **Phase 5K 不引入 zod**。
- 手写扩展 `validateAiAskResponse` 的成本在当前字段规模下可控。
- 保留 zod 作为未来“真实 LLM 多 provider schema 统一”阶段的可选方案，届时需单独评估收益与迁移成本。

---

## 13. 附录 A：字段必填/可选汇总表

### 13.1 `AiAskResponse` 顶层

| 字段 | 类型 | 必填 | 校验级别 |
|---|---|---|---|
| `question` | `string` | ✅ | error |
| `intent` | `object` | ✅ | error |
| `sqlPlan` | `object` | ✅ | error |
| `resultSummary` | `object` | ❌ | warning |
| `chartSuggestions` | `AiChartSpec[]` | ✅ | error（缺失/非数组）；warning（空数组） |
| `narrative` | `object` | ✅ | error |
| `semanticGaps` | `SemanticGap[]` | ✅ | error（缺失/非数组）；空数组合法 |
| `followUp` | `FollowUpQuestion` | ❌ | — |
| `contextSummary` | `string` | ❌ | — |

### 13.2 `AiAskContext.options` 扩展

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `mockDelay` | `[number, number]` | ❌ | 现有 |
| `mockFailureRate` | `number` | ❌ | 现有 |
| `forceFollowUpType` | `FollowUpType` | ❌ | 现有 |
| `simulateResponseFault` | `LlmResponseFaultType` | ❌ | Phase 5K 新增 |

### 13.3 `LlmResponseFaultType`

| 值 | 模拟场景 |
|---|---|
| `missing_top_level_fields` | 删除 question / intent / sqlPlan |
| `wrong_field_types` | 字段类型错误 |
| `incomplete_narrative` | narrative.summary / evidence 为空 |
| `incomplete_evidence` | evidence 中 claim / fields 缺失 |
| `invalid_followup_confidence` | followUp.confidence 非法 |
| `missing_sql_plan_tables` | sqlPlan.tables / fields 为空 |
| `semantic_gap_conflict` | gap.field 与 intent.metrics 冲突 |
| `empty_response` | response 为 null |
| `unparseable_response` | response 为非对象 |
| `timeout` | 模拟 ANALYSIS_TIMEOUT |

---

## 14. 待审阅 checklist

- [x] 无 TBD / TODO / 占位符。
- [x] `AiAskAdapter` 接口未被破坏。
- [x] `AiAskError` 与 `AiAskErrorCode` 未被修改。
- [x] 不引入真实 LLM、后端 API、DB migration。
- [x] 不漂移到会话管理或报告生成。
- [x] zod 依赖被明确评估并决定不引入。
- [x] 所有 Phase 5H/5J 新增字段保持可选，向后兼容。
- [x] benchmark 模块扩展方式已明确。
- [x] UI 影响限定为“默认无新增”。

---

**本 spec 等待用户审阅。审阅通过后，再进入 implementation plan 编写。**
