# Phase 5L 真实 LLM Adapter MVP 设计

## 变更日志

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-07-08 | v1.0 | 初始设计定稿 |

## 1. 背景与目标

### 1.1 背景

Phase 5F–5K 已交付：

- 前端 `AiAskAdapter` 接口与 `MockAdapter` 实现
- `validateAiAskResponse` 结构化响应校验
- `promptSimulation` LLM 失效模式模拟
- `inputGuard` 输入守卫
- `contextPolicy` 上下文压缩与多轮管理
- `followUpDetector` 与 `evidence chain` 可信度增强

后端已存在：

- `llm_settings` 表与 `LlmSetting` 模型
- `LlmSettingsService`（CRUD、激活切换、连接测试）
- `key_encryption`（Fernet 对称加密解密）
- 现有 `AskService` 提供的自由文本/SSE 对话能力

### 1.2 目标

Phase 5L 让 AI 问数从 `MockAdapter` 进入最小真实 LLM 接入阶段，采用**"配置复用，问数链路新做"**的混合方案：

- 复用现有 LLM 配置体系（表、服务、加密、连接测试）
- 新做 AI 问数专用结构化 LLM Service / Adapter
- 不直接复用现有 `AskService` 的自由文本/SSE 输出作为 `AiAskResponse`
- 默认路径仍为 `MockAdapter`，真实 LLM 必须显式开启

## 2. 设计原则

1. **配置复用**：不新建 LLM 配置体系，直接使用 `llm_settings` 中的 active 配置。
2. **密钥安全**：API Key 仅在后端解密，前端永远不可读取真实 key。
3. **结构化输出**：LLM 必须返回 JSON，后端执行 parse → normalize → validate。
4. **默认模拟**：真实 LLM 开关关闭时，行为与 Phase 5K 完全一致；开关开启但无 active LLM 配置时，不自动 fallback，返回 `LLM_NOT_CONFIGURED` 并提示用户去 LLM 连接管理启用模型。
5. **范围收敛**：MVP 只做单轮、单数据源、简化版 `AiAskResponse` 生成。
6. **测试隔离**：自动化测试不调用真实 LLM，通过 mock 覆盖所有分支。

## 3. 后端设计

### 3.1 新增 API

**授权说明**：Phase 5L 明确授权新增一个后端 AI 问数结构化分析 API，用于服务前端 `RealLlmAdapter`。

```
POST /api/ai-ask/analyze
```

**请求体**（示例）：

```json
{
  "question": "各区域销售额排名",
  "datasourceId": 1,
  "datasourceName": "示例数据源",
  "selectedTables": ["sales", "region"],
  "messageHistory": []
}
```

**成功响应**（200）：

```json
{
  "ok": true,
  "data": {
    "question": "各区域销售额排名",
    "intent": { "metrics": ["销售额"], "dimensions": ["区域"], "filters": [] },
    "sqlPlan": {
      "datasourceId": 1,
      "datasourceName": "示例数据源",
      "sql": "SELECT region, SUM(amount) FROM sales GROUP BY region ORDER BY 2 DESC",
      "tables": ["sales"],
      "fields": ["region", "amount"],
      "assumptions": [],
      "safetyWarnings": []
    },
    "resultSummary": { "rowCount": 5, "durationMs": 120 },
    "chartSuggestions": [...],
    "narrative": {
      "summary": "...",
      "keyFindings": [...],
      "evidence": [...],
      "risks": [],
      "nextQuestions": []
    },
    "semanticGaps": []
  }
}
```

**错误响应**（统一返回 HTTP 200，通过 `ok: false` 与 `errorCode` 区分）：

```json
{
  "ok": false,
  "errorCode": "LLM_NOT_CONFIGURED",
  "errorMessage": "没有已启用的 LLM 配置，请先在 LLM 连接管理中启用一个模型"
}
```

**错误响应协议说明**：

