# Phase 5M: Metadata-Grounded Real LLM Ask & SQL Trust Gate

## 概述

Phase 5L 实现了真实 LLM 问数 MVP，实测暴露出三个严重可信度问题：

1. **LLM 完全依赖模型知识猜测字段**，没有接入已采集的元数据，生成了不存在的字段（`investment_amount`、`region`）和不存在的表引用。
2. **无 SQL 校验门**：SQL 即使引用了不存在字段、缺 schema 限定、包含 DDL，依然被当作合法结果传递到前端展示。
3. **无真实查询结果的 narrative 编造事实**：SQL 未执行、无数据的情况下，AI 解读生成"华东 35%""8 个区域"等虚假业务结论。

Phase 5M 的目标是从"模型凭记忆猜数"变为"基于已采集元数据生成可信 SQL"，并在 SQL 校验失败或未执行时禁止事实型结论输出。

---

## P0 — Metadata Grounding（元数据接地）

### 问题定位

当前 `prompt_builder.py` 向 LLM 发送的 prompt 仅包含：

```
数据源：{datasource_name}
相关表：{tables_str}
用户问题：{question}
```

LLM 完全无法感知：
- 选中表有哪些真实字段
- 字段类型、注释、是否分区字段
- 表是否有 schema 限定名
- 该数仓的命名规则（DWS_/DIM_/ADS_ 含义）

这是所有幻觉的根源。

### 设计

#### 3.1 元数据查询服务（新增 `MetadataResolver`）

新建文件 `app/services/ai_ask/metadata_resolver.py`，职责：

- **输入**：`datasource_id` + `selected_tables`（用户选中的表列表）
- **查询来源**：复用现有 `TableMetadata` / `ColumnMetadata` / `FieldSemantic` 模型，不新增 DB 表
- **输出结构**：`ResolvedTableMetadata`，每个表包含：
  - `schema_name` / `table_name` / `table_comment`
  - `columns`：`column_name` / `column_type` / `comment` / `is_primary_key` / `is_partition`（由业务规则推导，见 Domain Rules 节）
  - `field_semantics`：从 `FieldSemantic` 表获取的业务别名和含义
  - `table_rule_hints`：基于表名前缀的业务规则提示（DWS_ = 汇总数据层, DIM_ = 维度表, ADS_ = 应用数据层）

**查询策略**：

```python
def resolve(datasource_id: int, table_names: list[str]) -> list[ResolvedTableMetadata]:
    # 对每个 table_name，尝试 schema.table_name 或 exact match
    tables = []
    for name in table_names:
        # 处理 "SCHEMA.TABLE" 格式 → schema_name=SCHEMA, table_name=TABLE
        # 处理 "TABLE" 格式 → schema_name=ANY, table_name=TABLE
        table_meta = db.query(TableMetadata).filter_by(
            datasource_id=datasource_id,
            table_name=table_part
        ).first()
        if table_meta:
            tables.append(table_meta)
    # 批量查询 columns 和 semantics
    ...
```

- 如果用户问题中包含显式的 schema 限定表名（如 `DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M`），即使不在 `selectedTables` 中，也应自动解析。
  - 设计：后端的 `AnalyzeRequest` schema 中已有 `selected_tables`，前端当前将选定表传给后端。Phase 5M 新增规则：**如果后端发现 `selected_tables` 为空但问题中出现了模式匹配的 schema.table 语法，应从问题中提取表名并解析**。
  - MVP 实现方式：先用简单规则 `r'[A-Z][A-Z0-9_]+\.[A-Z][A-Z0-9_]+'` 正则提取，后续可升级为更精准的命名解析。

**找不到表元数据时的行为**（详细响应协议见第 4 节）：

- **不调用 LLM**：直接返回 `ok:false` 错误响应
- `errorCode = METADATA_NOT_FOUND`
- `details` 包含 `datasourceId`、`tableName`、`suggestion`
- 不走 LLM 猜测流程，不生成 chartSuggestions / narrative / fake semantic findings

#### 3.2 PromptBuilder 增强

修改 `prompt_builder.py` 的 `AiAskPromptBuilder.build()` 方法：

**新参数**：增加 `metadata_context: list[ResolvedTableMetadata]`

当 `metadata_context` 为空时，**不调用 PromptBuilder**（走 3.1 节的提前返回路径）。

**注入到 prompt 中的内容**（以 DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M 为例）：

```
## 可用数据表结构

### DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M（汇总数据层）
- `pt` VARCHAR — 分区字段，格式 yyyymmdd（必填过滤条件）
- `amt` NUMBER(18,2) — 投放金额
- `cust_type` VARCHAR(20) — 客户类型（小微/中型/大型）
- `region_code` VARCHAR(10) — 区域编码
- `region_name` VARCHAR(50) — 区域名称 ← 注意：字段名是 region_name 不是 region
- `create_dt` DATE — 创建时间
```

**Prompt 严格约束（新增到 system prompt）**：

```
## SQL 生成约束（必须遵守）
1. 只能使用以上列出的表结构和字段。禁止创建以上结构中不存在的字段。
2. 表名必须 schema 限定：DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M，不可以只写 DWS_RPT_ZCPZ_CYFL_TF_M。
3. 如果用户指定 partition(p20260630)，结合表结构判断：如果目标表有 pt 字段，
   则应使用 pt='20260630' 过滤，不要使用不适配的 partition 语法。
4. 如果用户问题中的业务概念无法对应到任何现有字段，请在 semanticGaps 中报告，
   不要凭空生成不存在的字段名。
5. 只允许生成 SELECT 查询。禁止 DELETE / UPDATE / INSERT / DROP / ALTER / CREATE / TRUNCATE。
```

