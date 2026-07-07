# Phase 5J AI 问数解释可信度与证据链增强设计说明书

日期：2026-07-06

状态：正式设计 spec，用于后续 implementation plan

修订记录：
| 版本 | 日期 | 内容 |
|------|------|------|
| v1.0 | 2026-07-06 | 初始正式设计 |

关联资料：
- [Phase 5I AI 问数质量与安全保障设计说明书](./2026-07-06-phase-5i-ai-ask-quality-safety-design.md)
- [Phase 5H AI 问数多轮追问与上下文理解增强设计说明书](./2026-07-05-phase-5h-ai-ask-followup-context-design.md)
- [Phase 5F AI 问数 Agent 产品底座设计说明书](./2026-07-03-phase-5f-ai-ask-agent-workbench-design.md)

---

## 1. 背景与目标

### 1.1 Phase 5F-5I 已完成的基础

| Phase | 交付物 | 与证据链的关系 |
|-------|--------|---------------|
| Phase 5F | AiAskAdapter 协议、AiAskResponse 类型体系、组件架构 | 定义了 response 基本骨架，evidence 为 `{ claim, fields, sqlSnippet }` |
| Phase 5G | 场景化 MockAdapter、ChartCanvas、AiChartBoard | 提供了场景数据基底 |
| Phase 5H | 多轮上下文协议、FollowUpType、ProcessInsight、Narrative 增强（conclusion/evidence/risks/nextQuestions 结构化） | 现有 EvidenceItem 含 claim/fields/sqlSnippet/value/significance；ProcessInsight 含 understoodMetrics/dimensions |
| Phase 5I | Input Guard、Context Policy、Error Recovery、Benchmark Runner | 提供了质量保障基座和 benchmark 框架 |

当前 AI 问数管线的**完整数据流**：

```
用户输入 → Input Guard(阻断) → Context Policy(上下文) → Adapter.analyze()
  → Intent 理解 → SQL Plan → Result Summary → Chart Suggestions
  → Narrative(conclusion + summary + keyFindings + evidence + risks + nextQuestions)
  → UI 渲染(IntentCard + ContextChain + AiChartBoard + AiNarrative + ProcessPanel)
  → 用户追问 → 循环
```

### 1.2 当前痛点

Phase 5H 已引入 `EvidenceItem` 结构，每条 keyFinding 可附带 `claim`、`fields`、`sqlSnippet`、`value`、`significance`。但在实际使用中，用户仍然无法回答以下问题：

| 用户问题 | 当前状态 | 用户感知 |
|---------|---------|---------|
| "这个结论的依据是什么？" | 看到 fields 字段名和 sqlSnippet，但不知道具体数值是怎么算的 | 信任度不足 |
| "这个可信吗？" | 无置信度标识，所有结论看起来一样"确定" | 无法判断结论可靠程度 |
| "18.3% 这个数字从哪行数据来？" | 只有结论文字，无数值来源说明 | 需切 SQL Workbench 手工验证 |
| "为什么 AI 这样判断？" | ProcessPanel 显示 understoodMetrics 但无"意图→SQL→结果→结论"的映射 | 推理过程不透明 |

### 1.3 Phase 5J 目标

**让 AI 问数结论可验证**——不是完整数据血缘系统，不是审计平台。

从"AI 说的"到"我能验证的"：

```
当前：claim: "华东领先" → fields: ['region', 'total_revenue']
      用户：怎么领先的？从哪里看出来的？

Phase 5J：claim: "华东领先"
           → sourceFields: ['region', 'total_revenue']
           → sqlSnippet: 'SUM(r.amount) GROUP BY region'
           → calculation: 'SUM(r.amount) WHERE region='华东' / SUM(r.amount) OVER()'
           → displayValue: '¥12.3M (29.4%)'
           → confidence: 'high'
           → confidenceReason: '数据覆盖 30 天，字段匹配度 100%'
           → relatedIntent: { metrics: ['销售额'], dimensions: ['区域'] }
```

### 1.4 Phase 5J 在路线图中的位置

