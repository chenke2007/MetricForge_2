# Phase 5G AI 问数工作台增强 — 图表美化 + LLM Adapter 协议

日期：2026-07-04

状态：正式设计 spec，用于后续 implementation plan

修订记录：
| 版本 | 日期 | 内容 |
|------|------|------|
| v1.0 | 2026-07-04 | 初始正式设计 |

关联资料：
- [Quick BI 智能小Q官方资料与产品借鉴摘要](../references/2026-07-03-quick-bi-smartq-official-research.md)
- [Phase 5F AI 问数 Agent 产品底座需求说明书](./2026-07-03-phase-5f-ai-ask-agent-requirements.md)
- [Phase 5F AI 问数 Agent 产品底座设计说明书](./2026-07-03-phase-5f-ai-ask-agent-workbench-design.md)

---

## 1. 产品定位

### 1.1 核心命题

Phase 5G 是 Phase 5F 的增强阶段，不做新 Agent 模式，不扩大产品范围。

> **Phase 5G = F-light LLM Adapter 协议 + A-MVP 图表美化与自动推荐。**

Phase 5F 交付了"问数主工作台的骨架"——结构化的 AiAskResponse 协议、组件体系和信息架构。Phase 5G 的目标是把骨架填上血肉：

1. **让 AI 问数的结果更接近 Quick BI 智能小Q的观感**：图表更美观、更自动、更业务化。
2. **建立轻量级的 LLM Mock/Adapter 基础设施**，为后续多轮问数、解读 Agent、报告 Agent 奠定可扩展的架构基础。

### 1.2 与 Quick BI 智能小Q的能力对标（更新）

| Quick BI 能力 | MetricForge 5F 后 | Phase 5G 目标 | 差距变化 |
|---------------|:-----------------:|:-------------:|:--------:|
| 小Q问数 — 结构化输出 | ★★★☆☆ | ★★★★☆ | 协议完整度提升 |
| 小Q问数 — 图表多样性 | ★★☆☆☆ | ★★★★☆ | **重点提升** |
| 小Q问数 — 图表视觉质感 | ★★★☆☆ | ★★★★☆ | **重点提升** |
| 小Q问数 — 多轮追问 | ★☆☆☆☆ | ★★☆☆☆ | 架构准备（非功能） |
| 小Q解读 | ★★☆☆☆ | ★★☆☆☆ | 未涉及 |
| 小Q报告 | ☆☆☆☆☆ | ☆☆☆☆☆ | 未涉及 |
| 小Q搭建 | ☆☆☆☆☆ | ☆☆☆☆☆ | 未涉及 |
| 小Q洞察 | ☆☆☆☆☆ | ☆☆☆☆☆ | 未涉及 |
| 语义治理联动 | ★★☆☆☆ | ★★☆☆☆ | 未涉及 |
| 真实 LLM / 适配层 | ☆☆☆☆☆ | ★★★☆☆ | **基础架构就绪** |

### 1.3 两阶段拆分策略

```
Phase 5G.1（F-light LLM Adapter）     Phase 5G.2（A-MVP 图表增强）
     │                                       │
     │  为后续所有 Agent 模式提供统一        │  让 AI 问数结果"可视化"质量飞跃
     │  LLM 交互抽象层                      │
     │                                       │
     │  接口定义 + 场景化 mock +            │  metric-card / combo / 多 yFields
     │  校验 + 错误处理                     │  数据标签 + 推荐 + 视觉提升
     │                                       │
     └───────────────────────┬───────────────┘
                             │
                    Phase 5G 交付物
                    AI 问数工作台增强
```

**执行顺序：先 F-light（5G.1），再 A-MVP（5G.2）。**

5G.1 的 Adapter 层一旦就位，5G.2 的图表渲染就能脱离"一个固定 MOCK_ASK_RESPONSE"的限制，展示多种场景的图表形态（不同问题 → 不同图表配置 → 不同视觉风格）。

---

## 2. Phase 5G.1：LLM Adapter / 结构化响应协议（F-light）

### 2.1 目标

将 Phase 5F 的"硬编码单文件 mock"演进为可扩展的 LLM 交互适配层：

```
Phase 5F (现状)                    Phase 5G.1 (目标)
───────────────                    ───────────────
AskWorkbenchPage                   AskWorkbenchPage
  │                                  │
  ├─ import MOCK_ASK_RESPONSE        ├─ useAiAskService() -> AiAskAdapter
  ├─ simulateAiAnalysis()            ├─ adapter.analyze(question, context)
  └─ MOCK_CHART_DATA                  └─ adapter.getChartData(spec, response)
                                            │
                                     ┌──────┴──────┐
                                     │              │
                              MockAdapter    FutureLlmAdapter
                              (场景化 mock)   (接口就绪，本阶段不实现)
```