- Phase 5L MVP 中，所有 LLM 业务错误统一返回 HTTP 200，响应体为 `{ ok: false, errorCode, errorMessage, details? }`。
- 包括：`LLM_NOT_CONFIGURED`、`INVALID_RESPONSE`、`ANALYSIS_TIMEOUT`、`LLM_AUTH_ERROR`、`LLM_CONNECTION_ERROR`、`LLM_RATE_LIMIT`。
- 只有未捕获的服务端异常才走 HTTP 500。
- 原因：现有 `apiFetch` 对非 2xx 响应通常只保留 `message` 和 `status`，会丢失结构化 `errorCode`；MVP 先保持错误体稳定，便于前端精确处理。

**错误码定义**：

| 错误码 | 触发场景 |
|--------|----------|
| `LLM_NOT_CONFIGURED` | 无 active `LlmSetting` |
| `INVALID_RESPONSE` | LLM 输出无法 parse 或校验失败 |
| `ANALYSIS_TIMEOUT` | LLM 调用超时 |
| `LLM_AUTH_ERROR` | 401/403/认证失败 |
| `LLM_CONNECTION_ERROR` | 连接失败/DNS/拒绝连接 |
| `LLM_RATE_LIMIT` | 频率限制/配额耗尽 |
| `UNKNOWN` | 其他未分类错误 |

### 3.2 DB / Migration 边界

- **不新增任何 DB 表**
- **不新增 migration**
- **不改变 `llm_settings` schema**
- **不改变 `AskSession` / `AskMessage` schema**
- 新增 API 为无状态调用，不持久化请求/响应

### 3.3 新增服务：`AiAskLlmService`

职责单一：接收 AI 问数请求，调用真实 LLM，返回结构化 `AiAskResponse`。

#### 3.3.1 依赖

- `llm_settings` 表与 `LlmSetting` 模型：复用现有表和模型，不新增 DB / migration
- `LlmSettingsService`：仍用于 LLM 配置管理、列表、激活切换、连接测试，**不用于获取可解密的 `api_key`**
- 直接查询 active `LlmSetting` 记录：`db.query(LlmSetting).filter(LlmSetting.is_active == 1).first()`
- `key_encryption.decrypt()`：从 `LlmSetting.api_key` 取得加密密钥后解密
- `openai.OpenAI`：调用 OpenAI-compatible API
- 内部 `AiAskPromptBuilder`：构建 system/user prompt
- 内部 `AiAskResponseNormalizer`：将 LLM 原始输出规范化为 `AiAskResponse`
- 后端 `AiAskResponseValidator`（或 `validate_ai_ask_response()`）：覆盖 Phase 5K contract 的 MVP 必填字段校验

#### 3.3.2 主流程

```
1. 直接查询 active LlmSetting 记录
   └─ 无 active 配置 → 返回 LLM_NOT_CONFIGURED
2. 从 active.api_key 取得加密密钥，调用 key_encryption.decrypt() 解密
3. 构造 prompt（system + user + schema 说明）
4. 调用 chat.completions.create(model=..., messages=..., response_format={type: "json_object"})
5. JSON parse LLM 输出
   └─ 失败 → 返回 INVALID_RESPONSE
6. normalize 输出（补齐默认值、修正类型）
7. validate 输出
   └─ 失败 → 返回 INVALID_RESPONSE（附带 validation errors）
8. 返回 {ok: true, data: response}
```

#### 3.3.3 Prompt Schema 设计

System prompt 必须明确告知模型输出格式与字段约束：

- 输出必须是合法 JSON
- 必须包含字段：`question`、`intent`、`sqlPlan`、`narrative`、`semanticGaps`、`chartSuggestions`
- `intent.metrics` / `intent.dimensions` 为字符串数组
- `sqlPlan.sql` 为有效 SQL，但不要求后端执行
- `narrative.evidence` 必须非空，每项包含 `claim`、`fields`
- `chartSuggestions` 每项包含 `title`、`chartType`、`yFields`、`rationale`
- 语义 gap 字段需与 `intent.metrics` 不冲突

