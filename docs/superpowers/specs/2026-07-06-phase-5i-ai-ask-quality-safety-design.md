# Phase 5I AI 问数质量与安全保障设计说明书

日期：2026-07-06

状态：正式设计 spec，用于后续 implementation plan

修订记录：
| 版本 | 日期 | 内容 |
|------|------|------|
| v1.0 | 2026-07-06 | 初始正式设计 |

关联资料：
- [Phase 5H AI 问数多轮追问与上下文理解增强设计说明书](./2026-07-05-phase-5h-ai-ask-followup-context-design.md)
- [Phase 5G AI 问数工作台增强设计说明书](./2026-07-04-phase-5g-chart-enhancement-and-llm-adapter-design.md)
- [Phase 5F AI 问数 Agent 产品底座设计说明书](./2026-07-03-phase-5f-ai-ask-agent-workbench-design.md)

---

## 1. 产品定位

### 1.1 核心命题

Phase 5I 的产品核心是 **AI 问数质量与安全保障**，不是报告 Agent、不是实现层功能、不是后端改造。

Phase 5F/G/H 交付了完整的 AI 问数能力——产品底座、图表美化、多轮追问。但缺少系统性的质量保障：用户输入无校验、上下文缺少管理策略、错误处理未形成闭环、质量评估依赖人工目测。

Phase 5I 的目标是在现有功能基础上（不做任何功能新增）建立四道防线：

```
当前：
  用户输入 → adapter.analyze() → AiAskResponse or AiAskError → UI 渲染
  （无输入校验、无上下文策略、错误处理分散）

Phase 5I 目标：
  用户输入 ──>[Input Guard]──> 校验通过
         |                        |
         | (阻断: 空/超长/乱码)     └──>[Context Policy]──> 上下文组装
                                                       |
                                                       └──>[Adapter.analyze()]
                                                             |
                                                    ┌───────┴───────┐
                                                    ↓               ↓
                                              AiAskResponse    AiAskError
                                                    │               │
                                                    ↓               ↓
                                              [Error Recovery]  UI 展示
                                                    │
                                                    └──> 质量报告 ← [Benchmark Runner]
```

### 1.2 四道防线概览

| 防线 | 模块 | 职责 | 位置 | 阻断等级 |
|------|------|------|------|---------|
| 第1道 | Input Guard | 输入校验：空/超长/乱码 → 阻断 analyze 调用 | UI 纯函数 + page 集成 | 阻断（blocking） |
| 第2道 | Context Policy | 上下文组装与压缩：按策略裁剪 messageHistory | 纯函数 + page 集成 | 降级（degrading） |
| 第3道 | Error Recovery | 错误处理闭环：统一错误码 + 用户消息 + 降级策略 | 已有 AiAskError 增强 | 恢复（recovering） |
| 第4道 | Benchmark Runner | 本地开发期质量评估：手动运行，输出 JSON 报告 | 独立脚本 | 检测（detecting） |

### 1.3 Phase 5I 在路线图中的位置

| Phase | 目标 | 状态 |
|-------|------|------|
| Phase 5F | AI 问数 Agent 产品底座 | ✅ 已完成 |
| Phase 5G | AI 图表美化与 Adapter 协议 | ✅ 已完成 |
| Phase 5H | 多轮追问与上下文理解增强 | ✅ 已完成 |
| **Phase 5I（当前）** | **AI 问数质量与安全保障** | **⬅️ 当前** |
| Phase 5J | AI 报告 Agent | 后续 Phase |

Phase 5I 不改变路线图：它为 Phase 5J 及以后的 LLM 真实接入提供质量保障基础，是基础设施而非用户可见功能。

---

## 2. Multi-Module A: Input Guard（输入校验）

### 2.1 动机

当前状态：AskWorkbenchPage.handleSend 直接将用户输入传给 adapter.analyze()，无任何前端校验。空字符串、纯标点、超长文本、乱码输入直接触发 analyze 调用，浪费 mock 计算资源（未来 LLM 调用将产生实际成本）。

### 2.2 设计：`validateAiAskInput(question: string)` 纯函数

```typescript
// frontend/src/api/aiAsk/inputGuard.ts — 新增

export interface InputValidationResult {
  valid: boolean
  error?: {
    code: InputGuardErrorCode
    message: string       // 可读错误提示（中文）
  }
}

export type InputGuardErrorCode =
  | 'EMPTY_INPUT'           // 空输入
  | 'PUNCTUATION_ONLY'      // 纯标点/空格
  | 'TOO_LONG'              // 超过最大长度
  | 'INVALID_CHARS'         // 无效字符（不可见控制字符等）

export const MAX_INPUT_LENGTH = 500  // MVP 阻断阈值

export function validateAiAskInput(question: string): InputValidationResult
```

**校验规则（按优先级）**：

