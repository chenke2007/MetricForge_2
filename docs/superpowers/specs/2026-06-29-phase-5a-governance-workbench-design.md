# Phase 5A：治理工作台 MVP — 设计文档

> **Phase 5A** of MetricForge Development Plan
>
> **前置依赖：** Phase 2.5（AI 问数元数据工具调用）、Phase 3（SQL 开发工作台 MVP）、Phase 4（AI SQL 联动）、Phase 4.5（AI SQL 回归测试）已全部合并到 main。
>
> **目标：** 将治理待办闭环从 Jinja 旧 UI 迁移到 React 前端，打通「后端自动创建待办 → React 列表查看 → 字段语义编辑 → 自动闭环」的完整链路。

---

## 1. 背景与 Why Now

### 1.1 当前状态

当前治理待办主要由后端流程自动创建：

- **元数据采集 — 缺失语义检测**（`app/services/metadata_service.py:_detect_missing_semantics()`）：采集完成后检测无语义字段，自动创建 `missing_semantic`（`source="auto_detect"`）的治理待办
- **元数据采集 — 变更检测**（`app/services/metadata_change_governance_service.py:generate_governance_tickets_for_job()`）：采集时检测到表/字段的增删或属性变更，自动创建 `source="metadata_change_detected"` 的治理待办（`ticket_type` 如 `metadata_column_deactivated`、`metadata_column_type_changed` 等）

但这些待办的查看、处理和闭环全部在旧 Jinja UI（`/web/governance`）完成。用户从智能工作台到旧 UI 的跳转体验断裂：

```
后端自动创建治理待办（采集完成后）
    ↓
用户去 /web/governance（Jinja）查看待办
    ↓
查看字段详情 → 编辑字段语义 → 闭环
    ↓
全部在旧 Jinja UI 完成，界面风格和导航与智能工作台不一致
```

**注意：** 当前 `AskService` 不涉及治理待办的创建。AI 问数无法回答时自动创建待办的能力属于后续阶段，不在 Phase 5A 实现。

### 1.2 Phase 5A 解决的核心问题

Phase 5A 的目标是将治理闭环接入 React 前端，让用户在统一的智能工作台体验中完成治理工作流：

```
后端自动创建治理待办（采集/检测完成）
    ↓
治理待办列表（在 /app/governance，React）
    ↓
查看待办详情 → 跳转字段语义编辑
    ↓
录入业务别名、含义、单位 → 保存 → 自动关闭待办
    ↓
闭环回到治理列表
```

### 1.3 为什么先于 SQL 结果图表（Phase 5B）

| 维度 | Phase 5A：治理工作台 | Phase 5B：SQL 结果图表 |
|------|---------------------|----------------------|
| 核心价值 | 补齐治理闭环——治理待办的后端创建/自动闭环链路已就绪，但处理入口仍在旧 UI | SQL 工作台的分析增强——用户在 SQL Workbench 写查后可获得图表预览 |
| 当前缺口 | 治理待办处理在 Jinja，与智能工作台体验不一致、维护成本高 | SQL Workbench 已有基础结果表格，缺少虚拟滚动和图表 |
| 优先级 | 先弥合治理闭环的体验断裂 | 再增强分析表达 |

两者同样重要，但治理待办处理迁移到 React 前端对维护成本和体验一致性的改善更具确定性。

---

## 2. 范围与排除项

### 2.1 明确包含

- **治理待办列表页**（React）— 分页、筛选（状态/来源/类型）
- **待办详情 Drawer** — 展示待办信息 + 关联字段上下文
- **字段语义编辑** — 嵌入 Drawer，仅对 `missing_semantic` 类型待办开放
- **待办状态流转** — 分配、标记处理中、关闭操作
- **全链路闭环** — 字段语义保存后自动关闭关联待办，列表自动刷新
- **前端测试** — Vitest + React Testing Library 覆盖核心组件
- **UI 错误状态** — 列表加载失败、详情加载失败、保存失败等场景

### 2.2 明确排除

