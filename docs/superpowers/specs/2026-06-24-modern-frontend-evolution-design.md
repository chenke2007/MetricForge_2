# MetricForge 现代前端演进架构设计

## 背景

MetricForge 当前 Web UI 使用：

```text
FastAPI + Jinja2 + Bootstrap 5 + 原生 JavaScript
```

这套架构已经支撑了数据源管理、元数据浏览、指标治理、治理待办、字段语义维护、采集任务中心等后台页面。它的优势是简单、部署成本低、后端开发者容易维护，适合 MVP 阶段的配置型后台。

但 MetricForge 的目标不是普通后台系统，而是面向融资租赁业务的数据智能平台。未来核心能力会包括：

- AI 智能问数。
- SQL 开发与调试。
- 查询结果分析。
- 可视化报表生成。
- 元数据语义治理。
- 采集任务实时监控。
- RAG、Schema Linking、指标口径解释。

这些能力对前端提出更高要求：复杂组件、局部状态、流式输出、代码编辑器、图表、拖拽布局、虚拟表格、WebSocket/SSE、Markdown 与代码块渲染。继续用 Jinja2 模板和零散原生 JS 会快速遇到维护和体验上限。

本设计的目标是明确 MetricForge 的现代前端演进方向，同时避免过早推倒重写。

## 结论

推荐采用“渐进式前后端分离”：

```text
保留 FastAPI 后端
保留现有 Jinja 后台
新增 React + TypeScript 智能工作台
按模块逐步迁移高交互页面
```

推荐第一阶段技术选型：

```text
React + TypeScript + Vite + Ant Design + TanStack Query + Monaco Editor + ECharts
```

不推荐第一阶段直接全量切换到 Next.js 或重写全部 Jinja 页面。

原因：

- 当前系统后端已经是 FastAPI，API、任务调度、数据库访问、元数据采集都在 Python 侧。
- 内部数据平台不需要 SEO。
- Vite SPA 部署和 FastAPI 共存成本最低。
- React 生态更适合 SQL 编辑器、AI 对话、复杂表格、图表和报表工作台。
- Ant Design 更贴近企业后台和数据治理场景。
- Next.js 可以作为后续方案，但第一阶段引入 Node BFF 和双服务部署会增加复杂度。

## 参考依据

本设计参考以下官方资料和主流生态事实：

- React 官方文档强调用组件组合构建 UI，适合可复用复杂界面。
- Next.js 官方文档支持 App Router、Server Components 和 streaming，适合需要全栈 React 和流式 UI 的场景。
- Ant Design 官方定位为企业级 React UI 组件库，适合后台管理与业务系统。
- Monaco Editor 是浏览器中的代码编辑器能力基础，适合 SQL 编辑器。

这些资料支持一个判断：MetricForge 的未来核心交互更适合现代组件化前端，而不是继续堆 Jinja 模板和页面级脚本。

## 非目标

本阶段不做以下事情：

- 不立即删除 Jinja2。
- 不一次性重写所有页面。
- 不把 FastAPI 后端迁移到 Node。
- 不为了“现代化”引入过度复杂的微前端。
- 不在第一阶段实现完整低代码 BI 报表搭建器。
- 不在第一阶段实现完整权限前端体系。
- 不改变元数据采集、治理、调度的后端服务边界。

## 目标架构

### 后端

继续使用 FastAPI 作为主后端：

```text
FastAPI
├── REST API
├── SSE/WebSocket streaming API
├── 元数据采集服务
├── 调度服务
├── 治理服务
├── 指标服务
├── SQL 安全与执行服务
└── 数据库模型
```

后端继续负责：

- 数据源连接与凭据管理。
- Oracle 元数据采集。
- 采集任务与调度。
- 指标治理。
- 字段语义治理。
- SQL 安全校验。
- 查询执行。
- AI/RAG 服务编排。
- 审计与权限。

### 传统后台

保留现有 Jinja2 后台：

```text
/web/*
```

适合继续放在 Jinja 的页面：

- 数据源管理。
- 采集任务中心。
- 元数据浏览基础页。
- 治理待办基础列表。
- 指标基础 CRUD。
- 系统配置页。

判断标准：