| Phase | 目标 | 状态 |
|-------|------|------|
| Phase 5F | AI 问数 Agent 产品底座 | ✅ 已完成 |
| Phase 5G | AI 图表美化与 Adapter 协议 | ✅ 已完成 |
| Phase 5H | 多轮追问与上下文理解增强 | ✅ 已完成 |
| Phase 5I | AI 问数质量与安全保障 | ✅ 已完成 |
| **Phase 5J（当前）** | **AI 问数解释可信度与证据链增强** | **⬅️ 当前** |

---

## 2. MVP 范围

### 2.1 必须做

| 模块 | 说明 | 优先级 |
|------|------|--------|
| EvidenceItem 字段扩展 | 追加 sourceFields、calculation、confidence、confidenceReason、relatedIntent、displayValue | P0 |
| Narrative 新增类型 | 为 AiInsightNarrative 补充 evidenceSummary（证据总览）字段 | P0 |
| MockAdapter 场景补充 EvidenceItem 扩展字段 | 扩展所有场景数据的 evidence 数组，填充新增的 optional 字段 | P0 |
| AiNarrative "查看证据"渐进式展开 | 每条 evidence 增加"查看证据"入口，展开后展示来源说明 | P0 |
| ProcessPanel 映射链升级 | 增加 intent → SQL plan → result → conclusion 的轻量映射 | P1 |
| SQL 片段与 evidence 的轻量关联 | evidence 展开层展示关联 SQL 分段标注（过滤/分组/聚合） | P1 |
| Benchmark 增加 evidence 质量检查 | evidence completeness / confidence reason / sql snippet presence | P1 |
| 组件和纯函数测试 | EvidenceItem 渲染展开/折叠、ProcessPanel 映射链、旧数据向后兼容 | P1 |

### 2.2 明确不做

- 不做行级数据血缘（记录级追踪需要后端 SQL 执行引擎配合）
- 不做字段级元数据自动匹配（需要治理模块的元数据资产管理）
- 不做跨查询一致性校验（需要后端跨查询对比能力）
- 不做后端 API / DB / migration（全部前端实现）
- 不接真实 LLM（全部 MockAdapter 模拟）
- 不做报告生成（Phase 5I 路线图中的 "Phase 5J AI 报告 Agent" 已被本 spec 替换，报告方向延后）
- 不做会话持久化（Phase 5J 不涉及 localStorage 或服务端存储）
- 不引入 Playwright / Cypress
- 不测试 Monaco DOM

---

## 3. 数据结构设计

### 3.1 EvidenceItem 扩展

```typescript
// frontend/src/types/aiAsk.ts — 现有 EvidenceItem 扩展

export interface EvidenceItem {
  claim: string                                   // 断言（现存）
  fields: string[]                                // 相关字段（现存）
  sqlSnippet?: string                             // 证据 SQL（现存）
  value?: string                                  // 具体数值（现存，Phase 5H 追加）
  significance?: string                           // 业务含义（现存，Phase 5H 追加）

  // Phase 5J 新增字段（全部 optional → 向后兼容）
  sourceFields?: string[]                         // 具体参与计算的源字段（如 ['r.amount', 'r.region']）
  calculation?: string                            // 计算逻辑描述（如 'SUM(r.amount) GROUP BY region'）
  confidence?: 'high' | 'medium' | 'low'         // 本条证据的可信度
  confidenceReason?: string                       // 置信度原因（如 '数据覆盖30天，无缺失值'）
  relatedIntent?: {                               // 关联的分析意图上下文
    metrics: string[]
    dimensions: string[]
    filters?: string[]
    timeRange?: string
  }
  displayValue?: string                           // 格式化展示值（如 '¥12.3M (29.4%)'）
}
```

**设计原则**：

1. 所有新增字段均为 `optional`（`?`）—— 旧 Phase 5H data 无需修改即可渲染
2. `fields`（现有）与 `sourceFields`（新增）的区别：
   - `fields`：业务概念字段名，用于 UI 展示（如 `['region', 'total_revenue']`）
   - `sourceFields`：底层数据源字段路径，用于溯源（如 `['r.amount', 'r.region']`）