**元数据缺失时的行为**：

`metadata_context` 为空时提前返回错误（不走 PromptBuilder/LLM），不存在"prompt 中加入警告"的分支。

#### 3.3 后端 LLM Service 接入 Metadata

修改 `app/services/ai_ask/llm_service.py` 的 `analyze()` 方法：

**流程改动**：

```
1. 构建 request dict（现有）
2. MetadataResolver.resolve(datasource_id, selected_tables)  ← 新增
3. 如果 resolver 发现 selected_tables 中有表无元数据：
   - 检查问题中是否出现 schema.table 语法的表名（正则提取）
   - 如果提取的表名也无元数据
   - 直接返回 METADATA_NOT_FOUND error（不调 LLM，不走 PromptBuilder）
4. PromptBuilder.build(request, metadata_context=resolved)  ← 修改
5. 调用 LLM（现有）
6. Normalizer.normalize()（现有）
7. Datasource override（现有, Phase 5L）
8. 后端 sanitize narrative（修改，见 Narrative Trust Rule 节）
9. Metadata-based SQL Validator（新增, 见下节）
10. 如果 validator 失败 → 返回 INVALID_RESPONSE + details.sqlValidation
11. 返回 success + set narrativeLevel = "sql_pending"
```

#### 3.4 不新增 DB / 不新增 migration

- 复用 `TableMetadata`、`ColumnMetadata`、`FieldSemantic` 表
- `FieldSemantic` 如果需要业务别名映射（如 "投放金额" → `amt`），可以直接用于 prompt 中的语义说明
- 不引入 RAG、向量数据库

---

## P0 — Metadata-Based SQL Validator

### 问题定位

当前 `validator.py` 只做结构校验：

- `sqlPlan.fields` 必须是 string 数组 ✓
- `narrative.evidence` 必须是非空数组 with claim/fields ✓
- **不做**字段是否存在于目标表 ✓（缺失）
- **不做** schema 限定 ✓（缺失）
- **不做** SQL 操作类型检查 ✓（缺失）

### 设计

#### 4.1 后端 SQL Metadata Validator（新增文件）

新建 `app/services/ai_ask/sql_validator.py`，职责：在 LLM 返回 SQL 后、返回前端前，执行 metadata-based 校验。

**输入**：
- `sql_plan.sql`：LLM 生成的 SQL 文本
- `sql_plan.fields`：LLM 声称引用的字段列表
- `sql_plan.tables`：LLM 声称涉及的表列表
- `resolved_metadata`：`MetadataResolver` 返回的真实表结构和字段

**校验规则**（全部为 error，无 warning）：

| # | 规则 | 检查内容 | 错误码 |
|---|------|----------|--------|
| 1 | 字段存在性 | 从 `sql_plan.fields` 和 SQL 文本中解析出的每个字段名必须存在于至少一个目标表的 column_name 中。`region`、`investment_amount` 等不存在字段必须拦截。 | `FIELD_NOT_FOUND` |
| 2 | Schema 限定 | 涉及真实数仓表（非子查询别名/CTE）时，表名必须包含 schema 前缀。例如 `FROM DWS_RPT_ZCPZ_CYFL_TF_M` 缺 schema 时报错。例外：纯 SQL 语法结构（子查询别名、CTE 名）不检查。 | `TABLE_SCHEMA_MISSING` |
| 3 | SQL 操作类型 | 只允许 SELECT / WITH（CTE）。regex: `^\s*(SELECT|WITH\s)`。包含 DELETE/UPDATE/INSERT/DROP/ALTER/CREATE/TRUNCATE 时拦截。 | `DDL_DML_NOT_ALLOWED` |
| 4 | 字段引用不超出表范围 | 如果 LLM 的 `sql_plan.sql` 中引用了 `sql_plan.tables` 之外的表（通过 sqlglot 或正则提取表引用），记为 error（不允许引用未选表）。 | `UNKNOWN_TABLE_REFERENCE` |
| 5 | 分区规则（dwhrpt domain） | 如果目标表是快照表（由 DomainRules 推导），SQL 中必须包含 pt 字段过滤。如果没有 pt 过滤条件，记为 error。 | `PARTITION_FILTER_MISSING` |
| 6 | 字段名大小写 | 如果元数据中字段是大写，SQL 中引用也应匹配。不匹配时记为 error。 | `CASE_MISMATCH` |

> **与 v1 差异**：规则 2/4/5/6 从 warning 统一升级为 error。任何一条规则失败 → validator passed=false，不返回正常响应。

**校验通过条件**：rule 1–6 全部通过，errors 为空。

**校验失败返回结构（通过 ok:false 返回）**：

```json
{
  "ok": false,
  "errorCode": "INVALID_RESPONSE",
  "errorMessage": "SQL 校验未通过，请检查字段和表结构",
  "details": {
    "sqlValidation": {
      "errors": [
        { "rule": "FIELD_NOT_FOUND", "field": "investment_amount", "message": "字段 investment_amount 不在目标表 DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M 中" },
        { "rule": "TABLE_SCHEMA_MISSING", "table": "DWS_RPT_ZCPZ_CYFL_TF_M", "message": "表 DWS_RPT_ZCPZ_CYFL_TF_M 缺少 schema 限定，应为 DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M" }
      ],
      "warnings": [],
      "sql": "SELECT region, SUM(investment_amount) FROM DWS_RPT_ZCPZ_CYFL_TF_M WHERE pt='20260630' GROUP BY region"
    }
  }
}
```