- 表单简单。
- 页面刷新可接受。
- 不需要复杂局部状态。
- 不需要高频交互。
- 不需要复杂可视化。

### 现代前端工作台

新增独立前端应用：

```text
frontend/
├── src/
│   ├── app/
│   ├── pages/
│   ├── features/
│   ├── components/
│   ├── api/
│   ├── stores/
│   ├── styles/
│   └── tests/
├── package.json
├── vite.config.ts
└── tsconfig.json
```

建议路由前缀：

```text
/app/*
```

第一阶段页面：

- `/app/ask`: AI 问数对话工作台。
- `/app/sql`: SQL 开发工作台。
- `/app/results`: 查询结果分析和图表预览。
- `/app/metadata`: 高交互元数据语义工作台。

Jinja 与现代前端可以长期共存：

```text
/web/*  -> Jinja 后台
/app/*  -> React 智能工作台
/api/*  -> FastAPI API
```

## 技术选型

### 推荐选型

```text
React
TypeScript
Vite
Ant Design
TanStack Query
Monaco Editor
ECharts
React Router
Zustand 或 Jotai
Markdown 渲染库
代码高亮库
```

### 选型理由

React:

- 组件化生态成熟。
- 与 Monaco、图表、AI chat UI、复杂表格生态兼容好。
- 团队和社区资源充足。

TypeScript:

- API 契约更清晰。
- 适合复杂前端状态与组件。
- 降低大规模 UI 演进风险。

Vite:

- 启动快。
- 配置轻。
- 适合 SPA 与 FastAPI 共存。

Ant Design:

- 企业后台组件齐全。
- 表单、表格、弹窗、布局、导航能力成熟。
- 更符合 MetricForge 的数据治理后台气质。

TanStack Query:

- 管理请求缓存、加载状态、错误状态、重试、失效刷新。
- 适合采集任务轮询、元数据列表、治理待办列表。

Monaco Editor:

- 支持浏览器内 SQL 编辑体验。
- 可扩展语法高亮、自动补全、诊断、快捷键。

ECharts:

- 适合经营分析图表。
- 中文业务系统中使用广泛。
- 和后端查询结果 JSON 容易集成。

### 暂不推荐 Next.js 作为第一阶段

Next.js 适合：

- 需要 SSR/SEO 的产品站。
- 需要 React Server Components。
- 需要 Next 自身作为 BFF 或全栈应用框架。
- 需要官方 streaming UI 能力深度集成。

MetricForge 第一阶段是内部数据平台，已有 FastAPI 后端和 API 层。直接引入 Next.js 会带来：

- Node 服务部署复杂度。
- BFF 与 FastAPI 权责划分问题。
- 鉴权和 API 代理重复设计。
- 对 MVP 迁移收益不够高。

因此建议：

- 第一阶段用 React + Vite SPA。
- 如果后续需要独立门户、多租户 SaaS、复杂服务端渲染或前端 BFF，再评估 Next.js。

## API 边界

现代前端只通过 API 与后端交互，不直接访问数据库。

建议 API 分层：

```text
/api/datasources/*
/api/metadata/*
/api/metadata/jobs/*
/api/governance/*
/api/field-semantics/*
/api/metrics/*
/api/sql/*
/api/ask/*
/api/reports/*
```

新增智能工作台 API：

### AI 问数

```text
POST /api/ask/sessions
GET  /api/ask/sessions/{id}
POST /api/ask/sessions/{id}/messages
GET  /api/ask/sessions/{id}/stream
```

### SQL 工作台

```text
POST /api/sql/validate
POST /api/sql/preview
POST /api/sql/execute
POST /api/sql/format
GET  /api/sql/history
POST /api/sql/templates
```

### 查询结果与图表

```text
GET  /api/query-results/{id}
POST /api/charts/suggest
POST /api/charts/render-spec
POST /api/reports
GET  /api/reports/{id}
```

### 任务实时状态

```text
GET /api/metadata/jobs/{id}
GET /api/metadata/jobs/{id}/events
```

`events` 可以先用 SSE，后续需要双向交互时再引入 WebSocket。

## 前端模块设计

### AI 问数工作台

职责：