### 2.2 适配器接口定义

```typescript
// api/aiAsk/adapter.ts

/**
 * AI 问数服务适配器接口。
 *
 * 当前 Phase 5G 仅实现 MockAdapter。
 * FutureLlmAdapter 遵循相同接口，可在后续 Phase 接入协议。
 */
export interface AiAskAdapter {
  /** 分析用户问题，返回结构化 AiAskResponse */
  analyze(
    question: string,
    context: AiAskContext
  ): Promise<AiAskResponse>

  /** 根据 AiChartSpec 获取渲染数据（后续可为真实 LLM 调整数据格式） */
  getChartData(
    spec: AiChartSpec,
    response: AiAskResponse
  ): ChartDataResult

  /** 组件是否可用（Mock 始终可用；真实 LLM 可能因配置不可用） */
  isAvailable(): boolean

  /** 返回适配器名称，用于调试/日志 */
  readonly name: string
}

export interface AiAskContext {
  /** 当前数据范围 */
  datasourceId: number | null
  datasourceName: string | null
  selectedTables: string[]

  /** 当前会话历史（用于多轮追问，Phase 5G 预留） */
  messageHistory?: Array<{
    role: 'user' | 'assistant'
    content: string
    responseJson?: Record<string, unknown>
  }>

  /** 附加约束 */
  options?: {
    /** 模拟执行延迟（ms），仅 Mock 使用 */
    mockDelay?: [number, number]  // [min, max]
    /** 是否模拟执行失败 */
    mockFailureRate?: number      // 0-1
  }
}

export interface ChartDataResult {
  columns: string[]
  rows: any[][]
  isEmpty: boolean
  error?: string
}
```

### 2.3 场景化 Mock 设计

MockAdapter 根据用户问题的关键词模式匹配返回不同的响应场景，替代 Phase 5F 的单一固定响应。

```typescript
// api/aiAsk/mockAdapter.ts

/** 内置场景列表 */
export const MOCK_SCENARIOS: MockScenario[] = [
  {
    id: 'revenue-by-region',
    match: /(区域|地区|各省|区域).*(销售|收入|营收)/i,
    response: MOCK_RESPONSE_REVENUE_BY_REGION,
    chartData: MOCK_DATA_REVENUE_BY_REGION,
    description: '各区域销售额',
  },
  {
    id: 'trend-over-time',
    match: /(趋势|走势|月度|季度|月度变化)/i,
    response: MOCK_RESPONSE_TREND,
    chartData: MOCK_DATA_TREND,
    description: '时间趋势分析',
  },
  {
    id: 'top-n',
    match: /(top|排名|前|排行|最高|最多)/i,
    response: MOCK_RESPONSE_TOP_N,
    chartData: MOCK_DATA_TOP_N,
    description: 'Top-N 排名',
  },
  {
    id: 'comparison',
    match: /(对比|比较|同比|环比|vs|versus)/i,
    response: MOCK_RESPONSE_COMPARISON,
    chartData: MOCK_DATA_COMPARISON,
    description: '对比分析',
  },
  {
    id: 'default',
    match: /.*/,
    response: MOCK_RESPONSE_DEFAULT,
    chartData: MOCK_DATA_DEFAULT,
    description: '通用分析',
  },
]
```

**场景设计原则：**

| 场景 | 问题示例 | 意图特征 | 图表建议 | 数据特征 |
|------|---------|---------|---------|---------|
| revenue-by-region | "各区域销售额" | 维度=区域, 指标=销售额 | bar + metric-card | 6 个区域，数值差异大 |
| trend-over-time | "近 6 个月收入趋势" | 维度=月份, 指标=收入 | line + metric-card | 6-12 个时间点，带趋势 |
| top-n | "收入前 10 客户" | 维度=客户, 排序=desc | bar | 10 项，长尾分布 |
| comparison | "去年vs今年同比" | 时间对比 | combo (bar+line) | 双 Y 轴或分组柱状 |
| default | 通用/无关键词匹配 | 通用 | bar + pie | 混合数据 |

**场景的 Mock 数据规范：**
- 每个场景有自己的 `MOCK_RESPONSE_XXX` 和 `MOCK_DATA_XXX`。
- `MOCK_DATA_XXX` 的 columns/rows 必须与 `chartSuggestions` 中的字段名一致。
- 每个场景至少包含 2 个 chartSuggestion，其中至少 1 个包含 `metricCards`。
- 每个场景的解读（narrative）内容随场景变化，而非相同的硬编码文本。

### 2.4 响应校验器