#### 4.2 校验失败时的响应链路（统一异常响应协议）

SQL validator failed 时 **不返回普通 AiAskResponse**：

```
LLM 返回 JSON → Normalizer → Metadata SQL Validator
  ├── passed=true → 设置 narrativeLevel = "sql_pending"，继续返回 success
  └── passed=false → 返回 AiAskAnalyzeErrorResponse
       ├── ok: false
       ├── errorCode: "INVALID_RESPONSE"
       ├── errorMessage: "SQL 校验未通过，请检查字段和表结构"
       └── details: { sqlValidation: { errors: [...], warnings: [], sql: "..." } }
```

**注意**：
- `narrativeLevel` 不包含 `sql_invalid` 值——校验失败时根本不走 narrative 流程
- 返回 `ok:false`，前端走 Error Alert + `SqlValidationAlert` 展示路径
- 后端不会为校验失败的 SQL 生成 narrative / chartSuggestions

**前端收到 INVALID_RESPONSE + sqlValidation 后**：
- 显示 `SqlValidationAlert` 组件，展示具体的 validation errors
- **不展示错误 SQL**
- **不展示图表建议或 AI 解读**
- 不调用 `AiNarrative` 组件
- 如果 `useRealLlm` 为 true，显示"切回模拟模式再试"按钮

#### 4.3 SQL 解析策略

**推荐方案：引入 sqlglot 做保守 SQL 解析**

在 Phase 5M 中引入 `sqlglot` 作为正式依赖。理由：
- LLM 生成的 SQL 语法高度不可靠，`sqlglot` 的容错解析能力可以在多数情况下提取表名和字段引用
- 相比正则提取，sqlglot 可以正确识别子查询别名、CTE、JOIN 条件中的表引用
- 测试中容易 mock

**解析能力要求**（sqlglot 或等价方案）：

```python
def extract_tables(sql: str) -> list[str]:
    """返回 SQL 中引用的真实表名（排除子查询别名和 CTE 名）"""
    ...

def extract_columns(sql: str) -> list[str]:
    """返回 SELECT / WHERE / GROUP BY / ORDER BY 中引用的字段名"""
    ...

def extract_dialect(sql: str) -> str:
    """返回 sqlglot 解析出的 dialect，与 datasource dialect 对比"""
    ...

def has_ddl(sql: str) -> bool:
    """检查是否包含 DDL/DML 操作"""
    ...
```

**备选方案（不引入 sqlglot）**：

如果最终决定不引入 sqlglot，则必须 **fail closed**：
- SQL 只要无法被提取出表名或字段名，即为不通过
- 使用正则 `SELECT\s+(.+?)\s+FROM` + `(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_.]*)` 做保守提取
- 提取出的表名如果确实存在于元数据中但缺少 schema 前缀，记为 `TABLE_SCHEMA_MISSING`
- 如果正则提取结果为空（复杂 SQL），**不通过**（不信任无法解析的 SQL）

**依赖：** 使用推荐方案时在 `pyproject.toml` 或 `requirements.txt` 中新增 `sqlglot>=25.0.0`

**测试覆盖**（见测试策略节）：
- 简单 SELECT
- 含 CTE 的 WITH 查询
- 含 JOIN 的多表查询
- 含子查询的嵌套 SELECT
- DDL/DML 检测
- 缺 schema 的表引用
- 含不存在字段的 SQL

---

## P0 — Narrative Trust Rule

### 问题定位

当前 `AiNarrative.tsx` 无条件渲染：

- `narrative.summary` → 绿色背景框
- `narrative.keyFindings` → "主要发现"列表
- `narrative.evidence` → "证据"列表
- `narrative.conclusion` → 蓝色结论框
- `narrative.risks` → 黄色风险提示

**无论 SQL 是否执行、是否有真实结果**，前端都展示同样结构。真实 LLM 模式下返回了虚构的 `rowCount: 5` 等数据，导致 narrative 中的具体数字被展示为"真相"。

### 设计

#### 5.1 NarrativeLevel 定义

在 `AiAskResponse` 中新增字段：

```typescript
type NarrativeLevel = 'sql_pending' | 'executed'
```

| Level | 含义 | 何时赋值 |
|-------|------|---------|
| `sql_pending` | SQL 已生成但未执行 | 当前真实 LLM MVP 所有成功响应 |
| `executed` | SQL 已执行并有结果 | 未来阶段，当前 MVP 永不进入此状态 |

> **与 v1 差异**：移除了 `metadata_pending` 和 `sql_invalid`。元数据缺失走 `ok:false` 异常协议，SQL 校验失败走 `ok:false` 异常协议。narrativeLevel 只存在于 `ok:true` 的成功响应中。

#### 5.2 后端必须 sanitize narrative（关键约束）

**后端在 `llm_service.py` 中，LLM 返回 JSON 并经过 Metadata Validator 通过后，必须执行以下 sanitize（对 `sql_pending` 状态）：**