3. `confidence` 复用 `'high' | 'medium' | 'low'` 字符串 enum（与 FollowUpQuestion.confidence 一致）
4. `relatedIntent` 直接复用 AiAskResponse.intent 的子集结构
5. 不引入嵌套泛型、不引入联合类型判定

### 3.2 AiInsightNarrative 扩展

```typescript
// frontend/src/types/aiAsk.ts — AiInsightNarrative 扩展

export interface AiInsightNarrative {
  summary: string                                  // （现存）
  keyFindings: string[]                            // （现存）
  evidence: EvidenceItem[]                         // （现存，字段已扩展）
  risks: Array<string | RiskItem>                  // （现存）
  nextQuestions: Array<string | NextQuestion>      // （现存）
  conclusion?: string                              // （现存，Phase 5H）

  // Phase 5J 新增
  evidenceSummary?: string                         // 证据总览文本（如"以下结论基于近 30 天 REVENUE 表数据"）
}
```

`evidenceSummary` 是一条可选顶部文本，出现在证据区域上方，用于描述本次分析的整体数据源、时间范围、数据完整性。与 `risks` 不同——risks 讲风险，evidenceSummary 讲来源背景。

### 3.3 ProcessInsight 映射链扩展

```typescript
// frontend/src/types/aiAsk.ts — ProcessInsight 扩展

export interface ProcessInsight {
  understoodMetrics: string[]                      // （现存）
  understoodDimensions: string[]                   // （现存）
  understoodTimeRange?: string                     // （现存）
  understoodFilters: string[]                      // （现存）
  semanticGaps: Array<{ field, candidates, severity }>  // （现存）
  analysisStrategy?: string                        // （现存）
  contextChain?: string[]                          // （现存，Phase 5H）

  // Phase 5J 新增
  mappingChain?: Array<{                           // intent → SQL → result → conclusion 映射
    step: 'intent' | 'sql_plan' | 'result' | 'conclusion'
    label: string                                  // 步骤标签（如"识别意图：销售额×区域"）
    detail?: string                                // 详细说明
    fields?: string[]                              // 涉及的字段
  }>
}
```

`mappingChain` 是一个有序数组，展示从意图识别 → SQL 计划 → 查询结果 → 结论的完整链路。每条 evidence 可通过 `relatedIntent` 关联到 `mappingChain` 中的具体步骤。

### 3.4 类型文件变更概要

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `frontend/src/types/aiAsk.ts` | 修改 | EvidenceItem 扩展 6 个 optional 字段；AiInsightNarrative 新增 evidenceSummary；ProcessInsight 新增 mappingChain |

无其他类型文件变更。

---

## 4. UI/交互设计

### 4.1 设计原则

- **默认以结论为主**：证据链不压过答案。AiNarrative 默认与 Phase 5H 几乎完全一致。
- **渐进式揭露**：每条证据默认折叠，用户点击"查看证据"展开详情。
- **轻量链路**：ProcessPanel 不做复杂图谱，使用有序列表展示映射链。
- **密度与克制**：参考 MetricForge 的"密集、安静、企业级"风格，避免装饰性元素。

### 4.2 AiNarrative 证据展开交互