- 展示对话历史。
- 支持流式输出。
- 渲染 Markdown。
- 渲染 SQL 代码块。
- 展示系统召回的指标、字段、表、SQL 模板。
- 对无法回答的问题创建治理待办。

核心组件：

```text
AskWorkbench
ConversationList
MessageThread
StreamingAnswer
ContextEvidencePanel
SqlCandidateBlock
GovernanceActionPanel
```

### SQL 开发工作台

职责：

- 编写 SQL。
- 语法高亮。
- 元数据联想。
- SQL 安全校验。
- 执行计划展示。
- 样例执行。
- 保存历史 SQL 或模板。

核心组件：

```text
SqlWorkbench
SqlEditor
MetadataExplorer
ValidationPanel
ExecutionPlanPanel
ResultGrid
SqlHistoryDrawer
```

### 查询结果与图表工作台

职责：

- 展示查询结果。
- 支持大结果集分页/虚拟滚动。
- 自动建议图表。
- 手动调整图表类型。
- 保存报表草稿。

核心组件：

```text
ResultExplorer
DataGrid
ChartSuggestionPanel
ChartPreview
ReportDraftPanel
```

### 元数据语义治理工作台

职责：

- 浏览元数据。
- 批量维护字段语义。
- 从治理待办跳转字段。
- 展示字段血缘/引用关系。
- 展示采集变更历史。

核心组件：

```text
MetadataWorkbench
TableTree
ColumnSemanticEditor
GovernanceTicketSidePanel
MetadataChangeTimeline
```

## 状态管理

推荐分层：

```text
Server state -> TanStack Query
UI state     -> Zustand 或 Jotai
Form state   -> Ant Design Form / React Hook Form
Editor state -> Monaco model
Streaming    -> SSE reader / EventSource
```

原则：

- 后端数据不要塞进全局 store。
- 查询结果、元数据、任务状态由 TanStack Query 管理。
- 当前打开的 panel、selected table、editor layout 由轻量 store 管理。
- 大对象如 SQL 文本和查询结果避免无意义全局复制。

## 部署方案

第一阶段推荐：

```text
frontend build -> static files
FastAPI 挂载 /app 静态入口
FastAPI 继续提供 /api 和 /web
```

开发模式：

```text
FastAPI: http://localhost:8000
Vite:    http://localhost:5173
```

Vite dev server 通过 proxy 调用 FastAPI：

```text
/api -> http://localhost:8000/api
```

生产模式：

```text
python app serves:
/web/*  Jinja
/api/*  API
/app/*  built frontend
```

这样不会立即引入额外 Node 生产服务。

## 迁移路线

### Phase 0: 保持现状并补 API 契约

目标：

- 不改变 UI 架构。
- 梳理 API response shape。
- 为现代前端准备稳定接口。

输出：

- API schema 清单。
- 关键响应 DTO。
- 认证和错误格式约定。

### Phase 1: 前端工程骨架

目标：

- 新建 `frontend/`。
- 打通 React + TypeScript + Vite。
- 接入 Ant Design。
- 接入 TanStack Query。
- 通过 proxy 调 FastAPI。
- 在 FastAPI 中挂载前端 build。

验收：

- `/app` 能打开。
- `/app/metadata/jobs` 能调用现有 `/api/metadata/jobs`。
- Jinja `/web` 不受影响。

### Phase 2: AI 问数工作台 MVP

目标：

- 对话输入。
- 流式输出。
- Markdown/SQL 代码块渲染。
- 显示召回上下文。
- 无法回答时创建治理待办。

验收：

- 可以创建问数 session。
- 可以看到流式回答。
- 可以从回答中的治理动作跳转治理待办。

### Phase 3: SQL 开发工作台 MVP

目标：

- Monaco SQL 编辑器。
- 元数据侧栏。
- SQL 校验。
- 样例执行。
- 结果表格。

验收：

- 可以编写 SQL。
- 可以校验 SQL。
- 可以查看校验错误。
- 可以执行受控 preview。
- 可以保存历史 SQL。

### Phase 4: 查询结果图表与报表草稿

目标：

- 查询结果表格。
- 图表建议。
- 图表预览。
- 报表草稿保存。

验收：

- 一份查询结果可生成图表建议。
- 用户可以选择图表并保存到报表草稿。