```python
def _sanitize_narrative_for_sql_pending(narrative: dict) -> dict:
    """
    当 SQL 未执行时，清除所有事实型结论。
    只保留：分析口径说明、风险提示、下一步建议。
    """
    return {
        "summary": _build_safe_summary(narrative),  # 见下方说明
        "keyFindings": [],                     # 清空——防止任何事实结论
        "evidence": [],                        # 清空——防止"华东 35%"等虚假证据
        "risks": narrative.get("risks", []),   # 保留风险提示（不包含事实数据）
        "nextQuestions": narrative.get("nextQuestions", []),  # 保留后续追问（可以是业务相关）
        # conclusion 不返回——不能有事实型结论
    }

def _build_safe_summary(narrative: dict) -> str:
    """
    从 LLM 原始 narrative 中提取"分析口径"部分，剥离具体数字结论。
    示例输出：
    "分析口径：基于 DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M 表，按 region_code 分组汇总
     amt（投放金额），筛选 cust_type='小微' 的记录。
     ⚠️ SQL 已生成但尚未执行，建议在 SQL Workbench 中执行验证后再生成图表和分析结论。
     下一步建议：在 SQL Workbench 中执行此 SQL，或调整数据范围和问题后重新提问。"
    """
```

**禁止规则（后端强制）**：
- `keyFindings` 必须为空数组 `[]`
- `evidence` 必须为空数组 `[]`
- `narrative` 不包含 `conclusion` 字段
- `summary` **不能包含**：百分比、排名数字、金额数值、区域 TopN 等事实型数据
- `summary` **可以包含**：分析口径说明、涉及的表和字段、SQL 语法说明、风险提示、下一步建议

> **与 v1 差异**：v1 写"后端不做 narrative 内容的欺骗性检查，控制点在前端"。这是错误的。后端必须执行 sanitize，前端做二次保护。两层保护防止前端出错时 LLM 编造的数据被展示。

#### 5.3 前端二次保护

前端 `AiNarrative.tsx` 增加保护逻辑：

```typescript
if (narrativeLevel === 'sql_pending') {
  // 二次保护：即使后端 sanitize 漏了，前端也过滤
  const safeNarrative = {
    summary: narrative.summary,  // 展示"分析口径说明"
    keyFindings: [],             // 不展示，无论后端传什么
    evidence: [],                // 不展示，无论后端传什么
    risks: narrative.risks,
    nextQuestions: narrative.nextQuestions,
  }
  // 渲染 safeNarrative
}
```

**渲染规则**：

| narrativeLevel | summary | keyFindings | evidence | conclusion | chartSuggestions | 数据表 |
|----------------|---------|-------------|----------|------------|-----------------|--------|
| `sql_pending` | ✅ 显示分析口径说明（sanitized） | ❌ 隐藏 | ❌ 隐藏 | ❌ 隐藏 | ✅ 显示但标注"⏳ 待 SQL 执行后渲染" | ✅ 显示（含 schema 限定 SQL） |
| `executed` | ✅ 正常展示 | ✅ 正常展示 | ✅ 正常展示 | ✅ 正常展示 | ✅ 正常展示 | ✅ 正常展示 |

**`sql_pending` 状态下的 summary 示例**：

> 分析口径：基于 DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M 表，按 region_code 分组汇总 amt（投放金额），筛选 cust_type='小微' 的记录。
>
> ⚠️ SQL 已生成但尚未执行，以下 SQL 建议在 SQL Workbench 中执行验证后再生成图表和分析结论。
>
> 下一步建议：在 SQL Workbench 中执行此 SQL，或调整数据范围和问题后重新提问。

#### 5.4 后端返回结构改动

在成功响应（`ok:true`）的 `data` 中新增字段：

```json
{
  ...existingFields,
  "narrativeLevel": "sql_pending",
  "narrative": {
    "summary": "分析口径：... ⚠️ SQL 已生成但尚未执行 ...",
    "keyFindings": [],
    "evidence": [],
    "risks": [...],
    "nextQuestions": [...]
  }
}
```

---

## P0 — dwhrpt Domain Rules

### 问题

当前 PromptBuilder 没有 domain knowledge，LLM 不知道 dwhrpt 数仓的命名规则和分区约定。

### 设计

#### 6.1 Domain Rules 定义

在 `app/services/ai_ask/domain_rules.py` 中定义可扩展的规则结构：

```python
DOMAIN_RULES = {
    "naming_conventions": {
        "DWS_": {"layer": "汇总数据层", "description": "按主题汇总的宽表，通常按日分区"},
        "DIM_": {"layer": "维度表", "description": "慢变更维度，通常全量快照"},
        "ADS_": {"layer": "应用数据层", "description": "面向应用的轻度汇总/数据集市"},
    },
    "partition": {
        "default_field": "pt",
        "type": "varchar",
        "format": "yyyymmdd",
        "description": "用户说 partition(p20260630) 时应转换为 pt='20260630' 过滤条件",
    },
    "strict_schema": True,  # 所有真实表必须 schema 限定
}
```

#### 6.2 注入 PromptBuilder

在 PromptBuilder 的 system prompt 中追加：

```
## 数仓规则（dwhrpt）
- 表名前缀约定：
  - DWS_ = 汇总数据层（按主题汇总的宽表，通常按日分区）
  - DIM_ = 维度表（慢变更维度）
  - ADS_ = 应用数据层（面向应用的轻度汇总）
- 分区规则：
  - 分区字段为 pt，VARCHAR 类型，格式 yyyymmdd
  - 用户说 partition(p20260630) 时，转换为 pt='20260630' 过滤
  - 必须使用 pt 字段过滤对应分区
- 所有 SQL 中的真实数仓表必须 schema 限定（DWHRPT.表名）
- 只允许生成 SELECT 查询
```