```
Phase 5G/5H AiNarrative（当前）：
┌──────────────────────────────────────┐
│ 💡 AI 解读                            │
│                                        │
│ 结论：华东区域应作为重点深耕市场...    │
│                                        │
│ 摘要：近 30 天各区域销售额...          │
│                                        │
│ 主要发现：                             │
│ • 华东区域销售额 ¥12.3M...             │ ← keyFinding
│ • 西北+东北合计仅 14%...               │
│                                        │
│ 证据：                                 │
│ • 华东领先 — ¥12.3M · 占 29.4%       │ ← evidence（平铺）
│   → 来源字段：region, total_revenue   │
│                                        │
│ ⚠ 数据说明：...                        │
│ 推荐追问：...                           │
└──────────────────────────────────────┘

Phase 5J AiNarrative（增量变化）：
┌──────────────────────────────────────┐
│ 💡 AI 解读                            │
│                                        │
│ 结论：...                               │ ← 不变
│ 摘要：...                               │ ← 不变
│ 主要发现：...                           │ ← 不变
│                                        │
│ 证据：                                 │
│ 📎 华东领先 — ¥12.3M (29.4%)          │ ← evidence（默认行）
│   [查看证据 ▼]  ← NEW                 │ ← 默认折叠，点击展开
│                                        │
│   展开后：                             │
│   ┌────────────────────────────────┐  │
│   │ 📎 证据详情                      │  │
│   │                                  │  │
│   │ 结论来源                         │  │
│   │ 字段：region, total_revenue      │  │ ← sourceFields
│   │ 数据源：REVENUE 表               │  │
│   │ 时间范围：近 30 天               │  │
│   │                                  │  │
│   │ 计算说明                         │  │
│   │ SUM(r.amount) GROUP BY region    │  │ ← calculation
│   │ WHERE r.transaction_date         │  │
│   │   >= SYSDATE - 30                │  │
│   │                                  │  │
│   │ 可信度：✅ 高                     │  │ ← confidence
│   │ 原因：数据覆盖 30 天，字段匹配    │  │ ← confidenceReason
│   │ 率 100%，无空值                   │  │
│   │                                  │  │
│   │ 关联查询                        │  │
│   │ SELECT region,                   │  │
│   │   SUM(amount) AS total_revenue   │  │ ← SQL 全段
│   │ FROM REVENUE                     │  │
│   │ WHERE transaction_date >= ...    │  │
│   └────────────────────────────────┘  │
│                                        │
│ ⚠ 数据说明：...                         │ ← 不变
│ 推荐追问：...                            │ ← 不变
└──────────────────────────────────────┘
```

**交互规则**：

- 每条 evidence 项右侧增加"查看证据"文字链接（灰色，12px）
- 点击只展开当前 evidence 项，不展开其他项
- 展开面板内三个小节：结论来源 / 计算说明 / 可信度（带折叠/展开微状态）
- SQL 展示区 4-8 行高，超出滚动
- 展开状态不影响其他 evidence 行（独立展开）

### 4.3 ProcessPanel 映射链升级

```
Phase 5H ProcessPanel（当前）：
┌──────────────────────────────────────┐
│ 🔍 AI 理解过程                        │
│                                        │
│ ✅ AI 确定理解到：                      │
│   指标：销售额、订单数                  │
│   维度：区域                            │
│                                        │
│ 📋 分析策略：按维度分组汇总...          │
│ 🔗 对话链路：第1轮 → 第2轮             │
└──────────────────────────────────────┘

Phase 5J ProcessPanel（增量）：
┌──────────────────────────────────────┐
│ 🔍 AI 理解过程                        │
│                                        │
│ ✅ AI 确定理解到：                      │ ← 保留
│   指标：销售额、订单数                  │
│   维度：区域                            │
│   ⚠ AI 不确定：...                     │
│                                        │
│ 📋 分析链路（NEW）：                   │
│ ┌────────────────────────────────┐    │
│ │ ❶ 识别意图                      │    │
│ │   销售额 × 区域，近30天         │    │
│ │   ↓                             │    │
│ │ ❷ 生成查询计划                  │    │
│ │   FROM REVENUE GROUP BY region  │    │
│ │   ↓                             │    │
│ │ ❸ 查询结果                      │    │
│ │   共 6 行数据                    │    │
│ │   ↓                             │    │
│ │ ❹ 生成结论                      │    │
│ │   华东领先 ¥12.3M (29.4%)       │    │
│ └────────────────────────────────┘    │
│                                        │
│ 🔗 对话链路：...                       │ ← 保留
└──────────────────────────────────────┘
```

**交互规则**：