| 规则 | 条件 | error.code | 阻断 |
|------|------|-----------|------|
| 空输入 | question.trim().length === 0 | EMPTY_INPUT | ✅ |
| 纯标点/空格 | 去除空格后仅包含标点符号 | PUNCTUATION_ONLY | ✅ |
| 超长输入 | question.length > MAX_INPUT_LENGTH | TOO_LONG | ✅ |
| 无效字符 | 包含 \x00-\x08 等控制字符（允许 \n \t） | INVALID_CHARS | ✅ |

**超长输入语义（关键设计决策）**：
- Phase 5I MVP 选择 **阻断提交**，不截断输入。
- 当输入长度 > 500 字符时，`handleSend` 不调用 adapter.analyze()，直接显示输入提示："问题过长，请缩短到 500 字以内"。
- `resultSummary.truncated` 字段是**查询结果截断**（后端返回行数截断），与用户输入截断无关，不要混用。
- 未来（非 MVP）可考虑截断策略，但目前阻断更简单可靠。

### 2.3 调用位置：AskInput + AskWorkbenchPage.handleSend

**不再仅放在 AskInput.tsx 中。** `inputGuard` 是共享纯函数，在两个层次生效：

1. **AskInput（UI 层）**：输入框下方实时显示校验状态（灰色提示 → 红色错误），用户获取即时反馈。不阻断发送按钮。
2. **AskWorkbenchPage.handleSend（边界层）**：最终阻断。在调用 adapter.analyze() 之前（以及任何前置数据处理之前）执行 `validateAiAskInput(question)`。校验不通过 → 不调用 analyze，直接设置 error 状态。

```
handleSend(question):
  1. const validation = validateAiAskInput(question)
  2. if (!validation.valid):
     a. setInputError(validation.error.message)  // UI 展示
     b. return  // 不调用 adapter.analyze()
  3. // 校验通过，继续处理
  4. adapter.analyze(question, context)...
```

**为什么双层**：
- 推荐追问（AiNarrative.nextQuestions 点击）、PromptCards、AiNarrative.onAskQuestion 等路径可能绕过 AskInput。
- handleSend 是所有"发送问题"路径的唯一汇集点，在此兜底确保无一遗漏。

### 2.4 错误反馈形态

```
┌──────────────────────────────────────────────┐
│  [ ] 各区域近30天销售额                        │  ← AskInput
│                                               │
│  发送 [>]                                     │
│                                               │
│  ⚠ 问题过长，请缩短到 500 字以内              │  ← 红色错误提示
└──────────────────────────────────────────────┘
```

- 输入框内提示在内容变化时实时校验并清除错误状态（非 blocking 输入过程）
- 只有提交时（handleSend）才 blocking

### 2.5 测试

| 用例 | 输入 | 预期 error.code |
|------|------|----------------|
| 空字符串 | "" | EMPTY_INPUT |
| 纯空格 | "   " | EMPTY_INPUT |
| 纯标点 | "，，！？" | PUNCTUATION_ONLY |
| 超长 | "a".repeat(501) | TOO_LONG |
| 边界长度 | "a".repeat(500) | valid: true |
| 非法字符 | "abc\x00def" | INVALID_CHARS |
| 正常输入 | "各区域近30天销售额" | valid: true |

---

## 3. Multi-Module B: Context Policy（上下文管理策略）

### 3.1 动机

当前状态：AskWorkbenchPage（lines 145-151）在 handleSend 中内联构建 messageHistory——直接从 currentResponse 取上一轮结果。无独立的上下文管理模块。未来 LLM 接入后，messageHistory 可能累积多轮，需要压缩策略。

Phase 5I 提出的 Context Policy 是纯函数模块，不修改现有 store 结构，不改变当前 messageHistory 构造方式。

### 3.2 设计：`contextPolicy.ts` 纯函数

```typescript
// frontend/src/api/aiAsk/contextPolicy.ts — 新增

export interface ContextPolicyConfig {
  maxHistoryLength: number          // 最大保留轮数。MVP: 1（仅保留上一轮）
  compressionLevel: 'none' | 'light' | 'full'
  retainFields: string[]            // 压缩时保留的字段列表
}

export const DEFAULT_CONTEXT_CONFIG: ContextPolicyConfig = {
  maxHistoryLength: 1,
  compressionLevel: 'none',
  retainFields: [],
}
```

### 3.3 核心函数

```typescript
/**
 * 从 currentResponse 构建 messageHistory。
 * Phase 5I MVP 保持与 Phase 5H 一致的行为——仅基于 currentResponse 单步构造。
 * 
 * @param currentResponse - 当前 session 的上一轮响应
 * @param config - 上下文策略配置
 * @returns messageHistory 数组
 */
export function buildMessageHistory(
  currentResponse: AiAskResponse | null,
  config?: ContextPolicyConfig
): AiAskContext['messageHistory']
```