#### 6.3 MetadataResolver 集成 Domain Rules

在解析结果中标记 `table_rule_hints`：

```python
def get_table_hints(table_name: str) -> list[str]:
    hints = []
    for prefix, rule in DOMAIN_RULES["naming_conventions"].items():
        if table_name.startswith(prefix):
            hints.append(f"{prefix}: {rule['description']}")
    return hints
```

---

## P1 — Data Scope UX 优化

### 7.1 布局方案 C 具体设计

参考 Quick BI 风格，对 `AskWorkbenchPage.tsx` 改造：

**布局结构**（上中左）：

```
┌──────────────────────────────────────────────────────┐
│  顶部数据集栏（数据源选择 + 已选表 tags + 搜索按钮）    │   ← 新增
├──────────┬───────────────────────────────────────────┤
│ 左侧面板  │                                            │
│ (可折叠)  │         主内容区域                          │
│          │                                            │
│ 🔍 搜索  │   ... MessageThread / Result                │
│ 表/字段   │                                            │
│          │                                            │
│ ☰ 表列表   │                                            │
│   schema  │                                            │
│    表A   │                                            │
│    表B   │                                            │
│          │                                            │
│ 会话列表  │                                            │
│  (紧凑)   │                                            │
├──────────┤                                            │
│ 底部输入  │                                            │
└──────────┴───────────────────────────────────────────┘
```

**顶部数据集栏**（新增 `DataScopeBar` 组件）：

- 位于顶部 AgentNav 下方或替换部分 AgentNav 区域
- 内容：
  - 数据源 Select（复用现有，宽度 200px）
  - 已选表 tags（可点击移除）
  - "选择数据范围" 按钮 → 折叠/展开左侧面板

**左侧面板**（原 Sider 重构）：

- 宽度 260px（比当前 220px 略宽，给搜索和字段展示留空间）
- 顶部：搜索输入框 `Input.Search`，placeholder="搜索表名或字段名"
- 搜索时调用现有 `GET /api/sql/schema/search?datasource_id=X&q=keyword`
- 搜索结果展示：按匹配类型分组
- 默认状态：展示表树（现有 Collapse 结构）
- 表树每项展开后可展示字段列表（loading on demand 或预加载）
- 会话列表放置在左侧面板**下方**（紧凑模式，高度受限，可内部滚动）
- 左侧面板可折叠：Sider collapsible，折叠 icon 在顶部数据集栏内

### 7.2 搜索范围要求（必须覆盖）

搜索 API `GET /api/sql/schema/search` 必须搜索以下 4 个维度：

| # | 搜索维度 | 查询条件 |
|---|---------|---------|
| 1 | `table_name` | `ilike '%keyword%'` |
| 2 | `table_comment` | `ilike '%keyword%'` |
| 3 | `column_name` | `ilike '%keyword%'` |
| 4 | `ColumnMetadata.comment` | `ilike '%keyword%'` |

**搜索结果必须包含匹配原因**：

```json
[
  { "match_type": "table_name",   "schema_name": "DWHRPT", "table_name": "DWS_RPT_ZCPZ_CYFL_TF_M", "table_comment": "...", "matched_on": "表名匹配" },
  { "match_type": "table_comment","schema_name": "DWHRPT", "table_name": "DWS_RPT_ZCPZ_CYFL_TF_M", "table_comment": "投放...", "matched_on": "表注释匹配：投放" },
  { "match_type": "column_name",  "schema_name": "DWHRPT", "table_name": "DWS_RPT_ZCPZ_CYFL_TF_M", "column_name": "amt", "matched_on": "字段名匹配：amt" },
  { "match_type": "column_comment","schema_name": "DWHRPT", "table_name": "DWS_RPT_ZCPZ_CYFL_TF_M", "column_name": "amt", "matched_on": "字段注释匹配：投放金额" }
]
```

**后端改动**：增强 `SqlSchemaService.search()` 方法，添加 `table_comment` 和 `column_comment` 的 like 查询，返回 `matched_on` 字段。

### 7.3 不引入大型重构

- 不拆分 `AskWorkbenchPage.tsx` 为多个文件（除非已经很大）
- 不做路由级别改动
- 不做 session 列表持久化/分页
- 不做 drag & drop 表选择
- 不改 `DataScopeSelector` props 接口（只改内部实现）

---

## P1 — Validator 的结构化错误展示

### 8.1 前端展示 SQL Validation Error

当后端返回 `ok:false` + `errorCode: INVALID_RESPONSE` + `details.sqlValidation` 时，前端通过 `Error Alert` + `SqlValidationAlert` 组件展示：

```
┌─ ⚠️ SQL 校验未通过 ───────────────────────────┐
│  SQL 校验未通过，请检查字段和表结构                │
│                                                 │
│ ┌─ 字段不存在 ─────────────────────────────────┐│
│ │ investment_amount                             ││
│ │ 不在目标表 DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M 中  ││
│ └──────────────────────────────────────────────┘│
│                                                 │
│ ┌─ 表名缺 Schema ──────────────────────────────┐│
│ │ DWS_RPT_ZCPZ_CYFL_TF_M                        ││
│ │ 应为 DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M           ││
│ └──────────────────────────────────────────────┘│
│                                                 │
│ 建议：请检查数据范围选择是否正确，或补充问题描述    │
│                                                 │
│ [切回模拟模式再试] [关闭]                        │
└─────────────────────────────────────────────────┘
```