```typescript
// api/aiAsk/validator.ts

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: string[]
}

export interface ValidationError {
  path: string       // e.g. "sqlPlan.sql"
  message: string
  severity: 'error' | 'warning'
}

/**
 * 校验 AiAskResponse 是否符合协议规范。
 *
 * 校验内容：
 * - question 不能为空
 * - intent 至少有一个 metrics 或 dimensions
 * - sqlPlan.sql 不能为空
 * - chartSuggestions 至少 1 个
 * - narrative.summary 不能为空
 * - 每个 chartSuggestion 必须有 title、chartType、yFields
 * - chartType 必须是合法值
 * - semanticGaps 中的字段引用必须在 sqlPlan.fields 或 chartSuggestions 中存在
 */
export function validateAiAskResponse(
  response: unknown
): ValidationResult {
  // ... 验证逻辑
}
```

**校验规则：**

| 规则 | 级别 | 说明 |
|------|------|------|
| response 为 null/undefined | error | 完全不可用 |
| question 为空 | error | 缺少原始问题 |
| intent 无 metrics 且无 dimensions | warning | AI 未理解任何业务要素 |
| sqlPlan.sql 为空 | error | 无法执行查询 |
| sqlPlan.tables 为空 | warning | SQL 可能缺少表引用 |
| chartSuggestions 为空 | warning | 无图表建议（但仍可展示结果表） |
| chartSuggestion.title 为空 | error | 图表缺少标题 |
| chartSuggestion.chartType 不合法 | warning | fallback 为 bar |
| narrative.summary 为空 | warning | 无解读摘要 |
| semanticGap.field 不在 fields 中 | warning | 引用未知字段 |

### 2.5 错误处理

```typescript
// api/aiAsk/errors.ts

export class AiAskError extends Error {
  constructor(
    message: string,
    public code: AiAskErrorCode,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AiAskError'
  }
}

export type AiAskErrorCode =
  | 'ANALYSIS_TIMEOUT'       // 分析超时
  | 'INVALID_RESPONSE'       // 响应结构不符合协议
  | 'NO_DATA'                // 无可用数据
  | 'ADAPTER_UNAVAILABLE'    // 适配器不可用
  | 'CONTEXT_TOO_LARGE'      // 上下文超出限制
  | 'UNKNOWN'                // 未知错误

// 错误 → 用户提示映射
export function getAiAskErrorMessage(code: AiAskErrorCode): string {
  switch (code) {
    case 'ANALYSIS_TIMEOUT':
      return '分析超时，请简化你的问题后重试'
    case 'INVALID_RESPONSE':
      return 'AI 返回结果异常，请重试'
    case 'NO_DATA':
      return '当前数据范围无可用数据'
    case 'ADAPTER_UNAVAILABLE':
      return 'AI 服务暂不可用，请稍后重试'
    case 'CONTEXT_TOO_LARGE':
      return '当前对话上下文过长，建议开始新对话'
    case 'UNKNOWN':
      return '分析异常，请重试'
  }
}
```

### 2.6 状态管理更新

`aiAskStore` 新增适配器相关状态：

```typescript
interface AiAskStore {
  // ... 5F 现有状态 ...

  // 5G.1 新增
  adapterName: string                // 当前适配器名称
  responseValidation: ValidationResult | null  // 当前响应的校验结果
  error: AiAskError | null           // 当前错误状态

  // Actions
  setAdapterName: (name: string) => void
  setError: (error: AiAskError | null) => void
  clearError: () => void
}
```

### 2.7 AskWorkbenchPage 变更

```
Phase 5F                                           Phase 5G.1
─────────                                          ─────────
import { MOCK_ASK_RESPONSE, MOCK_CHART_DATA }      import { useAiAskService } from '../api/aiAsk'
import { useAiAskStore }                           import { useAiAskStore }

const simulateAiAnalysis = useCallback(...)         const adapter = useAiAskService()
  // 直接使用 MOCK_ASK_RESPONSE                     const { analyze, validate } = adapter
                                                     const handleSend = useCallback(async (...) => {
  const handleSend = useCallback(async (...) =>        const resp = await analyze(question, {
    // 直接模拟分析                                    datasourceId, datasourceName, selectedTables
    setAnalyzing(true)                                 })
    await new Promise(...)                             // 校验
    setCurrentResponse(mockResponse)                   const validation = validate(resp)
    setAnalyzing(false)                                if (!validation.valid) { /* 显示错误 */ }
  })                                                    setCurrentResponse(resp)
                                                     })
```

### 2.8 文件结构（5G.1 新增/修改）