**MVP 行为**：与 Phase 5H 完全相同——如果 currentResponse 非空，构造 `[{role:'user', content: currentResponse.question}, {role:'assistant', content:'', responseJson: response}]`。不做多轮历史提取。

```typescript
/**
 * 对 AiAskResponse 执行字段级压缩。
 * 用于未来多轮场景（Phase 5J+）减少 messageHistory 体积。
 * Phase 5I MVP 阶段实现但不启用。
 * 
 * @param response - 要压缩的响应
 * @param level - 压缩级别
 * @returns 压缩后的 AiAskResponse
 */
export function compressResponse(
  response: AiAskResponse,
  level: 'light' | 'full'
): AiAskResponse
```

### 3.4 压缩字段

当 compressionLevel 非 'none' 时，每个 response 保留以下字段（其他字段移除）：

**保留字段**（light + full 级别都保留）：

| 顶层字段 | 保留内容 | 说明 |
|---------|---------|------|
| `question` | 完整文本 | 始终保留 |
| `intent` | `{ metrics, dimensions, filters, timeRange }` | 全保留 |
| `sqlPlan` | `{ datasourceId, datasourceName, tables, fields }` | SQL 文本在 full 级别移除，light 保留摘要前 200 字符 |
| `resultSummary` | `{ rowCount, durationMs, truncated }` | 全保留。不含 summary 文本 |
| `narrative` | `{ summary, conclusion }` | light 保留 short 版本，full 仅保留 summary（前 200 字符） |
| `followUp` | `{ type, targetValue, targetDimension, confidence }` | 全保留 |
| `contextSummary` | 完整文本 | 始终保留 |

**移除字段**：
- `chartSuggestions`（light 移除，full 移除）
- `semanticGaps`（full 移除）
- `narrative.keyFindings`（full 移除）
- `narrative.evidence`（full 移除）
- `narrative.risks`（full 移除）
- `narrative.nextQuestions`（full 移除）

**压缩示例**（full 级别）：

```
压缩前：
{
  question: "近30天各区域销售额",
  intent: { metrics: ['销售额'], dimensions: ['区域'], filters: ['近30天'] },
  sqlPlan: { datasourceId: 2, datasourceName: 'dwhrpt', tables: ['fact_sales'],
             sql: 'SELECT region, SUM(revenue) FROM fact_sales WHERE ...' },
  resultSummary: { rowCount: 10, durationMs: 120, truncated: false },
  narrative: { summary: '各区域销售额分析结论...', conclusion: '华东领先建议深耕' },
  followUp: { type: 'drill_down', targetValue: '华东', confidence: 'high' },
  contextSummary: '上一轮：各区域销售额',
  chartSuggestions: [...],      // 移除
  semanticGaps: [...],          // 移除
}

压缩后：
{
  question: "近30天各区域销售额",
  intent: { metrics: ['销售额'], dimensions: ['区域'], filters: ['近30天'] },
  sqlPlan: { datasourceId: 2, datasourceName: 'dwhrpt', tables: ['fact_sales'],
             sql: 'SELECT region, SUM(revenue) FROM fact_sales WHERE ...' },  // light 保留
  resultSummary: { rowCount: 10, durationMs: 120, truncated: false },
  narrative: { summary: '各区域销售额分析结论...' },
  followUp: { type: 'drill_down', targetValue: '华东', confidence: 'high' },
  contextSummary: '上一轮：各区域销售额',
}
```

### 3.5 集成方式：纯函数，不修改 store

```
AskWorkbenchPage.handleSend():
  1. const currentResponse = useAiAskStore.getState().currentResponse
  2. const messageHistory = buildMessageHistory(currentResponse, DEFAULT_CONTEXT_CONFIG)
  3. // messageHistory 传入 adapter.analyze()
```

- aiAskStore 不变
- contextPolicy.ts 是纯函数，不含 React hooks 或 store 依赖
- Phase 5I 的 buildMessageHistory 行为与 Phase 5H 相同，只是将内联逻辑提取为独立模块

### 3.6 多轮 benchmark 的上下文构造

对于需要模拟多轮的 benchmark 测试，benchmark 脚本直接构造 messageHistory fixture，不依赖 store：

```typescript
// 仅在 benchmark 中使用
const fixtureHistory = [
  { role: 'user' as const, content: '各区域销售额' },
  { role: 'assistant' as const, content: '', responseJson: { ...scenario1 } },
]
const result = await adapter.analyze('为什么华东最高', {
  datasourceId: 2,
  datasourceName: 'dwhrpt',
  selectedTables: [],
  messageHistory: fixtureHistory,
})
```

### 3.7 测试