### 8.2 ErrorCode 映射表

校验失败时的前端展示映射：

| 后端 errorCode | 前端展示标题 | 操作按钮 |
|----------------|-------------|---------|
| `INVALID_RESPONSE` + `details.sqlValidation` | "SQL 校验未通过" | "切回模拟模式再试" / "关闭" |
| `METADATA_NOT_FOUND` | "表元数据未采集" | "前往数据源采集元数据" / "关闭" |
| 其他 | "分析异常"（已有） | 不变 |

---

## 异常响应协议总结（统一规范）

### METADATA_NOT_FOUND（不调 LLM）

```json
{
  "ok": false,
  "errorCode": "METADATA_NOT_FOUND",
  "errorMessage": "未找到该表元数据，请先采集元数据",
  "details": {
    "datasourceId": 1,
    "tableName": "DWS_RPT_ZCPZ_CYFL_TF_M",
    "suggestion": "请在数据源管理中为该数据源触发元数据采集"
  }
}
```

**前端行为**：展示引导性提示，不生成 chartSuggestions / narrative / fake semantic findings。

### INVALID_RESPONSE + sqlValidation（校验失败）

```json
{
  "ok": false,
  "errorCode": "INVALID_RESPONSE",
  "errorMessage": "SQL 校验未通过，请检查字段和表结构",
  "details": {
    "sqlValidation": {
      "errors": [...],
      "warnings": [],
      "sql": "..."
    }
  }
}
```

**前端行为**：展示 `SqlValidationAlert`，不渲染 `AiNarrative`。

### 成功响应（sql_pending）

```json
{
  "ok": true,
  "data": {
    "question": "...",
    "intent": {...},
    "sqlPlan": {...},
    "narrative": {
      "summary": "分析口径：... ⚠️ SQL 已生成但尚未执行...",
      "keyFindings": [],
      "evidence": [],
      "risks": [...],
      "nextQuestions": [...]
    },
    "chartSuggestions": [...],
    "semanticGaps": [...],
    "narrativeLevel": "sql_pending"
  }
}
```

> **与 v1 差异**：`narrativeLevel` 只存在于 `ok:true` 响应中，只包含 `sql_pending` / `executed` 两个值。`narrative` 已由后端 sanitize。

---

## P2 — 不进入本 MVP 的内容

以下内容明确定义为"后续阶段"，不在 Phase 5M 范围内：

1. **真实 SQL 执行**：LLM 生成 SQL 后自动执行并展示结果（需要 SQL Workbench 执行能力 + 结果渲染）
2. **RAG / 向量检索**：接入向量数据库做语义匹配
3. **Session 持久化增强**：搜索结果缓存、表选择持久化
4. **多表 JOIN 自动发现**：基于外键约束自动发现关联表
5. **Drag & drop 表选择**：交互式多表关联配置
6. **血缘图和字段级 lineage**
7. **指标口径自动匹配**：将 `MetricDefinition` 纳入 LLM 上下文（MVP 不接入）

> **与 v1 差异**：将"完整 SQL Parser"从 P2 移出——sqlglot 已进入 MVP 推荐方案（见 4.3 节）。

---

## 架构变更总览

### 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `app/services/ai_ask/prompt_builder.py` | 修改 | 新增 `metadata_context` 参数，注入字段级元数据和 domain rules |
| `app/services/ai_ask/llm_service.py` | 修改 | `analyze()` 中插入 MetadataResolver、SQL Validator、narrative sanitize |
| `app/services/ai_ask/metadata_resolver.py` | **新增** | 从 TableMetadata/ColumnMetadata/FieldSemantic 查询表元数据 |
| `app/services/ai_ask/sql_validator.py` | **新增** | 基于元数据的 SQL 字段存在性/schema/操作类型校验（含 sqlglot 解析） |
| `app/services/ai_ask/domain_rules.py` | **新增** | dwhrpt 数仓领域规则定义（命名/分区/约束） |
| `app/services/ai_ask/normalizer.py` | 修改 | 兼容 `narrativeLevel` / `sqlValidation` 字段（透传） |
| `app/services/ai_ask/validator.py` | 修改 | 可选字段 `narrativeLevel` / `sqlValidation` 不报错 |
| `app/schemas/ai_ask.py` | 修改 | `AiAskAnalyzeRequest` 保持，增加 `METADATA_NOT_FOUND` 错误码 |
| `app/services/sql_schema_service.py` | 修改 | `search()` 增强：添加 table_comment + column_comment 搜索，返回 matched_on |
| `frontend/src/components/DataScopeSelector.tsx` | **重构** | 新增搜索输入框，集成 `/api/sql/schema/search` API，按匹配类型分组展示 |
| `frontend/src/components/DataScopeBar.tsx` | **新增** | 顶部数据集选择栏（数据源 + 已选表 tags + 面板折叠控制） |
| `frontend/src/components/SqlValidationAlert.tsx` | **新增** | SQL 校验失败专用展示组件 |
| `frontend/src/components/AiNarrative.tsx` | 修改 | 根据 `narrativeLevel` 分级渲染，二次保护 keyFindings/evidence |
| `frontend/src/components/SqlPlan.tsx` | 修改 | 校验失败时展示 error badge 而非正常 SQL |
| `frontend/src/pages/AskWorkbenchPage.tsx` | 修改 | 集成 DataScopeBar，重构左侧 Sider 布局 |
| `frontend/src/types/aiAsk.ts` | 修改 | 新增 `NarrativeLevel` 类型（`sql_pending`/`executed`）和 `SqlValidation` 结构 |
| `frontend/src/api/aiAsk/realLlmAdapter.ts` | 修改 | `METADATA_NOT_FOUND` 和 `INVALID_RESPONSE` + sqlValidation 的展示逻辑 |
| `frontend/src/api/aiAsk/validator.ts` | 修改 | 前端结构校验兼容新增可选字段 |
| `pyproject.toml` 或 `requirements.txt` | 修改 | 新增 `sqlglot>=25.0.0` 依赖 |