| 文件 | 操作 | 职责 |
|------|------|------|
| `frontend/src/api/aiAsk/adapter.ts` | **新增** | AiAskAdapter 接口定义、AiAskContext、ChartDataResult |
| `frontend/src/api/aiAsk/mockAdapter.ts` | **新增** | MockAdapter 实现、场景注册、匹配器逻辑 |
| `frontend/src/api/aiAsk/scenarios/` | **新增目录** | 各场景的 mock 响应和数据文件 |
| `frontend/src/api/aiAsk/validator.ts` | **新增** | AiAskResponse 结构校验器 |
| `frontend/src/api/aiAsk/errors.ts` | **新增** | AiAskError 类和错误码 |
| `frontend/src/api/aiAsk/index.ts` | **新增** | 统一导出 + useAiAskService hook |
| `frontend/src/api/aiAsk.mock.ts` | **删除** | 5F 单文件 mock 被 scenarios 目录替代 |
| `frontend/src/stores/aiAskStore.ts` | **修改** | 新增 adapterName、error、validation 状态 |
| `frontend/src/pages/AskWorkbenchPage.tsx` | **修改** | 从使用 MOCK_ASK_RESPONSE 改为使用 adapter 接口 |

---

## 3. Phase 5G.2：图表美化与自动推荐增强（A-MVP）

### 3.1 目标

在 Phase 5F 的 AiChartSpec / ChartCanvas / AiChartBoard / ChartCard 基础上，完成图表体验的可感知飞跃：

1. **补齐缺失的 chartType**：metric-card、combo、table 的渲染。
2. **增强已有图表类型**：多 yFields 支持、数据标签、更好的 tooltip、legend。
3. **轻量自动推荐**：AI 或 mock 能够根据数据特征推荐 charts，而不是硬编码 3 个。
4. **视觉提升**：业务卡片风格、数据标签格式化、图例优化、数值格式化。

### 3.2 chartType 补齐

#### 3.2.1 metric-card（指标卡）

**当前状态：** ChartCard 有 metric-card 的 UI 渲染代码（grid 布局中的 label/value/change），但 Phase 5F 的 MOCK_ASK_RESPONSE.chartSuggestions 中从未包含 `chartType: 'metric-card'` 的用例。ChartCanvas 对 metric-card fallback 为"暂不支持"。

**Phase 5G 要求：**

- ChartCard 中 metric-card 的 UI 渲染保持现有实现，但增强：
  - 支持自定义图标（MetricCard 协议新增 `icon?: string`）
  - 数值格式化增强（大数自动转为 K/M/B，百分比自动加 %，货币自动加 ¥）
  - 卡片背景可配置微渐变（非纯白）
- ChartCanvas 对 `chartType: 'metric-card'` 不再做 fallback，直接返回 null（不渲染 ECharts）
- 至少 1 个 mock 场景的 chartSuggestions 包含 metric-card 作为第一个建议

**MetricCard 协议增强：**

```typescript
interface MetricCard {
  label: string
  value: string
  change?: string
  changeDirection?: 'up' | 'down' | 'flat'
  icon?: string                  // 5G 新增：可选图标 key，如 'revenue' | 'orders' | 'customers' | 'profit'
}
```

**指标卡视觉：**

```
┌───────────────────┐
│  📊 总销售额       │  ← icon + label
│  ¥45,632,000      │  ← 大号数值（自动格式化）
│  ↑ +12.3% 同比    │  ← 绿色↑ 或 红色↓
│  较上期增加 5.2M  │  ← 5G 新增：辅助文字
└───────────────────┘
```

**数值格式化规则：**

| 原始值 | 格式化结果 | 场景 |
|--------|-----------|------|
| 45632000 | ¥45.6M | 货币/大数 |
| 1234567 | 1.2M | 计数 |
| 0.325 | 32.5% | 百分比（自动检测） |
| 4201 | 4,201 | 千分位 |
| 0.08 | 8% | 小百分比 |

#### 3.2.2 combo（组合图 — bar + line）

**当前状态：** ChartCanvas 对 combo fallback 为"暂不支持"。

**Phase 5G 要求：**

- ChartCanvas 实现组合图：柱状图 + 折线图双系列。
- 柱状图显示第一指标（yFields[0]），折线图显示第二指标（yFields[1]）。
- 如果 yFields 只有 1 个，combo 退化为 bar。

```
combo 示例：yFields = ['total_revenue', 'growth_rate']
  yFields[0] (total_revenue) → 柱状图，左 Y 轴
  yFields[1] (growth_rate)   → 折线图，右 Y 轴（如果数值量级差异大）
                              → 共享 X 轴，柱线堆叠（如果数值量级接近）

判断规则：
  max(yField[0]) / max(yField[1]) > 5 → 双 Y 轴
  否则 → 单左 Y 轴，柱线共存
```