### Phase 5: 迁移高交互治理页面

目标：

- 字段语义治理编辑器迁移到 React。
- 元数据变更时间线。
- 治理待办侧栏联动。

验收：

- 从治理待办进入字段语义维护。
- 保存语义后关闭对应待办。
- 可以查看字段变更历史。

## 保留 Jinja 的范围

短期保留：

- `/web/dashboard`
- `/web/datasources`
- `/web/metadata`
- `/web/metadata/jobs`
- `/web/governance`
- `/web/metrics`

迁移条件：

- 页面交互复杂度明显上升。
- 页面需要局部更新或实时状态。
- 页面需要复杂组件。
- 页面需要和 AI/SQL 工作台深度联动。

## 风险与应对

### 风险 1: 双前端并存增加复杂度

应对：

- 明确 `/web` 是传统后台，`/app` 是智能工作台。
- 不在两个前端重复建设同一复杂页面。
- 先复用 API，不复制后端逻辑。

### 风险 2: API 契约不稳定

应对：

- 为现代前端新增 DTO 层。
- 对关键 API 增加测试。
- 前端使用 TypeScript 类型生成或手写稳定类型。

### 风险 3: 前端工程复杂度上升

应对：

- 第一阶段只引入必要依赖。
- 不引入微前端。
- 不引入过重状态管理。
- 不一次性引入 Next.js。

### 风险 4: AI 流式输出和任务状态混杂

应对：

- AI 输出使用 `/api/ask/*/stream`。
- 任务状态使用 `/api/metadata/jobs/{id}/events`。
- 两类 streaming 协议分开设计。

### 风险 5: 权限与数据安全

应对：

- 前端不直接持有数据库凭据。
- SQL 执行只能走后端安全校验。
- 查询结果分页/脱敏由后端控制。
- 前端只展示后端授权后的数据。

## 测试策略

### 后端

- 保持现有 pytest。
- 为新增 API 增加契约测试。
- 为 streaming 增加集成测试。

### 前端

- 单元测试：
  - Vitest
  - React Testing Library
- E2E:
  - Playwright
- 重点覆盖：
  - AI 对话流式渲染。
  - SQL 校验错误展示。
  - Monaco 编辑器加载。
  - 查询结果表格。
  - 图表渲染。
  - API 错误状态。

### 视觉和交互验证

每次新增核心工作台页面，至少验证：

- 桌面布局。
- 窄屏布局。
- 空状态。
- 加载状态。
- 错误状态。
- 长文本/长 SQL。
- 大结果集。

## 成功标准

第一阶段成功标准：

- `frontend/` 可以独立开发运行。
- FastAPI 可以服务前端构建产物。
- `/web` 旧后台不受影响。
- `/app` 新工作台能访问 API。
- 至少一个高交互页面不再使用 Jinja 实现。

中期成功标准：

- AI 问数对话体验达到可演示水平。
- SQL 编辑器可用。
- 查询结果可表格/图表展示。
- 治理待办可以从智能工作台回流。

长期成功标准：

- MetricForge 的核心用户工作流在现代前端完成。
- Jinja 只承担低交互后台配置。
- 前端组件形成稳定复用层。
- API 契约清晰，前后端可以并行开发。

## 推荐下一步

推荐进入 `superpowers:writing-plans`，为以下阶段写实施计划：

```text
MetricForge 现代前端基础骨架实施计划
```

计划应覆盖：

- 创建 `frontend/`。
- React + TypeScript + Vite 初始化。
- Ant Design 接入。
- TanStack Query 接入。
- FastAPI 静态挂载 `/app`。
- Vite dev proxy。
- 第一个 API demo 页面。
- CI/测试命令。

不建议下一步直接做 AI 问数完整工作台。先打好前端工程骨架，再进入 AI 工作台。

## 用户确认点

在写实施计划前，需要确认：

1. 是否接受推荐选型：`React + TypeScript + Vite + Ant Design`。
2. 是否使用 `/app/*` 作为现代前端入口。
3. 是否保留 `/web/*` 作为传统后台。
4. 是否第一阶段只做前端骨架和一个 API demo 页面，不做完整 AI 问数。