Prompt 中可嵌入 Phase 5K `promptSimulation` 失效模式的反例说明，帮助模型理解"有效响应"的边界。

#### 3.3.4 Response Normalizer

`normalizeAiAskResponse(raw: unknown): AiAskResponse` 只修正**可选字段、warning 级字段、轻微类型偏差**，不补齐 error 级必填顶层字段：

- **不补齐的必填顶层字段**（缺失时交由 `AiAskResponseValidator` 返回 `INVALID_RESPONSE`）：
  - `question`
  - `intent`
  - `sqlPlan`
  - `narrative`
  - `semanticGaps`
  - `chartSuggestions`
- **可补齐的可选/warning 级字段**：
  - `risks` / `nextQuestions` / `safetyWarnings` / `assumptions` 缺失时填充为空数组
  - `resultSummary` 缺失时填充为 `undefined`
  - 数字字符串（如 `rowCount`）转换为数字
  - 非法 `chartType` 替换为 `"bar"`
  - 空字符串数组元素过滤
  - 限制 `narrative.evidence` 数量上限（如 10 条）

Normalizer 不修复结构性错误。例如 `question` 缺失、`intent` 不是对象、`narrative.evidence` 缺失等，直接交给 Validator 判定为 `INVALID_RESPONSE`。

#### 3.3.5 Response Validator

后端新增独立的 `AiAskResponseValidator`（或 `validate_ai_ask_response()`），不直接引用前端 TS 代码：

- 覆盖 Phase 5K contract 的 MVP 必填字段校验：
  - 顶层字段存在且类型正确：`question`、`intent`、`sqlPlan`、`narrative`、`semanticGaps`、`chartSuggestions`
  - `intent.metrics` / `intent.dimensions` / `intent.filters` 为字符串数组
  - `sqlPlan.datasourceId` 为数字，`sqlPlan.sql` 非空，`sqlPlan.tables` / `fields` 为数组
  - `narrative.summary` 非空，`narrative.evidence` 为非空数组，每项包含 `claim` 与 `fields`
  - `chartSuggestions` 为数组，每项包含 `title`、`chartType`、`yFields`
- 所有 `errors` 级别的校验失败 → 返回 `INVALID_RESPONSE`（附带 `details` 中的具体错误）
- `warnings` 级别允许通过，但可随 `ok: true` 响应返回给前端展示

前端 `RealLlmAdapter` 收到 `ok: true` 后，再调用 TS 侧 `validateAiAskResponse` 做二次校验，作为防御性检查。

### 3.4 与现有 `AskService` 的关系

- **不改造 `AskService` 为主路径**
- `AskService` 继续服务现有自由文本/SSE 对话（`/api/ask/sessions/.../stream`）
- `AiAskLlmService` 只服务新的结构化 AI 问数接口（`/api/ai-ask/analyze`）
- 两者可共享 `LlmSettingsService` 与 `key_encryption`

## 4. 前端设计

### 4.1 新增 `RealLlmAdapter`

```ts
// frontend/src/api/aiAsk/realLlmAdapter.ts
import type { AiAskAdapter, AiAskContext, ChartDataResult } from './adapter'
import type { AiAskResponse, AiChartSpec } from '../../types/aiAsk'

export class RealLlmAdapter implements AiAskAdapter {
  readonly name = 'RealLlmAdapter'

  static create(): RealLlmAdapter { ... }

  async analyze(question: string, context: AiAskContext): Promise<AiAskResponse> {
    // 调用 POST /api/ai-ask/analyze
    // 校验响应并返回
  }

  getChartData(spec: AiChartSpec, response: AiAskResponse): ChartDataResult {
    // Phase 5L MVP 不返回真实 chart rows
    return {
      columns: [],
      rows: [],
      isEmpty: true,
      error: '真实 LLM MVP 暂不返回图表数据，请在 SQL Workbench 验证 SQL 后查看结果',
    }
  }

  isAvailable(): boolean {
    // 可额外查询 /api/llm-settings/active 是否存在
    return true
  }
}
```