**组合图实现约束：**
- 使用 ECharts 双 Y 轴（`yAxis: [{...}, {...}]`）。
- 左 Y 轴为柱状图，蓝色系。
- 右 Y 轴为折线图，绿色系。
- tooltip 同时显示两个系列的值。
- 数据标签柱状图显示在柱顶，折线图显示在点旁。

#### 3.2.3 table（表格）

**当前状态：** 图表建议中不会出现 `chartType: 'table'`。结果表在 AskWorkbenchPage 中以内联 HTML table 展示。

**Phase 5G 要求：**

- AiChartSpec 的 `chartType: 'table'` 渲染为 Ant Design Table 组件。
- 支持列排序、数值格式化（与 metric-card 统一规则）。
- Table 作为 chartSuggestion 之一，通常出现在"明细数据"场景。
- 列的渲染类型自动推断（数值右对齐，文本左对齐，百分比格式）。
- 表格带行号、精简分页（默认每页 10 行）。

### 3.3 多 yFields 支持

**当前状态：** ChartCanvas 只使用 `yFields[0]`，忽略其余字段。

**Phase 5G 要求：**

- **bar 图**：当 yFields 有 2+ 个时，渲染为分组柱状图（簇状，非堆叠）。
  - 每个 yField 对应一个系列，使用 theme 色板的不同颜色。
  - 图例显示每个 yField 的标签。
  - tooltip 显示全部 yField 的值。
- **line 图**：当 yFields 有 2+ 个时，渲染为多条折线。
  - 使用 theme 色板的不同颜色。
  - 图例显示每个 yField 的标签。
  - 折线使用不同 dash 模式增强区分度（实线、虚线、点线）。
- **pie 图**：仅使用 yFields[0]，多余字段忽略（饼图不适合多指标）。

**分组柱状示例：**

```
yFields = ['total_revenue', 'gross_margin']
                      总销售额  ██  毛利率  ██
华东  ████████████████████████████████
华南  ████████████████████████
华北  ████████████████████
...
```

### 3.4 数据标签与数值格式化

**当前状态：** ChartCanvas 没有数据标签，tooltip 使用 ECharts 默认格式。

**Phase 5G 要求：**

| 图表类型 | 数据标签 | 标签位置 | 格式化规则 |
|---------|---------|---------|-----------|
| bar | ✅ 显示 | 顶部（外部） | 大数自动格式化（12.3M） |
| line | ✅ 显示 | 端点（上方） | 大数自动格式化 |
| pie | ✅ 显示 | 扇区内外 | `名称: 值 (占比%)` |
| combo | ✅ 显示 | 柱顶 + 点旁 | 按系列分别格式化 |
| metric-card | N/A | N/A | 字幕式大号数字+单位+趋势 |
| table | N/A | N/A | 列级格式化 |

**数值格式化工具（迁移到公共 utils）：**

```typescript
// utils/numberFormat.ts — 从 ChartCard/metric-card 专用升级为公共

export function formatMetricValue(value: number, format?: MetricFormat): string
export function formatPercent(value: number): string
export function formatCurrency(value: number): string
export function formatCompact(value: number): string  // 1234567 → '1.2M'
export function detectFormat(values: number[], labels?: string[]): MetricFormat
```

### 3.5 Tooltip 与 Legend 增强

**Tooltip 增强：**

| 类型 | 当前 | 5G 目标 |
|------|------|---------|
| bar | trigger: 'axis'，只显示值 | 显示：维度 + 各指标名 + 格式化值 + 占比（可选） |
| line | trigger: 'axis' | 显示：时间点 + 各指标名 + 格式化值 + 环比（自动计算两点间） |
| pie | trigger: 'item'：`{b}: {c} ({d}%)` | 显示：名称 + 格式化值 + 占比 + 排名（eg. "第 1/6"） |
| combo | trigger: 'axis' | 显示：维度 + 柱图指标 + 折线指标 + 右轴单位 |

**Legend 增强：**

- 多 yFields 时自动显示图例。
- 图例位置：默认底部居中。
- 可点击图例切换系列显示/隐藏。
- 图例文字使用 theme 字体。

### 3.6 轻量 Chart Recommendation

**当前状态：** chartSuggestions 是硬编码的 3 个固定 spec，与数据特征无关。

**Phase 5G 要求：**

在 MockAdapter 中实现简单的基于规则的推荐逻辑，非 AI 驱动，**不是真实 LLM 推荐**：