| 用例 | 输入 | 预期 |
|------|------|------|
| currentResponse 为 null | null | 返回 undefined |
| currentResponse 存在 | { question: "...", ... } | 返回包含 user+assistant 的数组 |
| maxHistoryLength=1 | 2 responses | 仅保留最近一轮 |
| compress light | AiAskResponse | chartSuggestions 移除，其他保留 |
| compress full | AiAskResponse | 仅保留核心字段 |

---

## 4. Multi-Module C: Error Recovery（错误处理闭环）

### 4.1 动机

当前状态：AiAskError 已定义并可在 adapter.analyze() 中抛出，`getAiAskErrorMessage(code)` 可映射到中文用户消息。但系统中没有统一的恢复/降级策略：
- adapter 返回的错误直接冒泡到 UI，无降级尝试
- 追问低置信度场景无明确处理路径
- 无截断结果的处理约定

### 4.2 核心原则：不改变 adapter.analyze() 返回协议

Phase 5I **不改变** `AiAskAdapter.analyze()` 的返回类型：

```typescript
// adapter.ts — 不变
interface AiAskAdapter {
  analyze(question: string, context: AiAskContext): Promise<AiAskResponse>
  // 仍可能 throw AiAskError
}
```

这意味着：
- ✅ adapter.analyze() 仍保序返回 AiAskResponse 或 throw AiAskError
- ❌ 不引入 `{ error, fallback }` 返回协议
- ❌ 不改变 AiAskResponse 结构
- ✅ 错误处理和降级在 adapter 内部或页面层完成

### 4.3 错误分类与处理

#### 4.3.1 输入校验错误（页面层，blocking）

| 场景 | 处理方式 | 用户看到 |
|------|---------|---------|
| 空输入 | validateAiAskInput → 阻断 | "请输入问题" |
| 超长输入 | validateAiAskInput → 阻断 | "问题过长，请缩短到 500 字以内" |
| 无效字符 | validateAiAskInput → 阻断 | "输入包含无效字符" |

#### 4.3.2 Adapter 运行时错误（adapter 层，throw AiAskError）

| AiAskErrorCode | 说明 | 处理方式 |
|---------------|------|---------|
| ANALYSIS_TIMEOUT | 分析超时 | 现有 AiAskError 抛出，UI 展示 getAiAskErrorMessage |
| INVALID_RESPONSE | 响应校验失败 | 现有 AiAskError 抛出 |
| UNKNOWN_ERROR | 未知错误 | 兜底错误 |

**不在 Phase 5I 范围内**：
- 重试机制（retry）——未来非 MVP
- 渐进式降级（graceful degradation）——未来非 MVP

#### 4.3.3 追问低置信度降级（adapter 内部）

低置信度追问场景的处理完全在 adapter 内部，不影响外部协议：

```
followUpDetector.detectFollowUpType(question, previousResponse):

  关键词清晰匹配某类型
    → confidence: 'high'，type = 匹配类型
    → adapter 按该类型生成针对性响应

  关键词部分匹配，不明确
    → confidence: 'medium'，type = 匹配类型
    → adapter 按该类型生成响应，但响应中含免责说明

  无规则匹配
    → confidence: 'low'，type = general_followup
    → adapter 降级策略：复用上一轮 intent/sqlPlan，不做差异化查询
    → 返回的 response 附加 metadata 表明这是降级响应

  真实 LLM 接入后：
    → LLM 可独立判断追问意图，confidence 由 LLM 自身输出
    → MockAdapter 的规则引擎仅用于开发期
```

**降级策略细节**：

```typescript
// adapter 内部降级处理（伪码）
function handleFollowUp(question, previousResponse, context):
  const followUp = detectFollowUpType(question, previousResponse)

  if (followUp.confidence === 'low'):
    // 降级为 general_followup：复用上一轮结果，不做差异化
    return {
      ...previousResponse,           // 继承上一轮所有字段
      question,                      // 仅覆盖 question 文本
      followUp,                      // 标记降级状态
      contextSummary: `基于上一轮 "${previousResponse.question}" 继续分析`,
    }

  if (followUp.confidence === 'medium'):
    // 中等置信度：按类型生成响应但加免责说明
    const response = buildStructuredResponse(question, previousResponse, followUp)
    // 在 narrative.risks 中追加置信度说明
    response.narrative.risks = [
      ...(response.narrative.risks ?? []),
      { risk: '追问意图不够明确，结果可能不完全符合预期', impact: '分析偏差', suggestion: '请更具体描述' },
    ]
    return { ...response, followUp }

  // confidence === 'high'：
  return buildStructuredResponse(question, previousResponse, followUp)
```

**不引入 `confidence < 0.3` 这种数值比较。** 现有类型系统已定义 `confidence: 'high' | 'medium' | 'low'`，以此为唯一标准。

#### 4.3.4 `resultSummary.truncated` 截断通知