| 排除项 | 理由 |
|--------|------|
| 不迁移 Jinja 指标管理页面 | Phase 5A 聚焦治理闭环，不扩到指标域 |
| 不迁移字段语义列表页（`/web/field-semantics`） | 列表保留在 Jinja；本阶段仅从待办详情进入编辑 |
| 不做治理待办批量操作 | 批量关闭/分配属于运维操作，MVP 不做 |
| 不做完整治理流程平台 | 无工单流转、审批流、SLA、历史追踪 |
| 不做治理统计仪表板 | `governance_ticket_stats` 仅服务 AI 问数工具调用 |
| 不修改后端 API | 所有 API 已有，无需新增 |
| 不新增数据库表或迁移 | 0 后端 schema 变更 |
| 不引入 E2E 测试框架 | 保持现有测试栈 |
| 不实现 SQL 结果图表/虚拟滚动/排序筛选 | 属于 Phase 5B 候选 |
| 不新增「创建治理待办」表单 | 治理待办由后端自动创建 |
| 不更改 AskService 的后端行为 | 当前 AskService 不涉及治理待办创建；AI 无法回答时自动创建待办的能力属于后续阶段 |

---

## 3. 总体架构

```
┌────────────────────────────────────────────────────────────────────┐
│                        Phase 5A 架构                               │
│                                                                    │
│  ┌──────────────────┐    ┌─────────────────────────────────────┐  │
│  │  Jinja 保留页面   │    │  React 智能工作台                    │  │
│  │                   │    │                                     │  │
│  │  /web/dashboard   │    │  /app/ask          AI 问数           │  │
│  │  /web/datasources │    │  /app/sql-workbench SQL 工作台       │  │
│  │  /web/metadata    │    │  /app/governance   治理待办 ◄── 新增 │  │
│  │  /web/metrics     │    │  /app/metadata/jobs 采集任务         │  │
│  │  /web/field-sem   │    │  /app/llm-settings  LLM 配置        │  │
│  │  /web/governance  │    └─────────┬───────────────────────────┘  │
│  │      (旧，保留)    │              │                             │
│  └──────────────────┘              │                             │
│                                     ▼                             │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  FastAPI 后端（无变更）                                     │  │
│  │  /api/governance/       → 查询/更新治理待办                  │  │
│  │  /api/field-semantics/  → 查询/保存字段语义                   │  │
│  │  ...其他 API                                               │  │
│  └─────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

### 3.1 技术约束

- **零后端改动** — 所有 API 已有，Phase 5A 不新增后端路由、服务方法、数据库表
- **零数据库迁移** — 不涉及 schema 变更
- **保持双前端共存**——Jinja `/web/governance` 保留，React `/app/governance` 作为新增入口
- **遵循现有前端架构风格**——TanStack Query、Ant Design、React Router

---

## 4. 页面设计与路由

### 4.1 路由方案

| 路径 | 页面 | 说明 |
|------|------|------|
| `/governance` | 治理待办列表页 | 列表 + 筛选 + 分页，点击行打开 Drawer 详情 |

采用**单路由 + Drawer** 模式而非独立详情页路由：

- 治理待办的典型操作是「列表浏览 → 点开详情 → 编辑语义 → 回列表」，适合侧滑面板体验
- 不跳转路由，保留列表滚动位置和筛选状态
- 字段语义编辑以 Drawer 内 mode 切换实现，不走独立路由

### 4.2 侧边栏导航

在 `Layout.tsx` 的 `menuItems` 中新增一项：

| key | icon | label | 位置 |
|-----|------|-------|------|
| `/governance` | `<SafetyOutlined />` | 治理待办 | SQL 工作台之后 |

### 4.3 页面布局

```
┌─────────────────────────────────────────────────────────────┐
│  Header: 智能数据工作台                                      │
├─────────────────────────────────────────────────────────────┤
│  [侧栏]  │  GovernancePage                                 │
│          │                                                  │
│  工作台   │  ┌─ GovernanceFilterBar ──────────────────────┐ │
│  首页     │  │  [状态 ▼] [来源 ▼] [类型 ▼]               │ │
│  采集任务  │  │  [重置筛选]                               │ │
│  LLM配置  │  └────────────────────────────────────────────┘ │
│  AI问数   │  ┌─ GovernanceList ──────────────────────────┐ │
│  SQL工作台 │  │  ID │ 标题        │ 类型 │ 优先级 │ 状态  │ │
│  治理待办  │  │  ────────────────────────────────────────  │ │
│          │  │  42 │ 字段X缺少语义 │ m.. │ 高    │ open  │ │
│          │  │  43 │ 字段Y缺少语义 │ m.. │ 中    │ open  │ │
│          │  │  ...                                        │ │
│          │  │  [1] [2] [3] ... [共12页]                   │ │
│          │  └────────────────────────────────────────────┘ │
│          │                                                  │
│          │  ┌─ GovernanceDetailDrawer ───────────────────┐ │
│          │  │  ✕  待办 #42                               │ │
│          │  │  ──────────────────────────────────        │ │
│          │  │  标题: 字段 X 缺少语义                      │ │
│          │  │  来源: metadata_change_detected            │ │
│          │  │  状态: open    优先级: 高                   │ │
│          │  │  创建时间: 2026-06-28 14:30                │ │
│          │  │  ──────────────────────────────────        │ │
│          │  │  关联字段:                                 │ │
│          │  │  DW.DW_CONTRACT.contract_code             │ │
│          │  │  类型: VARCHAR2(50)                       │ │
│          │  │  备注: 合同编号                            │ │
│          │  │  ──────────────────────────────────        │ │
│          │  │  [编辑字段语义]  ← 仅 missing_semantic 显示 │ │
│          │  │  ──────────────────────────────────        │ │
│          │  │  操作:                                     │ │
│          │  │  [分配] [标记处理中] [关闭]                 │ │
│          │  └────────────────────────────────────────────┘ │
│          │                                                  │
│          └───────────────────────────────────────────────────┘
```

### 4.4 GovernDetailDrawer 状态机

```
[closed]
   │
   ▼