```typescript
// api/aiAsk/recommendation.ts

export interface ChartRecommendationInput {
  /** 原始数据列名 */
  columns: string[]
  /** 每列的前几行样本值 */
  sampleRows: any[][]
  /** 用户意图（来自 intent） */
  intent: AiAskResponse['intent']
}

/**
 * 基于规则和图启发式的图表推荐引擎。
 *
 * 规则：
 * 1. 如果维度只有 1 个 + 指标 1-2 个 → 推荐 bar / pie + metric-card
 * 2. 如果维度为时间/日期 → 推荐 line + metric-card
 * 3. 如果维度超过 1 个 → 推荐 bar（多 yFields 分组柱状）
 * 4. 如果有排序（top-n） → 推荐 bar + metric-card
 * 5. 如果有对比意图 → 推荐 combo
 * 6. 如果用户要求明细 → 推荐 table
 *
 * 返回排序后的 AiChartSpec[]（至少 1 个，最多 4 个）。
 */
export function recommendCharts(input: ChartRecommendationInput): AiChartSpec[]
```

**推荐规则示例：**

| 数据特征 | 推荐类型组合 |
|---------|------------|
| 维度=区域, 指标=销售额 | bar + metric-card（总销售额指标卡 + 各区域柱状图） |
| 维度=月份, 指标=收入 | line + metric-card（趋势线 + 汇总指标卡） |
| 维度=客户, 指标=收入, 排序=desc | bar + metric-card（Top-N 柱状 + 头部门槛指标卡） |
| 维度=区域, 指标=[销售额,毛利率] | bar（分组柱状）+ metric-card |
| 意图含"对比"/"同比" | combo（柱线组合）+ metric-card |
| 维度=区域, 无排序 | bar + pie（柱状对比 + 占比结构） |

**不做的内容：**
- 不做 AI 驱动的推荐（不调用任何模型）。
- 不做基于统计数据分布的推荐（标准差、偏度等）。
- 不做用户行为学习的推荐。

### 3.7 视觉提升

**当前状态的问题记录：**

| 问题 | 位置 | 5G 改善 |
|------|------|---------|
| 图表边界不清晰 | ChartCard | 增加浅阴影、hover 微动效 |
| 数值格式不统一 | 表格 + 图表 | 统一 formatMetricValue |
| 多图标表时 colors 不够区分度 | ChartCanvas | 相邻色板项对比度检查 |
| tooltip 缺少单位 | ChartCanvas | 从 spec.yFields 推断单位或字段名 |
| 结果表无格式化 | AskWorkbenchPage 内联 table | 使用 Ant Design Table + 数值格式化 |
| 图表卡片间间距拥挤 | AiChartBoard | 增加 gap、第一张卡片默认高亮 |
| 加载状态不够精致 | AskWorkbenchPage | 骨架屏替代 Spin |

**颜色对比度增强：**

`chartThemes.ts` 中的色板在多 yFields（超过 4 个）时需要保证相邻色相有足够区分度。当前色板 `['#4E7BF5', '#58B9FF', '#7CD3A0', '#FFB347', '#FF7B7B', '#A78BFA']` 中的 #4E7BF5 和 #58B9FF 在单色显示器上区分度不足。5G 引入颜色交替策略：

```typescript
export function getSeriesColor(index: number, palette: string[]): string {
  // 当 series 数量 ≤ palette.length 时，直接取 palette[index]
  // 当 series 数量 > palette.length 时，间隔取色避免相邻冲突
  return palette[index % palette.length]
}
```

不引入新的色板设计工具，不做无障碍色盲模式（Phase 5G 不涉及）。

### 3.8 文件结构（5G.2 新增/修改）

| 文件 | 操作 | 职责 |
|------|------|------|
| `frontend/src/utils/numberFormat.ts` | **新增** | 数值格式化工具函数 |
| `frontend/src/api/aiAsk/recommendation.ts` | **新增** | 基于规则的图表推荐引擎 |
| `frontend/src/styles/chartThemes.ts` | **修改** | 新增 getSeriesColor 工具函数 |
| `frontend/src/utils/chartData.ts` | **修改** | 支持多 yFields 聚合 |
| `frontend/src/components/ChartCanvas.tsx` | **修改** | 新增 combo 渲染、多 yFields、数据标签、tooltip 增强 |
| `frontend/src/components/ChartCard.tsx` | **修改** | metric-card 增强、数值格式化、视觉微调 |
| `frontend/src/components/AiChartBoard.tsx` | **修改** | 响应式间距、默认高亮 |
| `frontend/src/pages/AskWorkbenchPage.tsx` | **修改** | 结果表使用 Ant Design Table 替代内联 table |
| `frontend/src/types/aiAsk.ts` | **修改** | MetricCard 新增 icon 字段 |

---

## 4. 整体类型 / Schema 变更

### 4.1 MetricCard 协议变更

```typescript
// types/aiAsk.ts

interface MetricCard {
  label: string
  value: string
  change?: string
  changeDirection?: 'up' | 'down' | 'flat'
  icon?: string         // 5G 新增: 'revenue' | 'orders' | 'customers' | 'profit' | 'rate'
                        // 前端映射对应图标
}
```