- 映射链默认折叠在 ProcessPanel 内部
- "分析链路"区域在 expanded 状态下可见
- 每个步骤展示 label + detail（两行以内）。步骤 ❸ 仅展示行数概览（如"共 6 行数据"），不展示 Query Results 的具体行内容。
- 步骤 ❹ 直接展示 AiNarrative 的 conclusion 文本

### 4.4 SQL 片段关联标注

当 evidence 展开时，SQL 片段按"蓝/绿/紫"分段标注：

```
计算部分：SUM(r.amount)          ← 蓝色（聚合）
过滤部分：WHERE region='华东'     ← 紫色（过滤）
分组部分：GROUP BY region         ← 绿色（分组）
```

通过 `calculation` 字段自动分段（关键词匹配 `SELECT...FROM...WHERE...GROUP BY...ORDER BY`）。

### 4.5 可见 UI 设计参考

- 默认展示：与 Phase 5H AiNarrative 保持一致，不因新增字段改变卡片结构和布局
- 颜色：证据详情面板使用 `#fafafa` 背景 + `#f0f0f0` 边框（与 ProcessPanel 一致）
- 字体：12-13px，灰色辅助文字 #999，正文 #444，标签 #666
- SQL 代码：12px 等宽字体（`'Consolas', 'Courier New', monospace`），`#1d1d1d` 色
- 置信度显示：✅ high（绿色）、⚠️ medium（橙色）、❌ low（红色）
- 不引入新 Ant Design 组件（复用 Collapse、Popover、Typography）
- 不做复杂数据图谱、不做 SVG 连线图

---

## 5. Mock 与 Benchmark

### 5.1 MockAdapter 场景数据扩展

扩展现有场景（revenue-by-region、trend、topN 等）和 followUpScenarios 的 evidence 字段：

**revenue-by-region 场景证据扩展示例**：

```typescript
// 现有
evidence: [
  { claim: '华东领先', fields: ['region', 'total_revenue'], sqlSnippet: 'SUM(r.amount) GROUP BY region' },
]

// Phase 5J 扩展
evidence: [
  {
    claim: '华东领先',
    fields: ['region', 'total_revenue'],
    sqlSnippet: 'SUM(r.amount) GROUP BY region',
    value: '¥12.3M',
    significance: '占总收入 29.4%',
    // 新增字段
    sourceFields: ['r.region', 'r.amount'],
    calculation: 'SUM(r.amount) WHERE region=\'华东\' / SUM(r.amount) OVER()',
    confidence: 'high',
    confidenceReason: '数据覆盖 30 天，字段匹配率 100%，无缺失值',
    relatedIntent: { metrics: ['销售额'], dimensions: ['区域'], timeRange: '近 30 天' },
    displayValue: '¥12.3M (29.4%)',
  },
]
```

**followUpScenarios 同样扩展**——确保多轮追问下的证据也具备完整溯源信息。置信度可随追问场景动态调整（如 followUp.drill_down 的证据置信度可为 `'medium'` 表示基于上一轮结果推理）。

其他场景（trend、topN、comparison、default）按相同模式扩展。

### 5.2 Benchmark 新增 evidence 质量检查

基于 Phase 5I 的 benchmark runner 框架，新增一个 benchmark 模块：

```
frontend/scripts/benchmarks/evidenceQuality.bench.ts
```

**检查项**：

| 检查项 | 说明 | 标准 |
|--------|------|------|
| evidence completeness | 每条 evidence 是否包含 claim + fields + sqlSnippet + calculation + confidence | 评分制（pass/fail per evidence） |
| confidence reason present | 非 high 置信度的是否有 confidenceReason 说明 | 强制规则 |
| sql snippet presence | 是否有非空的 SQL 片段 | 完整场景下必须 |
| sourceFields alignment | sourceFields 必须存在且非空；每项必须是 string；至少一个 sourceFields 的末级字段名（last segment after `.`）与 fields 中某项有简单包含/相等关系 | 结构检查（非语义） |
| backward compatibility | 旧格式 evidence（无新增字段）是否正常通过 | 不报错即通过 |