[detail mode]    ← 打开 Drawer，展示待办详情 + 字段上下文
   │
   ├─ 点击「编辑字段语义」（仅 missing_semantic + open/in_progress）
   │   → [edit mode]
   │       │
   │       ├─ 点击「返回详情」→ [detail mode]（表单数据不保存）
   │       │
   │       └─ 保存成功 → [detail mode]（数据刷新）
   │
   ├─ 状态变更/分配 → API 请求 → 刷新数据
   │
   └─ 关闭 Drawer → [closed]
```

### 4.5 字段语义编辑视图（Drawer 内 edit mode）

```
┌────────────────────────────────────────────────┐
│  ← 返回详情    编辑字段语义                     │
├────────────────────────────────────────────────┤
│  字段: DW.DW_CONTRACT.contract_code             │
│  类型: VARCHAR2(50)  备注: 合同编号              │
│                                                │
│  业务别名 *: [合同编号                        ] │
│  含义 *:    [合同唯一编码，格式为...         ] │
│  单位:      [— 请选择 —                       ] │
│  枚举值解释:                                   │
│  [Y: 有效合同                                ] │
│  [N: 无效合同                                ] │
│  数据质量说明:                                 │
│  [此字段来自合同主表，...                    ] │
│  治理负责人: [张三                            ] │
│                                                │
│  [取消]  [保存字段语义]                       │
└────────────────────────────────────────────────┘
```

**设计要点：**
- 只读头部分展示字段元数据（schema.table.column、类型、注释）
- 编辑表单复用现有 `FieldSemantic` 字段：`business_alias`、`meaning`、`unit`、`enum_values`、`data_quality_note`、`governed_by`
- `business_alias` 和 `meaning` 为必填（前后端双重校验）
- 保存按钮文案：**「保存字段语义」**
- 保存即调用 `PUT /api/field-semantics/columns/{column_id}`，后端自动关闭关联待办
- 保存成功后 Drawer 切回 detail mode，数据自动刷新
- 保存失败时表单数据保留，用户可重新提交

---

## 5. 组件边界

### 5.1 文件结构

```
frontend/src/
├── pages/
│   └── GovernancePage.tsx              ← 页面级组件
├── components/
│   ├── GovernanceList.tsx              ← 待办列表表格 + 分页
│   ├── GovernanceFilterBar.tsx         ← 组合筛选器
│   ├── GovernanceDetailDrawer.tsx      ← 待办详情抽屉（含 mode 切换）
│   └── SemanticEditForm.tsx            ← 字段语义编辑表单
├── api/
│   └── governance.ts                   ← governance + field_semantics API client
├── hooks/
│   ├── useGovernanceTickets.ts         ← 待办列表 query hook
│   ├── useGovernanceTicket.ts          ← 待办详情 query hook
│   ├── useSaveSemantic.ts              ← 字段语义保存 mutation hook
│   └── useUpdateTicketStatus.ts        ← 待办状态变更 mutation hook
```

### 5.2 组件职责明细

| 组件 | 职责 | 状态来源 |
|------|------|---------|
| `GovernancePage` | 管理筛选参数（URL search params）、控制 Drawer 开关、控制 Drawer mode（detail / edit） | `useSearchParams` + `useState` |
| `GovernanceList` | Ant Design Table，列：ID、标题、类型、优先级、状态、来源、创建时间。点击行触发 `onSelect(ticketId)` | Props（items, pagination, loading, onPageChange, onSelect, onTicketAction） |
| `GovernanceFilterBar` | Ant Design Form.Inline：状态、来源、类型下拉，重置按钮 | Props（values, onChange, onReset） |
| `GovernanceDetailDrawer` | 宽 480px，内含 detail/edit 两种 mode。**「编辑字段语义」按钮仅在 `ticket_type === 'missing_semantic'` 且 `status` 为 open/in_progress 时渲染**。底部操作按钮（分配/标记处理中/关闭）始终在 detail mode 展示 | Ticket detail data + local mode state |
| `SemanticEditForm` | 嵌入 Drawer 的编辑表单。内联只读字段头。必填项前端校验。保存成功触发 `onSaved(closedTickets)` | Props（columnContext, existingSemantic, onSaved, onCancel） |

### 5.3 组件间数据流

```
GovernancePage
  │
  ├─ URL search params → GovernanceFilterBar
  │   onChange → setSearchParams + refetch
  │
  ├─ filters → useGovernanceTickets(filters)
  │   ├─ loading → GovernanceList 骨架屏
  │   ├─ data   → GovernanceList items + pagination
  │   └─ error  → GovernanceList 错误状态
  │
  ├─ selectedTicketId → useGovernanceTicket(id)
  │   ├─ loading → GovernanceDetailDrawer 骨架屏
  │   ├─ data   → GovernanceDetailDrawer 渲染
  │   │   ├─ detail mode → 展示待办信息 + 字段上下文
  │   │   │   ├─ [编辑字段语义] → switch to edit mode
  │   │   │   │   → SemanticEditForm
  │   │   │   │       ├─ onSaved → invalidate queries → switch to detail mode
  │   │   │   │       └─ onCancel → switch to detail mode
  │   │   │   └─ [状态变更] → useUpdateTicketStatus → invalidate
  │   │   └─ error  → Drawer 内错误提示
  │   └─ null    → Drawer 关闭
  │
  └─ useSaveSemantic
      └─ onSuccess → invalidateQueries(['governance', ...])