### 数据库变更

**无**。完全复用现有 `table_metadata`、`column_metadata`、`field_semantic` 表。

### 新增后端依赖

`sqlglot>=25.0.0`（SQL 解析）

### 新增后端 API

**无**。复用：
- `GET /api/metadata/tables` — 查询表元数据
- `GET /api/sql/schema/search` — 搜索表和字段（搜索范围增强，API 签名不变）

### 前端新增依赖

**无**。仅使用 Ant Design 现有组件：`Input.Search`、`Tooltip`、`Sider collapsible`。

---

## 数据流（完整链路）

```
用户提问
  │
  ▼
前端 send(question, datasourceId, selectedTables)
  │
  ▼
后端 POST /api/ai-ask/analyze
  │
  ├─ MetadataResolver.resolve() ← 查询 TableMetadata / ColumnMetadata
  │   │
  │   ├─ 全无元数据 → 返回 METADATA_NOT_FOUND (ok:false, 不调 LLM)
  │   │
  │   └─ 有元数据 → metadata_context → PromptBuilder
  │
  ├─ PromptBuilder.build(question, metadata_context, domain_rules)
  │   │
  │   └─ system prompt 包含：字段结构 / 约束规则 / 数仓规则
  │
  ├─ LLM 调用（OpenAI compatible）
  │   │
  │   └─ 返回 JSON
  │
  ├─ Normalizer.normalize()
  │
  ├─ 后端 sanitize narrative（清空 keyFindings/evidence，仅保留口径说明）
  │
  ├─ Metadata SQL Validator.validate(sql, fields, metadata, sqlglot)
  │   │
  │   ├─ 失败 → 返回 INVALID_RESPONSE + details.sqlValidation (ok:false)
  │   │
  │   └─ 通过 → 设置 narrativeLevel = "sql_pending"
  │
  └─ 返回 AiAskAnalyzeSuccessResponse (ok:true)
       │
       └─ data.narrativeLevel: "sql_pending"
       └─ data.narrative: { keyFindings: [], evidence: [], ... }
       └─ data.sqlValidation: { errors: [], warnings: [] }
  │
  ▼
前端收到响应
  │
  ├─ ok:false + errorCode: METADATA_NOT_FOUND
  │   ├─ 展示"表元数据未采集"提示
  │   ├─ 展示"前往数据源采集元数据"操作按钮
  │   └─ 不渲染 AiNarrative / chartSuggestions / SqlPlan
  │
  ├─ ok:false + errorCode: INVALID_RESPONSE + details.sqlValidation
  │   ├─ 展示 SqlValidationAlert（校验失败详情）
  │   ├─ 不展示 SqlPlan（不展示错误 SQL）
  │   ├─ 不展示 chartSuggestions
  │   └─ 不展示 AiNarrative
  │
  └─ ok:true + narrativeLevel: "sql_pending"
      ├─ 展示 SqlPlan（含 schema 限定 SQL）
      ├─ 展示 summary（分析口径说明 + "待 SQL 执行后验证"）
      ├─ 隐藏 keyFindings / evidence / conclusion（二次保护）
      ├─ 展示 chartSuggestions（标注"⏳ 待 SQL 执行后渲染"）
      └─ 展示 risks / nextQuestions
```

---

## 测试策略

### 测试原则

1. **不调用真实 LLM**：所有 LLM 调用使用 `unittest.mock.patch` 模拟
2. **不引入 Playwright / Cypress**
3. **不测试 Monaco DOM**
4. **不测试真实 LLM 连接**
5. **复用现有测试框架**：pytest（后端） + vitest / react-testing-library（前端）

### 后端测试