**Benchmark 报告格式**（复用 Phase 5I 的 ModuleReport）：

```typescript
interface EvidenceBenchReport {
  module: 'evidenceQuality'
  timestamp: string
  total: number            // 总 evidence 条数
  passed: number           // 完整证据链条数
  completenessRate: string // "passed/total" → "80%"
  coverage: {
    fieldCompleteness: number   // 字段完整率
    confidenceCoverage: number  // 置信度覆盖百分比
    snippetCoverage: number     // SQL 片段存在率
  }
  failures: Array<{
    claim: string
    scenario: string
    issues: string[]           // 缺失字段列表
  }>
}
```

### 5.3 Benchmark 不接入 CI

与 Phase 5I 一致——benchmark 是本地开发期手动工具，使用 `npx tsx` 执行，输出 JSON 报告。不创建 GitHub Actions workflow。

---

## 6. 文件变更总览

### 6.1 新增文件

| 文件路径 | 说明 |
|---------|------|
| `frontend/scripts/benchmarks/evidenceQuality.bench.ts` | evidence 质量 benchmark |

### 6.2 修改文件

| 文件路径 | 变更 |
|---------|------|
| `frontend/src/types/aiAsk.ts` | EvidenceItem 扩展 6 个 optional 字段；AiInsightNarrative 新增 evidenceSummary；ProcessInsight 新增 mappingChain |
| `frontend/src/api/aiAsk/scenarios/*.ts` | 所有场景（revenueByRegion、trend、topN、comparison、default）的 evidence 字段扩展 |
| `frontend/src/api/aiAsk/scenarios/followUpScenarios.ts` | 多轮场景 evidence 字段扩展 |
| `frontend/src/components/AiNarrative.tsx` | 增加"查看证据"渐进式展开 UI |
| `frontend/src/components/ProcessPanel.tsx` | 增加 mappingChain 映射链路展示 |
| `frontend/scripts/runQualityBenchmarks.ts` | 注册 evidenceQuality.bench 模块 |

### 6.3 无变更文件

| 文件路径 | 原因 |
|---------|------|
| `frontend/src/api/aiAsk/adapter.ts` | AiAskAdapter 协议不变，analyze() 返回协议不变 |
| `frontend/src/api/aiAsk/mockAdapter.ts` | analyze() 逻辑不变，仅场景数据变更。getChartData 不变 |
| `frontend/src/api/aiAsk/followUpDetector.ts` | 追问类型推断逻辑不变 |
| `frontend/src/api/aiAsk/contextPolicy.ts` | 不涉及证据处理 |
| `frontend/src/api/aiAsk/inputGuard.ts` | 不涉及证据处理 |
| `frontend/src/pages/AskWorkbenchPage.tsx` | 证据展开是 AiNarrative 内部行为，page 层无变更 |
| `frontend/src/stores/aiAskStore.ts` | 不涉及证据存储变更 |
| 后端 API / DB / Migration | 无变更 |

---

## 7. 测试策略

### 7.1 单元测试（Vitest + RTL）

| 测试文件 | 覆盖范围 |
|---------|---------|
| `AiNarrative.test.tsx` | 渲染旧格式 evidence（无 Phase 5J 字段）；渲染新格式 evidence 并验证展开/折叠；渲染空 evidence 数组；渲染低置信度 evidence；evidenceSummary 展示 |
| `ProcessPanel.test.tsx` | 渲染 mappingChain 的 4 步链路；映射链展开/折叠；无 mappingChain 时的向后兼容 |

### 7.2 组件测试重点用例

- 旧数据向后兼容 — 5H 格式的 evidence（无 confidence/calculation）渲染且不报错
- 空 evidence — `narrative.evidence` 为空数组或 undefined 时组件不崩溃
- 低置信度 evidence — `confidence: 'low'` 时展开面板显示红色 ❌ 标记和 reason
- 展开/折叠 — 点击"查看证据"切换单个 evidence 展开状态，不影响其他 evidence
- mappingChain 空值容错 — `mappingChain` 不存在或为空数组时 ProcessPanel 不崩溃