当 adapter 标记 `resultSummary.truncated === true` 时（查询结果被截断），UI 在结果展示区显示轻量提示条：

```
┌──────────────────────────────────────────────┐
│ ⚠ 结果仅显示前 100 行数据，建议细化查询条件    │
└──────────────────────────────────────────────┘
```

此提示是信息通告，非错误阻断。由页面层直接根据 `resultSummary.truncated` 判断并展示提示。

### 4.4 Error Recovery 集成

```
AskWorkbenchPage.handleAnalyze():
  1. validateAiAskInput(question) → blocking if invalid
  2. try:
     const response = await adapter.analyze(question, context)
     // 正常渲染
     if (response.resultSummary?.truncated):
       showTruncatedNotice()  // 非阻断提示
  3. catch (error):
     if (error instanceof AiAskError):
       showErrorMessage(getAiAskErrorMessage(error.code))
     else:
       showErrorMessage(getAiAskErrorMessage('UNKNOWN_ERROR'))
```

### 4.5 测试

| 用例 | 输入 | 预期 |
|------|------|------|
| 正常单轮 | 常见问题 | 正常返回 AiAskResponse |
| 追问高置信度 | "为什么华东最高"（drill_down 匹配） | confidence: 'high'，针对性响应 |
| 追问低置信度 | "再说说"（无匹配） | general_followup + confidence: 'low' + 复用上一轮 |
| 追问中置信度 | "看分布"（部分匹配） | drill_down + confidence: 'medium' + 风险标注 |
| truncated 通知 | resultSummary.truncated = true | UI 显示截断提示（非阻断） |

---

## 5. Multi-Module D: Benchmark Runner（本地开发期质量检查工具）

### 5.1 动机

当前状态：AI 问数模块（inputGuard/contextPolicy/followUpDetector/adapter）的质量评估完全依赖开发人员手动测试。无自动化质量基线，无法在修改后快速验证是否退化。

Phase 5I 不引入 CI 门禁——benchmark 是**本地开发期手动工具**，不是 CI 检查，不是测试框架。

### 5.2 设计：Standalone 脚本

```typescript
// frontend/scripts/runQualityBenchmarks.ts — 新增
```

**运行方式**：
```bash
cd frontend
npx tsx scripts/runQualityBenchmarks.ts
# 或
pnpm tsx scripts/runQualityBenchmarks.ts
```

**输出**：JSON 格式质量报告（写入 `frontend/scripts/benchmark-results/` 目录）。

### 5.3 与单元测试的职责划分

```
┌────────────────────────────────────────────────────────────┐
│ 📦 单元测试 (*.test.ts)                                    │
│                                                            │
│  Vitest 测试套件，覆盖：                                     │
│  - inputGuard: 每一条校验规则（边界值、异常值、正常值）         │
│  - contextPolicy: buildMessageHistory、compressResponse     │
│  - followUpDetector: 7 种追问类型的精确匹配                  │
│  - MockAdapter: 多轮/单轮响应正确性                          │
│                                                            │
│  每次 CI / 本地开发运行。断言失败 → 修复代码 → 通过。          │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ 🛠 Benchmark 脚本 (runQualityBenchmarks.ts)                  │
│                                                            │
│  手动运行的质量检查工具，不依赖 Vitest：                      │
│  - inputGuard: 批量输入用例（中文、特殊符号、边界）→ 输出报告   │
│  - contextPolicy: 压缩前后大小对比 → 输出报告                 │
│  - followUpDetector: 批量追问场景 → 校验意图识别质量           │
│  - MockAdapter: 模拟多轮 benchmark → 验证响应质量             │
│                                                            │
│  开发人员手动按需运行。输出 JSON 报告，不阻断 CI。             │
└────────────────────────────────────────────────────────────┘
```

### 5.4 Benchmark 测试分项

#### 5.4.1 Input Guard Benchmark

```typescript
async function runInputGuardBenchmark(): Promise<BenchmarkReport> {
  const TEST_CASES = [
    // 边界测试
    { input: '', label: '空字符串' },
    { input: '   ', label: '纯空格' },
    { input: '你好'.repeat(250), label: '刚好 500 字符' },
    { input: '你好'.repeat(251), label: '超 1 个字符（502）' },
    { input: '1'.repeat(1000), label: '1000 字符超长' },
    // 标点测试
    { input: '，，，', label: '中文标点' },
    { input: '!@#$%^&*()_+', label: '英文符号' },
    { input: '\n\t\n', label: '仅换行与制表符' },
    // 非法字符测试
    { input: 'abc\x00def', label: '含空字符' },
    // 业务场景
    { input: '各区域近30天销售额', label: '正常业务问题' },
    { input: '为什么华东最高', label: '正常追问' },
    { input: '请分析2024年各区域销售额TOP10客户的分布情况并按产品线拆解毛利率变化趋势', label: '长句但合法' },
  ]

  for (const tc of TEST_CASES) {
    const result = validateAiAskInput(tc.input)
    // 记录：输入 → 预期 → 实际 → 通过/失败
  }
}
```