### 4.2 `getChartData` MVP 策略

- 后端 `/api/ai-ask/analyze` 只返回 `chartSuggestions`（图表配置），不返回真实 chart rows。
- `RealLlmAdapter.getChartData()` 统一返回 `{ columns: [], rows: [], isEmpty: true, error: "真实 LLM MVP 暂不返回图表数据，请在 SQL Workbench 验证 SQL 后查看结果" }`。
- `chartSuggestions` 仍可作为图表建议展示，但不得渲染 mock rows 冒充真实数据。
- **不允许为了图表数据扩展成 SQL 执行系统**。
- 真实 SQL 执行仍由 SQL Workbench 承担下游验证/调试角色。

### 4.3 `useAiAskService()` 默认路径

```ts
export function useAiAskService(options?: { useRealLlm?: boolean }) {
  const useReal = options?.useRealLlm ?? false
  const adapter = useReal ? RealLlmAdapter.create() : MockAdapter.create()
  return {
    analyze: adapter.analyze.bind(adapter),
    getChartData: adapter.getChartData.bind(adapter),
    isAvailable: adapter.isAvailable.bind(adapter),
    name: adapter.name,
    validate: validateAiAskResponse,
  }
}
```

- **默认使用 `MockAdapter`**
- 真实 LLM 必须显式开关启用
- 关闭开关时行为与 Phase 5K 完全一致

### 4.4 UI 显式开关

在 `AskWorkbenchPage` 增加开关组件（如 Ant Design Switch）：

- 标签："使用真实 LLM"
- 默认：关闭
- 开启前检查 active `LlmSetting` 是否存在（可调用 `/api/llm-settings` 列表）
- 无 active 配置时：禁用开关并提示"请先在 LLM 连接管理中启用模型"

### 4.5 错误展示与手动回退策略

- **不做自动 fallback 到 MockAdapter**。
- `LLM_NOT_CONFIGURED`：禁用真实 LLM 开关，并提示"请先在 LLM 连接管理中启用模型"。
- `INVALID_RESPONSE`：展示"模型返回格式异常"，附带折叠的 validation errors / details；不提供 fallback，只提供可诊断信息。
- `ANALYSIS_TIMEOUT` / `LLM_CONNECTION_ERROR` / `LLM_RATE_LIMIT` / `LLM_AUTH_ERROR`：展示错误说明与一个手动按钮"切回模拟模式再试"。点击后明确切换为 `MockAdapter`（UI 显示当前 adapter 为 MockAdapter），不得隐藏真实 LLM 失败历史。

## 5. MVP 范围

### 5.1 包含

- 单轮问题分析
- 单数据源上下文（`datasourceId` / `datasourceName`）
- 简化版 `AiAskResponse` 结构化生成
- active LLM 配置复用
- 后端 parse / normalize / validate
- 前端 `RealLlmAdapter` 显式开关
- 错误提示与手动回退策略说明

### 5.2 不包含

- 多轮真实 LLM（`messageHistory` 可传入但 MVP 不保证效果）
- 自动 SQL 执行
- 真实 chart data 查询
- 复杂 tool calling
- RAG / 向量检索
- provider 多态抽象大框架（先只支持 OpenAI-compatible API）
- streaming
- 会话持久化
- 报告生成

## 6. 测试策略

### 6.1 后端测试

- **不调用真实 LLM**
- mock `openai.OpenAI` client
- 测试覆盖：
  - `AiAskPromptBuilder.build()` 输出包含必要字段说明
  - `AiAskResponseNormalizer.normalize()` 对常见畸形输出的修正
  - `AiAskLlmService.analyze()` 在无 active 配置时返回 `LLM_NOT_CONFIGURED`
  - LLM 返回非法 JSON 时返回 `INVALID_RESPONSE`
  - LLM 返回有效 JSON 但校验失败时返回 `INVALID_RESPONSE`
  - timeout / auth / connection 错误映射到正确错误码