```

---

## 6. API 使用边界

### 6.1 调用的 API 端点

所有 API 已有，Phase 5A **不新增后端路由**：

> **重要：** 以下 PUT 接口使用 FastAPI `Query` 参数（即 URL query params / `URLSearchParams`），而非 JSON body。前端 API client 必须使用 `URLSearchParams` 或等效方式传参，不能发送 JSON body。

| 用途 | API | 方法 | 参数传递方式 | 参数 |
|------|-----|------|-------------|------|
| 待办列表 | `/api/governance/` | GET | Query params | `status`, `ticket_type`, `source`, `page`, `per_page` |
| 待办详情 | `/api/governance/{ticket_id}` | GET | Path + Query | 无额外参数，返回 `field_context` + `field_semantic` |
| 状态流转 | `/api/governance/{ticket_id}/status` | PUT | **Query params** | `status`（必填）, `resolution`（可选） |
| 分配 | `/api/governance/{ticket_id}/assign` | PUT | **Query params** | `assignee`（必填） |
| 字段语义保存 | `/api/field-semantics/columns/{column_id}` | PUT | **Query params** | `business_alias`, `meaning`, `unit`, `enum_values`, `data_quality_note`, `governed_by` |

### 6.2 API 缺口分析

| 需求 | 现有 API | 状态 |
|------|----------|------|
| 待办列表 + 筛选 | `GET /api/governance/?status=&ticket_type=&source=&page=&per_page=` | ✅ 完全满足 |
| 待办详情 + 关联字段 | `GET /api/governance/{ticket_id}` 含 `field_context` | ✅ 完全满足 |
| 待办状态流转 | `PUT /api/governance/{ticket_id}/status` | ✅ 完全满足 |
| 待办分配 | `PUT /api/governance/{ticket_id}/assign` | ✅ 完全满足 |
| 字段元数据+语义 | `GET /api/field-semantics/columns/{column_id}` | ✅ 完全满足 |
| 语义编辑保存 | `PUT /api/field-semantics/columns/{column_id}` | ✅ 完全满足 |
| 关键词搜索待办 | 无 `q` 参数 | ⚠️ 本阶段暂不支持搜索，仅筛选。如需可后续加 `q` |

**结论：Phase 5A 无需新增或修改后端 API。**

---

## 7. 状态与数据流

### 7.1 治理待办的创建来源（已有流程，Phase 5A 不修改）

治理待办由后端流程自动创建，**当前 AskService 不涉及待办创建**。主要来源：

1. **元数据采集 — 缺失语义检测**（`app/services/metadata_service.py:_detect_missing_semantics()`）
   - 采集完成后自动检测无语义字段
   - 创建 `source="auto_detect"`, `ticket_type="missing_semantic"`, `related_object_type="column"` 的治理待办
2. **元数据采集 — 变更检测**（`app/services/metadata_change_governance_service.py:generate_governance_tickets_for_job()`）
   - 采集时检测到表/字段的增删或属性变更
   - 创建 `source="metadata_change_detected"` 的治理待办
   - `ticket_type` 包括 `metadata_table_deactivated`、`metadata_column_deactivated`、`metadata_column_type_changed`、`metadata_column_comment_changed` 等

→ 用户可以在 `/app/governance` 查看这些待办

### 7.2 治理列表数据流

```
GovernancePage mount
    ↓