| 测试目标 | 文件 | 测试用例 |
|---------|------|---------|
| PromptBuilder 元数据注入 | `test_prompt_builder.py` | 给定表元数据列表，检查 prompt 包含真实字段名和注释 |
| PromptBuilder Domain Rules | `test_prompt_builder.py` | prompt 中包含"只允许 SELECT""schema 限定"约束 |
| MetadataResolver 查询 | `test_metadata_resolver.py` | 给定 selected_tables，返回正确的 schema/table/columns |
| MetadataResolver 缺失 | `test_metadata_resolver.py` | 选中表无元数据 → 返回空列表 |
| MetadataResolver schema.table 解析 | `test_metadata_resolver.py` | 问题中出现 `DWHRPT.TABLE` → 提取并查询 |
| SQL Validator 字段存在性 | `test_sql_validator.py` | `region` / `investment_amount` 不存在时 errors 非空 |
| SQL Validator schema 限定 | `test_sql_validator.py` | `FROM DWS_RPT` 缺 schema → errors 包含 TABLE_SCHEMA_MISSING |
| SQL Validator DDL/DML | `test_sql_validator.py` | `DELETE / DROP / INSERT` → errors 包含 DDL_DML_NOT_ALLOWED |
| SQL Validator pt 分区 | `test_sql_validator.py` | `pt='20260630'` 合法；无 pt 过滤时 errors 包含 PARTITION_FILTER_MISSING |
| SQL Validator 合法 SQL | `test_sql_validator.py` | `SELECT amt FROM DWHRPT.TABLE WHERE pt='20260630'` errors 为空 |
| SQL Validator 复杂 SQL（json_extract） | `test_sql_validator.py` | 含 CTE / JOIN / 子查询的 SQL 能正确提取表 |
| LLM Service 错误字段 | `test_ai_ask_llm.py` | Mock LLM 返回包含错误字段的 SQL → `ok:false` INVALID_RESPONSE |
| LLM Service 无元数据 | `test_ai_ask_llm.py` | 无元数据 → `ok:false` METADATA_NOT_FOUND（不调 LLM） |
| LLM Service narrative sanitized | `test_ai_ask_llm.py` | 成功响应中 keyFindings 为空、evidence 为空、summary 不含事实数字 |
| LLM Service narrativeLevel | `test_ai_ask_llm.py` | 成功响应中 narrativeLevel = `sql_pending` |
| SQL Validator 大小写 | `test_sql_validator.py` | 元数据字段大写但 SQL 小写 → CASE_MISMATCH error |
| SQL Validator 未知表引用 | `test_sql_validator.py` | SQL 引用未选表 → UNKNOWN_TABLE_REFERENCE error |
| sqlglot 解析 CTE | `test_sql_validator.py` | `WITH t AS (...) SELECT ...` 能区分 CTE 名和真实表名 |
| Domain Rules partition 规则 | `test_domain_rules.py` | partition(p20260630) → pt='20260630' 转换说明包含在 prompt 中 |

### 前端测试

| 测试目标 | 文件 | 测试用例 |
|---------|------|---------|
| DataScope 搜索框 | `DataScopeSelector.test.tsx` | 输入表名后调用 `/api/sql/schema/search` |
| DataScope 搜索按匹配类型分组 | `DataScopeSelector.test.tsx` | mock search 返回"表名匹配"/"字段注释匹配"等分组展示 |
| DataScope 搜索 4 种匹配类型 | `DataScopeSelector.test.tsx` | mock 返回 table_name / table_comment / column_name / column_comment 四种匹配 |
| NarrativeLevel sql_pending | `AiNarrative.test.tsx` | `narrativeLevel=sql_pending` 不展示 keyFindings（即使后端传了数据） |
| NarrativeLevel executed | `AiNarrative.test.tsx` | `narrativeLevel=executed` 正常展示 |
| SqlValidationAlert | `SqlValidationAlert.test.tsx` | 展示 validation errors 列表 |
| SqlPlan 受 sql_pending 影响 | `SqlPlan.test.tsx` | sql_pending 状态不展示 error badge |
| METADATA_NOT_FOUND | `AskWorkbenchPage.test.tsx` | 错误提示"未找到该表元数据" + 引导操作按钮 |
| INVALID_RESPONSE + sqlValidation | `AskWorkbenchPage.test.tsx` | 展示 SqlValidationAlert，不渲染 AiNarrative |
| chartSuggestions sql_pending | `AiChartBoard.test.tsx` | sql_pending 时展示"⏳ 待 SQL 执行后渲染"标签 |

### Mock/Scenario 改动

MockAdapter 中新增模拟场景：
- `metadata_gap`：无元数据场景，返回 METADATA_NOT_FOUND
- `sql_validation_error`：SQL 校验失败场景，返回 INVALID_RESPONSE + sqlValidation errors
- `sql_pending`：SQL 已生成未执行，sanitized narrative（keyFindings 空、evidence 空）

---

## Self-Review 清单

- [x] 无 TBD / TODO / 空泛描述
- [x] 不漂移到报告生成 / 会话持久化 / SQL 执行
- [x] 明确不需要 DB migration：完全复用现有 `table_metadata` / `column_metadata` / `field_semantic`
- [x] 明确不需要新增后端 API：搜索复用 `/api/sql/schema/search`（增强内部实现）
- [x] 所有 API 路径已修正为 `/api/sql/schema/search`
- [x] 明确真实 LLM 不参与自动化测试
- [x] sqlglot 列为 MVP 依赖，备选方案 fail closed
- [x] TABLE_SCHEMA_MISSING 统一为 error，无 warning 可豁免
- [x] SQL validation failed 统一通过 `ok:false` 返回，不走 narrative
- [x] Metadata missing 统一通过 `ok:false` + `METADATA_NOT_FOUND` 返回
- [x] narrativeLevel 只存在于 `ok:true` 成功响应中，只包含 `sql_pending` / `executed`
- [x] 后端 sanitize narrative：clear keyFindings/evidence，summary 不含事实数字
- [x] 前端二次保护 keyFindings/evidence
- [x] 搜索范围覆盖 4 种匹配类型（含 column_comment），搜索结果含 matched_on
- [x] 测试用例覆盖全部 validator rules 和异常路径
- [x] 不写 implementation plan
- [x] 不写代码
- [x] 不 commit
- [x] 不处理历史 untracked 文件（.venv / .superpowers / docs/references）