**Icon 映射表：**

| icon key | 实际图标 |
|----------|---------|
| 'revenue' | DollarOutlined |
| 'orders' | ShoppingCartOutlined |
| 'customers' | UserOutlined |
| 'profit' | RiseOutlined |
| 'rate' | PercentageOutlined |
| 未定义/未知 | 不显示图标 |

### 4.2 无破坏性变更

**2 个 Phase 文件均不破坏向后兼容性：**

- `AiAskResponse` 完全不变。
- `AiChartSpec` 完全不变。
- `AiInsightNarrative` 完全不变。
- `SemanticGap` 完全不变。
- 新增的 `adapter` 接口是全新层，不修改现有 store 的行为语义（只 add 新字段）。
- `MetricCard.icon` 为 optional，历史 mock/LLM 输出不报错。

---

## 5. UI / 交互要求

### 5.1 图表交互

| 交互 | 当前 | Phase 5G |
|------|------|----------|
| 图表切换 | 点击卡片切换 activeIndex | 保持不变，默认选中第一个 |
| 数据标签 | 无 | 所有图表默认显示数据标签 |
| 图例 | 无（单系列） | 多系列显示，可点击切换 |
| Tooltip | ECharts 默认 | 业务格式化，含单位/占比/排名 |
| 柱状图动画 | 无 | 入场动画（appear animation） |
| 指标卡 hover | 无 | hover 微阴影 + scale(1.02) |
| 图表卡片点击 | 切换 active | 保持不变 |

### 5.2 加载与状态

**骨架屏（5G 新增）：**

当前加载态使用 Spin + "正在分析你的问题..."。5G 升级为内容骨架屏：

```
分析中骨架：
┌────────────────────────────────────────┐
│ ┌──────────┐  ┌──────────┐             │
│ │ ░░░░░░░  │  │ ░░░░░░░  │  ← 脉冲灰块 │
│ │ ░░░░░░░  │  │ ░░░░░░░  │              │
│ └──────────┘  └──────────┘              │
│                                         │
│ 正在分析你的问题...                      │
│ ── AI 理解意图  ✓                       │  ← 步骤指示器（动态更新）
│ ── 生成查询计划  ⟳                       │
│ ── 执行查询                              │
│ ── 生成图表                              │
│ ── 生成解读                              │
└────────────────────────────────────────┘
```

**阶段提示器：**

| 步骤 | 状态 | 文案 |
|------|------|------|
| 1 | 完成 | ✅ AI 正在理解你的问题 |
| 2 | 进行中 | ⟳ 正在分析查询计划 |
| 3 | 待处理 | ◻ 正在获取数据 |
| 4 | 待处理 | ◻ 正在生成图表 |
| 5 | 待处理 | ◻ 正在生成解读摘要 |

**实现：** aiAskStore 新增 `analysisStep: number`，MockAdapter 按进度更新。5G.1 中 MockAdapter 以 600-1200ms 间隔逐步推进步骤。

### 5.3 错误展示

当 adapter.analyze 抛出 AiAskError 时：

```
┌────────────────────────────────────────┐
│ ❌ 分析异常                             │
│                                         │
│ AI 返回结果异常，请重试                  │
│                                         │
│ [重试] [修改问题] [查看详情 ▾]           │
│  ┌────────────────────────────────┐    │
│  │ 错误码：INVALID_RESPONSE       │    │
│  │ 缺失字段：sqlPlan.sql           │    │
│  └────────────────────────────────┘    │
└────────────────────────────────────────┘
```

---

## 6. 测试策略

### 6.1 测试类别与覆盖

| 类别 | 文件 | 覆盖 |
|------|------|------|
| 单元测试 | `numberFormat.test.ts` | formatCompact / formatPercent / detectFormat |
| 单元测试 | `validator.test.ts` | 完整 AiAskResponse 校验、缺失字段、异常处理 |
| 单元测试 | `recommendation.test.ts` | 不同数据特征下的推荐结果 |
| 单元测试 | `mockAdapter.test.ts` | 关键词匹配逻辑、场景回退 |
| 单元测试 | `ChartCanvas.test.tsx` | combo / 多 yFields / metric-card fallback |
| 集成测试 | `AskWorkbenchPage.test.tsx` | adapter 集成、多场景 mock |

### 6.2 不测试

- 不测试真实 LLM 调用。
- 不测试 Monaco DOM 细节。
- 不测试动画帧率或渲染性能。
- 不测试 ECharts canvas 像素级渲染（使用 snapshot 或 mock echarts）。

### 6.3 Mock 策略