读取 URL search params（或默认值: status=open, page=1, per_page=20）
    ↓
useGovernanceTickets(filters)
    ↓
GET /api/governance/?status=open&page=1&per_page=20
    ↓
TanStack Query 缓存（staleTime: 10s, keepPreviousData: true）
    ↓
渲染 GovernanceList + 分页
```

### 7.3 Drawer 详情 → 编辑 → 保存 → 闭环数据流

```
用户点击待办行（ticket_id=42, ticket_type='missing_semantic'）
    ↓
GovernancePage setState → selectedTicketId=42, drawerOpen=true
    ↓
useGovernanceTicket(42) → GET /api/governance/42
    ↓
渲染 detail mode（标题、状态、字段上下文、操作按钮）
    ↓ 点击「编辑字段语义」
切换到 edit mode → SemanticEditForm 预填字段语义
    ↓ 用户填写并点击「保存字段语义」
useSaveSemantic.mutateAsync({
    column_id: field_context.id,
    business_alias: '合同编号',
    meaning: '合同唯一编码，格式为HT-YYYYMMDD-NNNN',
    ...
})
    ↓
PUT /api/field-semantics/columns/{column_id}?business_alias=合同编号&meaning=...
（注意：参数为 URL query params，非 JSON body）
    ↓
后端响应: { message: "字段语义已保存", semantic_id: 42, closed_tickets: 1 }
    ↓
[成功] 1. message.success(`字段语义已保存（关闭 ${closed_tickets} 个关联待办）`)
           2. invalidateQueries(['governance', 'list'])
           3. invalidateQueries(['governance', 'detail', 42])
           4. 切换回 detail mode
[失败]  1. message.error('保存失败，请重试')
           2. 表单数据保留，用户可重新提交