**报告形态**：
```json
{
  "module": "inputGuard",
  "timestamp": "2026-07-06T10:30:00Z",
  "total": 12,
  "passed": 11,
  "failed": 1,
  "failures": [
    { "input": "xxx", "expected": "TOO_LONG", "actual": "valid", "label": "xxx" }
  ]
}
```

#### 5.4.2 Context Policy Benchmark

```typescript
async function runContextBenchmark(): Promise<BenchmarkReport> {
  // 场景：构建多轮上下文 → 应用压缩 → 验证压缩后体积
  // 使用 fixture 数据模拟 1/3/5/10 轮上下文
  const scenarios = [
    { name: '1 轮', turnCount: 1, config: { compressionLevel: 'none' } },
    { name: '3 轮 light', turnCount: 3, config: { compressionLevel: 'light' } },
    { name: '5 轮 full', turnCount: 5, config: { compressionLevel: 'full' } },
    { name: '10 轮 full', turnCount: 10, config: { compressionLevel: 'full' } },
  ]

  for (const s of scenarios) {
    const history = buildFixtureHistory(s.turnCount)
    const compressed = history.map(r => compressResponse(r, s.config.compressionLevel))
    // 记录：压缩前大小 vs 压缩后大小
  }
}
```

**报告形态**：
```json
{
  "module": "contextPolicy",
  "timestamp": "2026-07-06T10:30:00Z",
  "scenarios": [
    { "name": "1 轮", "originalBytes": 1200, "compressedBytes": 1200, "ratio": "1.00x" },
    { "name": "3 轮 light", "originalBytes": 3600, "compressedBytes": 2400, "ratio": "0.67x" },
    { "name": "5 轮 full", "originalBytes": 6000, "compressedBytes": 1500, "ratio": "0.25x" },
    { "name": "10 轮 full", "originalBytes": 12000, "compressedBytes": 3000, "ratio": "0.25x" }
  ]
}
```

#### 5.4.3 FollowUp Detector Benchmark

```typescript
async function runFollowUpBenchmark(): Promise<BenchmarkReport> {
  const TEST_CASES = [
    // why_down
    { question: '为什么销售额下降', expectedType: 'why_down', expectedConfidence: 'high' },
    { question: '下降的原因是什么', expectedType: 'why_down', expectedConfidence: 'high' },
    // drill_down
    { question: '为什么华东最高', expectedType: 'drill_down', expectedConfidence: 'high' },
    { question: '按产品线拆分', expectedType: 'drill_down', expectedConfidence: 'medium' },
    // top_n
    { question: '看 TOP10 客户', expectedType: 'top_n', expectedConfidence: 'high' },
    // time_shift
    { question: '去年同期的数据', expectedType: 'time_shift', expectedConfidence: 'high' },
    // switch_metric
    { question: '换成毛利率来看', expectedType: 'switch_metric', expectedConfidence: 'medium' },
    // explain_anomaly
    { question: '为什么这个月突然下降', expectedType: 'explain_anomaly', expectedConfidence: 'medium' },
    // general_followup
    { question: '再说说', expectedType: 'general_followup', expectedConfidence: 'low' },
    { question: '还有吗', expectedType: 'general_followup', expectedConfidence: 'low' },
  ]
}
```

#### 5.4.4 MockAdapter 多轮 Benchmark

使用 fixture 构造多轮 messageHistory，验证 adapter 的追问处理质量：

```typescript
async function runAdapterBenchmark(): Promise<BenchmarkReport> {
  // Fixture: 第 1 轮场景响应
  const round1Response = MOCK_SCENARIOS[0]  // revenue-by-region

  // Fixture: 第 2 轮追问
  const followUpCases = [
    {
      scenario: round1Response,
      question: '为什么华东最高',
      expectedFollowUpType: 'drill_down',
      expectedHasChart: true,
    },
    {
      scenario: round1Response,
      question: '随便说说其他事',
      expectedFollowUpType: 'general_followup',
      expectedDegraded: true,  // 低置信度降级
    },
  ]

  for (const tc of followUpCases) {
    const result = await adapter.analyze(tc.question, {
      datasourceId: 2,
      datasourceName: 'dwhrpt',
      selectedTables: [],
      messageHistory: [
        { role: 'user', content: tc.scenario.response.question },
        { role: 'assistant', content: '', responseJson: tc.scenario.response },
      ],
    })
    // 验证 followUp.type、chartSuggestions、降级状态
  }
}
```

### 5.5 报告格式与存放位置