- adapter 测试使用 `MockAdapter.create()` 实例化。
- ChartCanvas 测试使用 ECharts 的 `jest` mock（现有方式延续）。
- 页面集成测试使用 `mockAdapter` 替代直接 import MOCK_ASK_RESPONSE。

### 6.4 验证命令

```bash
cd frontend && npm run test          # 单元 + 集成测试
cd frontend && npm run build         # 构建验证
cd frontend && npx tsc --noEmit      # 类型检查
```

---

## 7. 风险与控制

| 风险 | 说明 | 影响阶段 | 控制方式 |
|------|------|---------|---------|
| ChartCanvas 修改范围大 | combo + 多 yFields 涉及 ECharts option 较大改动 | 5G.2 | 先做 unit test 覆盖，再改实现 |
| 场景化 mock 膨胀 | 场景文件太多，维护成本上升 | 5G.1 | 限制初始场景 ≤ 5 个，场景文件按统一模板 |
| recommendation 与真实 LLM 推荐逻辑冲突 | 5G 的规则推荐后续可能被 LLM 推荐覆盖 | 5G.2 | 明确 recommendation 只在 MockAdapter 中使用，真实 LLM 场景由 LLM 自行建议 |
| metric-card 数值格式化含本地化假设 | ¥/. 等货币符号硬编码 | 5G.2 | 货币格式使用占位符，当前硬编码 ¥ 但文档标注"如需要本地化，后续抽离为 config" |
| ChartCanvas 重构后 5F 测试用例失效 | 现有测试断言可能因新增标签/动画而变化 | 5G.2 | 修改现有测试用例，保持兼容性不删除现有断言 |
| adapter 接口与真实 LLM 需求不匹配 | F-light 接口过于简化，后续真实 LLM 需要额外参数 | 5G.1 | AiAskContext 预留 `options: Record<string, unknown>` 扩展点 |
| 骨架屏步骤指示器过于复杂 | 5 步状态管理与 mock 时序耦合 | 5G.1 | 如果实现复杂度高，保留 Spin 后备，骨架屏不作为硬性要求 |

---

## 8. 非目标（Phase 5G 明确不做）

- ❌ 不做真实 LLM 接入（除非用户单独授权）
- ❌ 不新增后端 API / DB / migration
- ❌ 不做多轮问数完整能力（Phase 5G.1 的 adapter 只做接口预留）
- ❌ 不做解读 Agent MVP（Phase 5H）
- ❌ 不做报告 Agent MVP（Phase 5I）
- ❌ 不做语义治理大改
- ❌ 不引入 Playwright / Cypress
- ❌ 不修改 SQL Workbench 核心逻辑
- ❌ 不做图表导出（PNG/PDF）
- ❌ 不做无障碍色盲模式
- ❌ 不引入 D3.js 或其他图表库替代 ECharts
- ❌ 不做响应式/移动端适配
- ❌ 不处理 Phase 4 未跟踪遗留文件

---

## 9. 实施顺序建议

```
Phase 5G 实施顺序（共约 3-4 周）

第一周：5G.1 Adapter 基础设施
  Day 1-2: adapter.ts 接口 + AiAskError + 校验器
  Day 3-4: 场景化 MockAdapter（5 个场景）
  Day 5:   集成到 AskWorkbenchPage（替换硬编码 mock）

第二周：5G.2 图表增强（核心）
  Day 1-2: combo 组合图 + 多 yFields 分组柱/多折线
  Day 3:   metric-card 增强 + 数值格式化工具
  Day 4:   数据标签 + tooltip + legend 增强
  Day 5:   table 类型 + 结果表 Ant Design Table 迁移

第三周：5G.2 推荐 + 视觉 + 测试
  Day 1-2: 轻量 chart recommendation 引擎
  Day 3-4: 视觉提升（阴影、动效、骨架屏、间距）
  Day 5:   全量测试 + 类型检查 + 构建验证
```

---

## 10. 自检清单

- [x] Phase 5G 定位：A + F 串联，不是新 Agent 模式
- [x] 5G.1 不涉及任何后端/DB/真实 LLM
- [x] 5G.2 纯前端图表增强，不改变 SQL Workbench
- [x] AiAskResponse 协议无破坏性变更
- [x] MetricCard.icon 为 optional 向后兼容
- [x] 适配器接口预留多轮追问上下文（messageHistory）
- [x] recommendation 明确为"规则驱动，非 AI 驱动"
- [x] 测试策略不含 E2E、Monaco DOM、canvas 像素级
- [x] 所有新增文件在前端目录内（无后端）
- [x] 非目标列表明确
- [x] 风险控制措施齐全
- [x] 约束条件全部文档化
- [x] 无 TBD / TODO / 模糊表述
- [x] 无硬编码 `dwhrpt`
- [ ] 无高成本不确定性实现