### 6.2 前端测试

- **不调用真实 LLM**
- mock `fetch` 或 api client
- 测试覆盖：
  - `RealLlmAdapter.analyze()` 正确调用 `/api/ai-ask/analyze`
  - `RealLlmAdapter` 返回无效响应时抛出 `AiAskError('INVALID_RESPONSE')`
  - `useAiAskService({ useRealLlm: false })` 返回 `MockAdapter`
  - `useAiAskService({ useRealLlm: true })` 返回 `RealLlmAdapter`
  - UI 开关在无 active LLM 配置时禁用并提示

### 6.3 Benchmark 不依赖真实 LLM

- `runQualityBenchmarks.ts` 继续只使用 `MockAdapter`
- 新增 `adapterContract` / `promptSimulation` 相关 benchmark 不引入真实 LLM

### 6.4 测试禁区

- 不引入 Playwright / Cypress
- 不测试 Monaco DOM
- 不做端到端 LLM 调用测试

## 7. 数据流

```
用户输入
  ↓
AskInput.validate (inputGuard)
  ↓
useAiAskService({ useRealLlm })
  ├─ useRealLlm=false → MockAdapter.analyze → 本地场景匹配
  └─ useRealLlm=true  → RealLlmAdapter.analyze
                         ↓
                      POST /api/ai-ask/analyze
                         ↓
                      AiAskLlmService
                         ↓
                      query active LlmSetting
                         ↓
                      key_encryption.decrypt(active.api_key)
                         ↓
                      OpenAI client chat.completions.create
                         ↓
                      JSON parse
                         ↓
                      normalize
                         ↓
                      validate
                         ↓
                      返回 {ok, data} 或 {ok:false, errorCode}
                         ↓
                      RealLlmAdapter 二次校验
                         ↓
                   AskWorkbenchPage 渲染结果
```

## 8. 风险分析

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| LLM 输出不稳定 | 响应质量不可控 | 强制 JSON mode + 严格 prompt + normalize + validate |
| JSON 不可解析 | INVALID_RESPONSE 错误率上升 | prompt 中明确要求 JSON；后端 robust parse |
| 字段缺失/类型错误 | validate 失败 | normalizer 补齐默认值；validate 反馈具体错误 |
| evidence 质量不足 | narrative 可信度下降 | MVP 只要求 evidence 非空，不强制 calculation/sourceFields |
| API Key 安全 | 密钥泄露 | 前端不读取 key；后端解密；传输使用 HTTPS |
| 成本与延迟 | 真实 LLM 调用产生费用 | 默认 MockAdapter；真实 LLM 显式开关 |
| 无 active LLM 配置 | 用户开启真实 LLM 后失败 | 前端预检查并禁用开关；后端返回明确错误码 |
| 真实 LLM 与 MockAdapter 结果差异 | 用户混淆 | UI 明确显示当前 adapter 名称；错误提示区分来源 |

## 9. 约束确认

- ✅ 核心仍是 AI 问数
- ✅ SQL Workbench 仍是下游验证/调试工具
- ✅ 不漂移成普通 SQL 工具
- ✅ 不漂移成通用聊天工具
- ✅ 不新增 DB / migration
- ✅ 前端不读取真实 API Key
- ✅ 不引入 Playwright / Cypress
- ✅ 不测试 Monaco DOM
- ✅ 不处理历史 untracked docs / .venv / .superpowers/review-packages
- ✅ 不 push / PR / merge

## 10. 后续步骤

1. 用户审阅本 spec
2. 审阅通过后，进入 `superpowers:writing-plans` 编写 implementation plan
3. 计划批准后再进入实现阶段