```
frontend/scripts/
├── runQualityBenchmarks.ts        # 主入口
├── benchmarks/
│   ├── inputGuard.bench.ts         # Input Guard benchmark
│   ├── contextPolicy.bench.ts      # Context Policy benchmark
│   ├── followUpDetector.bench.ts   # FollowUp Detector benchmark
│   └── adapter.bench.ts            # Adapter benchmark
├── fixtures/
│   └── multiRoundHistory.ts         # 多轮上下文 fixture 数据
└── benchmark-results/
    └── 2026-07-06T10-30-00.json    # 每次运行生成的 JSON 报告
```

**统一报告格式**：

```typescript
interface QualityBenchmarkReport {
  timestamp: string
  duration: number           // 运行耗时（ms）
  modules: {
    inputGuard: ModuleReport
    contextPolicy: ModuleReport
    followUpDetector: ModuleReport
    adapter: ModuleReport
  }
}

interface ModuleReport {
  total: number
  passed: number
  failed: number
  failures: Array<{
    label: string
    expected: string
    actual: string
    detail?: string
  }>
}
```

### 5.6 不在 Phase 5I 范围内

- **CI 集成**：不创建 GitHub Actions workflow。不作 CI gate。
- **Vitest 集成**：benchmark 脚本不通过 Vitest 运行。使用 `npx tsx` 直接执行。
- **可视化报告**：benchmark 输出 JSON 文件，不生成 HTML 仪表盘。
- **自动回归检测**：不自动比较两次报告的差异。未来可在回放工具中实现。
- **真实 LLM benchmark**：不调用真实 LLM。全部基于 MockAdapter。

---

## 6. 无变更模块

以下模块在 Phase 5I MVP 中**不做任何修改**：

| 模块 | 原因 |
|------|------|
| `aiAskStore` | 不改动。contextPolicy 是纯函数，由 page 调用，不侵入 store |
| `AiAskAdapter` 协议 | 不改动。analyze() 返回协议不变，不引入 {error, fallback} |
| `AiAskResponse` 类型 | 不改动。未新增字段 |
| `MockAdapter` | 不改动。followUp 降级在 adapter 内部按现有规则处理 |
| `AskAdapterRegistry` | 不改动 |
| `followUpDetector.ts` | 不改动。confidence 逻辑已满足需求 |
| `recommendation.ts` | 不改动 |
| `validator.ts` | 不改动 |
| 后端 API | 不改动 |
| DB schema / Migration | 不改动 |
| CI config | 不新增 GitHub Actions |

---

## 7. 文件变更总览

### 7.1 新增文件

| 文件路径 | 说明 |
|---------|------|
| `frontend/src/api/aiAsk/inputGuard.ts` | Input Guard 纯函数 |
| `frontend/src/api/aiAsk/inputGuard.test.ts` | Input Guard 单元测试 |
| `frontend/src/api/aiAsk/contextPolicy.ts` | Context Policy 纯函数 |
| `frontend/src/api/aiAsk/contextPolicy.test.ts` | Context Policy 单元测试 |
| `frontend/scripts/runQualityBenchmarks.ts` | Benchmark 主入口 |
| `frontend/scripts/benchmarks/inputGuard.bench.ts` | Input Guard benchmark |
| `frontend/scripts/benchmarks/contextPolicy.bench.ts` | Context Policy benchmark |
| `frontend/scripts/benchmarks/followUpDetector.bench.ts` | FollowUp Detector benchmark |
| `frontend/scripts/benchmarks/adapter.bench.ts` | Adapter benchmark |
| `frontend/scripts/fixtures/multiRoundHistory.ts` | 多轮上下文 fixture |

### 7.2 修改文件

| 文件路径 | 变更 |
|---------|------|
| `frontend/src/pages/AskWorkbenchPage.tsx` | 集成 Input Guard（handleSend 接入 validateAiAskInput）、集成 Context Policy（替换内联 messageHistory 构造） |
| `frontend/src/components/AskInput.tsx` | 集成 Input Guard（实时校验反馈提示） |
| `frontend/src/api/aiAsk/index.ts` | 导出 inputGuard.validateAiAskInput |

### 7.3 无变更文件

| 文件路径 | 原因 |
|---------|------|
| `frontend/src/stores/aiAskStore.ts` | contextPolicy 是纯函数，page 集成不涉及 store |
| `frontend/src/api/aiAsk/mockAdapter.ts` | 降级逻辑已在 adapter 内部按规则实现 |
| `frontend/src/api/aiAsk/followUpDetector.ts` | 现有 confidence 逻辑满足需求 |
| `frontend/src/api/aiAsk/adapter.ts` | analyze 返回协议不变 |
| `frontend/src/types/aiAsk.ts` | 不新增字段 |
| `frontend/src/api/aiAsk/validator.ts` | 逻辑不变 |

---

## 8. 集成示例（Phase 5I 后 handleSend 流程）