```

---

## 8. 错误处理设计

| 异常场景 | 用户体验 | 技术措施 |
|----------|---------|---------|
| **列表加载失败**（网络/500） | GovernanceList 区域显示 Ant Design `<Result status="error" title="加载失败" subTitle="..." extra={<Button>重试</Button>} />` | `useGovernanceTickets` 的 `isError` 状态驱动。重试按钮调用 `refetch()` |
| **详情加载失败**（网络/500） | Drawer 内显示 `<Result status="error">`，含重试按钮 | `useGovernanceTicket` 的 `isError`。重试按钮调用 `refetch()` |
| **待办不存在**（404） | Drawer 内显示 `<Result status="404" title="待办不存在" />`，3 秒后自动关闭 Drawer | `useGovernanceTicket` catch 404 → 独立错误状态处理 |
| **字段不存在**（`field_context` 为 null） | Drawer 展示详情，**「编辑字段语义」按钮不显示**。额外提示「关联字段可能已被删除」 | 根据 `field_context === null` 条件渲染 |
| **语义保存失败**（网络错误） | `message.error('保存失败，请重试')`。表单数据不丢失 | `useSaveSemantic` mutation `onError` |
| **语义保存 API 校验失败**（422） | 表单内 `Form.Item` 显示对应字段校验错误 | 前端 form validation 已拦截大部分；后端 422 错误映射回对应字段 |
| **保存成功但 `closed_tickets = 0`** | `message.success('字段语义已保存')`。不额外提示失败 | 仅用于 success message 文案差异 |
| **保存后列表刷新失败** | 不中断体验。Drawer 内数据正确，列表未即时更新。用户可手动刷新 | `invalidateQueries` 静默失败 |
| **状态流转失败**（分配/关闭） | `message.error('操作失败')`。Drawer 不关闭 | Mutation `onError` |

---

## 9. 测试策略

### 9.1 前端单元测试（Vitest + React Testing Library）

#### 新增测试文件

| 测试文件 | 关键用例 |
|----------|---------|
| `frontend/src/pages/GovernancePage.test.tsx` | 初始加载展示 loading → list；URL 参数 sync；Drawer 开关；筛选变化触发 query 变化 |
| `frontend/src/components/GovernanceList.test.tsx` | 空列表空状态；正常数据渲染 N 行；分页按钮点击；点击行触发 `onSelect` |
| `frontend/src/components/GovernanceFilterBar.test.tsx` | 各筛选器联动；重置清空所有筛选；默认值 |
| `frontend/src/components/GovernanceDetailDrawer.test.tsx` | `missing_semantic` 显示编辑按钮；其他类型不显示；detail→edit→detail 状态切换；保存成功后文案含 `closed_tickets`；保存失败表单保留 |
| `frontend/src/components/SemanticEditForm.test.tsx` | 必填字段校验；预填 semantic 数据；保存调用正确参数；取消回到详情 |

#### Mock 策略

- hooks（`useGovernanceTickets` / `useGovernanceTicket` / `useSaveSemantic`）通过 wrapper 注入控制
- API 层不真实调用，通过 mock query client 返回值
- 数据源 fixture 统一使用 `dwhrpt` 约定（同 Phase 4.5）

#### 测试覆盖重点

- 列表空状态、加载状态、错误状态、正常渲染
- Drawer 状态切换（detail ↔ edit）
- 筛选条件重置
- 保存成功/失败反馈
- **编辑按钮条件显示**（仅 `missing_semantic` + open/in_progress）

### 9.2 后端测试

- ✗ 不新增后端测试（无后端改动）
- ✗ 不引入 E2E 测试框架

---

## 10. 文件变更清单

### 10.1 新增文件

| 文件 | 说明 |
|------|------|
| `frontend/src/pages/GovernancePage.tsx` | 治理工作台页面 |
| `frontend/src/components/GovernanceList.tsx` | 治理待办列表组件 |
| `frontend/src/components/GovernanceFilterBar.tsx` | 治理筛选组件 |
| `frontend/src/components/GovernanceDetailDrawer.tsx` | 待办详情抽屉 |
| `frontend/src/components/SemanticEditForm.tsx` | 字段语义编辑表单 |
| `frontend/src/api/governance.ts` | Governance + FieldSemantics API client |
| `frontend/src/hooks/useGovernanceTickets.ts` | 待办列表 query hook |
| `frontend/src/hooks/useGovernanceTicket.ts` | 待办详情 query hook |
| `frontend/src/hooks/useSaveSemantic.ts` | 字段语义保存 mutation hook |
| `frontend/src/hooks/useUpdateTicketStatus.ts` | 待办状态变更 mutation hook |
| `frontend/src/pages/GovernancePage.test.tsx` | 页面级测试 |
| `frontend/src/components/GovernanceList.test.tsx` | 列表组件测试 |
| `frontend/src/components/GovernanceFilterBar.test.tsx` | 筛选组件测试 |
| `frontend/src/components/GovernanceDetailDrawer.test.tsx` | 抽屉组件测试 |
| `frontend/src/components/SemanticEditForm.test.tsx` | 编辑表单测试 |

### 10.2 修改文件

| 文件 | 变更 | 说明 |
|------|------|------|
| `frontend/src/components/Layout.tsx` | 新增菜单项 | `SafetyOutlined` + "治理待办"导航 |
| `frontend/src/App.tsx` | 新增路由 | `<Route path="/governance" element={<GovernancePage />} />` |

### 10.3 统计

- **新增文件：** 15（含 5 个测试文件）
- **修改文件：** 2（Layout.tsx 和 App.tsx）
- **后端改动：** 0
- **数据库：** 0
- **后端 API：** 0

---

## 11. 验收标准

- [ ] `/app/governance` 路由可访问，侧栏显示「治理待办」导航项
- [ ] 待办列表默认显示 `status=open` 的待办，支持分页
- [ ] 支持按状态、来源、类型组合筛选
- [ ] 点击列表行打开待办详情 Drawer（宽 480px）
- [ ] Drawer 展示待办 ID、标题、来源、状态、优先级、创建时间
- [ ] Drawer 展示关联字段的 schema.table.column、类型、注释
- [ ] `missing_semantic` 类型待办且 `status=open/in_progress` 时显示「编辑字段语义」按钮
- [ ] 其他类型待办不显示「编辑字段语义」按钮
- [ ] 字段不存在（`field_context=null`）时不显示编辑按钮，显示提示
- [ ] 点击「编辑字段语义」切换到 edit mode，嵌入 SematicEditForm
- [ ] 表单必填项 `business_alias` 和 `meaning` 有前端校验
- [ ] 保存按钮文案为「保存字段语义」
- [ ] 保存成功后显示 `message.success` 含 `closed_tickets` 数量
- [ ] 保存成功后 Drawer 刷新为 detail mode，待办状态可能变为 `resolved`
- [ ] 保存成功后列表自动刷新
- [ ] 保存失败时表单数据保留，可重新提交
- [ ] 待办列表支持状态流转和分配操作
- [ ] 列表加载失败展示错误状态 + 重试按钮
- [ ] 详情加载失败展示错误状态 + 重试按钮
- [ ] 所有前端测试通过
- [ ] `npm run build` 通过
- [ ] 不新增后端 API、数据库表、数据库迁移

---

## 12. Phase 5B 路线记录

以下为 Phase 5A 之后的候选阶段，不在 Phase 5A 实现：

### Phase 5B：SQL 结果查询 + 图表探索（候选）

**目标：** 增强 SQL Workbench 的分析表达能力，在 `SqlWorkbenchPage` 上增加：
- SQL 执行结果表格增强（虚拟滚动、列宽调整、排序）
- 基于结果字段类型的图表建议
- ECharts 简单图表预览（柱状图、折线图、饼图）
- 查询结果保存为报表草稿或图表草稿的入口

**为什么放在 Phase 5B：**
- Phase 5A 先迁移治理待办处理闭环到 React，降低维护成本、统一用户体验
- Phase 5B 再增强 SQL Workbench 的分析表达能力
- 两者都重要，但治理闭环的迁移对维护成本和体验一致性的改善更具确定性

---

## 13. 安全约束

| 维度 | 措施 |
|------|------|
| 字段语义编辑 | 走现有 `PUT /api/field-semantics/columns/{column_id}`，无新增攻击面 |
| 待办状态流转 | 走现有 `PUT /api/governance/{ticket_id}/status` |
| 未登录访问 | 通过现有 FastAPI 认证中间件（如有），前端不绕过 |
| 数据注入 | 所有表单数据通过 Ant Design Form 受控组件管理，不经过 `dangerouslySetInnerHTML` |
| 无新增后端 API | 0 新增后端端点 |