### 7.3 Benchmark 测试

| 文件 | 覆盖范围 | 用例数 |
|------|---------|--------|
| `evidenceQuality.bench.ts` | evidence completeness / confidence reason / sql snippet presence / backward compat | ~10 |

### 7.4 验收命令

```bash
npm test                        # Vitest 单元测试 + 组件测试
npx tsc --noEmit                # 类型检查
npm run build                   # 生产构建
npx tsx scripts/runQualityBenchmarks.ts  # Benchmark runner
# python pytest 若未触及后端仍作为最终验证
```

### 7.5 不测试

- Playwright/Cypress E2E
- 真实 LLM 调用
- Monaco DOM 细节

---

## 8. 风险与控制

| 风险 | 说明 | 控制方式 |
|------|------|---------|
| **Mock evidence 过于理想化** | MockAdapter 总是能产生完整、精确的 evidence 字段。真实 LLM 接入后可能无法保证同等质量 | 所有 Phase 5J evidence 字段标记为 `optional`。Mock evidence 可在场景数据中标注 `_simulated: true` 元标记（但不引入新类型） |
| **UI 信息过载** | "查看证据"展开后展示 SQL、计算说明、置信度原因，可能信息量过大 | 默认完全折叠。展开面板内三个子区域"结论来源/计算说明/可信度"以 `<Collapse>` 方式折叠，用户自主选择展开深度 |
| **Evidence 类型膨胀** | EvidenceItem 不断增加 optional 字段，类型变得庞大难以维护 | Phase 5J 仅扩展 6 个字段。所有字段均为 `optional` 不破坏现有接口。后续扩展应在独立的 spec 中规划 |
| **与未来真实 LLM adapter 的协议差距** | 真实 LLM 可能无法输出 confidence 或 calculation 字段 | 协议层全部 optional，无 LLM adapter 也能编译通过。LLM adapter 实现时可从零或低填充率开始 |
| **ProcessPanel mappingChain 在 mock 下过于理想化** | 真实 AI pipeline 的意图→SQL→结果→结论映射不是线性 1:1 | mappingChain 是可选字段。mock 场景下构造演示级数据，真实 adapter 可跳过或提供简化版本 |
| **UI 渲染性能** | 多条 evidence 同时展开时页面渲染负担 | evidence 展开是本地 React 状态切换，无网络请求。限制同时展开上限理论上不需要（按 React 性能标准，10 条以内无压力） |
| **confidence 标签引发用户过度信任** | 标 high 的结论用户不再验证，即使 AI 可能出错 | confidence 标签旁显示"AI 判断"标记（灰色小字）。未来可在低置信度时引导用户到 SQL Workbench 验证 |

---

## 9. 自检清单

- [x] 核心是 AI 问数结论可信度与证据链增强，不是行级数据血缘
- [x] 不是报告 Agent / 会话持久化 / 后端改造
- [x] 所有新增字段均为 optional，向后兼容 Phase 5H evidence 数据
- [x] 不新增 adapter.analyze() 返回协议（AiAskResponse 无新增字段，仅子结构扩展）
- [x] 不修改 aiAskStore
- [x] 不引入新后端 API / DB / migration
- [x] 不接入真实 LLM（全部 MockAdapter 模拟）
- [x] 不引入 Playwright / Cypress
- [x] 不测试 Monaco DOM
- [x] 业务代码不得硬编码 `dwhrpt`；mock 数据源使用 `{ id: 2, name: 'dwhrpt' }`
- [x] Benchmark 是独立脚本（npx tsx），不是 CI gate
- [x] ModuleReport 格式复用 Phase 5I 的 QualityBenchmarkReport
- [x] UI 默认以结论为主，证据链不压过答案
- [x] evidence 展开是渐进式揭露，不一次性展开全部
- [x] ProcessPanel 映射链默认折叠，不使用复杂图谱
- [x] 风险与控制已文档化
- [x] 无 TBD/TODO
- [x] 无 implementation plan 内容
- [x] 无代码实现