```
handleSend(question):
  │
  ├── [Input Guard]
  │   const validation = validateAiAskInput(question)
  │   if (!validation.valid):
  │     setInputError(validation.error.message)
  │     return  // 阻断，不调用 analyze
  │
  ├── [Context Policy]
  │   const currentResponse = useAiAskStore.getState().currentResponse
  │   const messageHistory = buildMessageHistory(currentResponse)
  │   // 与 Phase 5H 行为完全一致，仅抽出为纯函数
  │
  ├── [Adapter]
  │   try:
  │     const response = await adapter.analyze(question, { ..., messageHistory })
  │   catch (error):
  │     handleAnalyzeError(error)  // AiAskError → UI 展示
  │     return
  │
  └── [Result]
      if (response.resultSummary?.truncated):
        showTruncatedNotice()
      renderResponse(response)
```

---

## 9. 测试策略

### 9.1 单元测试（Vitest）

| 测试文件 | 覆盖范围 | 用例数 |
|---------|---------|--------|
| `inputGuard.test.ts` | 5 条校验规则的边界/异常/正常用例 | ~12 |
| `contextPolicy.test.ts` | buildMessageHistory、compressResponse 各场景 | ~10 |
| `errors.test.ts` | 已有错误码覆盖（无变更） | — |

### 9.2 Benchmark（Standalone）

| 文件 | 覆盖范围 | 用例数 |
|------|---------|--------|
| `inputGuard.bench.ts` | 批量输入验证 + 边界测试 | ~12 |
| `contextPolicy.bench.ts` | 多轮场景压缩比验证 | ~4 |
| `followUpDetector.bench.ts` | 7 种追问类型匹配精度 | ~11 |
| `adapter.bench.ts` | MockAdapter 多轮响应质量 | ~4 |

### 9.3 不测试

- Playwright/Cypress E2E
- 真实 LLM 调用
- 后端 API 集成
- 可视化/HTML 报告生成

---

## 10. 风险与控制

| 风险 | 说明 | 控制方式 |
|------|------|---------|
| Input Guard 阻断正常输入 | 用户正常但偏长的问题被阻断 | 500 字符阈值经评估可覆盖绝大多数业务提问；未来可调整 |
| Context Policy 影响现有追问行为 | 提取为纯函数后行为不一致 | MVP 阶段 buildMessageHistory 行为与 Phase 5H 完全一致，不做功能变更 |
| Benchmark 脚本质量低 | 无人运行的 benchmark 是无用工具 | benchmark 附加报告 JSON，开发人员可直观看到质量基线，降低查看成本 |
| 低置信度降级导致"静默失败" | adapter 复用上一轮结果但无明确指示 | 降级响应通过 followUp 字段（confidence: 'low' + type: general_followup）明确标记 |
| 压缩导致信息丢失 | full 压缩移除过多字段 | light 压缩作为默认；full 仅在 10 轮 + 时启用，且保留核心分析字段 |

---

## 11. 后续 Phase 路线占位

| Phase | 目标 | 关键内容 | 依赖 |
|-------|------|---------|------|
| **Phase 5I（当前）** | AI 问数质量与安全保障 | Input Guard、Context Policy、Error Recovery、Benchmark Runner | Phase 5H |
| Phase 5J | AI 报告 Agent | 报告提纲 → 自动取数 → 图表嵌入 → 段落生成 | Phase 5H + 5I |

Phase 5I 为 Phase 5J 及后续 LLM 真实接入提供：
- Input Guard → 阻止 LLM 浪费 token 在无效输入上
- Context Policy → 控制 messageHistory 大小避免超长 prompt
- Error Recovery → LLM 错误的统一处理路径
- Benchmark → LLM 接入前后的质量基线对比

---

## 12. 自检清单

- [x] 核心是质量与安全保障，不是报告 Agent
- [x] 不新增 adapter.analyze() 返回协议（不引入 {error, fallback}）
- [x] 不新增 AiAskResponse 字段
- [x] 不修改 aiAskStore
- [x] Input Guard 是共享纯函数 + handleSend 阻断，不只是 AskInput 层
- [x] 超长输入为阻断（blocking），不截断。resultSummary.truncated 与输入无关
- [x] Low-confidence 使用 'low'/'medium'/'high' 字符串，不写数值 <0.3
- [x] Context Policy 是纯函数，Phase 5I 行为与 Phase 5H 一致
- [x] Multi-round benchmark 使用 fixture 而非 store
- [x] Benchmark 是独立脚本（npx tsx），不是 CI gate、不是 Vitest 套件
- [x] 单元测试与 benchmark 职责划分明确
- [x] 无后端 API / DB / migration 变更
- [x] 无 CI config / GitHub Actions
- [x] 无 Playwright / Cypress
- [x] 无 TBD/TODO
- [x] 无 implementation plan 内容
- [x] 无代码实现
