# AI 问数工作台 — 设计文档

> **Phase 2** of Modern Frontend Evolution Plan

**目标：** 构建 AI 问数对话工作台 MVP，包含 LLM 连接管理子系统 + 对话问数子系统，实现自然语言查询融资租赁数据仓库的能力。

**前置依赖：** Phase 1 前端骨架已完成，`frontend/` 运行在 React 18 + TypeScript + Vite 5 + Ant Design 5 + TanStack Query 5 之上。

---

## 架构概览

```text
Frontend (React /app/)
├── /app/llm-settings        LLM 连接管理页面
├── /app/ask                  AI 问数对话工作台

API (FastAPI /api/)
├── /api/llm-settings/*       LLM 配置 CRUD + 连接测试 + 启用切换
├── /api/ask/sessions/*       问数会话管理
├── /api/ask/sessions/{id}/stream   SSE 流式输出

Backend Services
├── LlmSettingsService        配置管理（加密存储、连接测试、active 切换）
├── AskService                问数编排（上下文构建、LLM 调用、SSE 流式输出）

Database Tables
├── llm_settings              加密存储 LLM 连接配置
├── ask_sessions              问数会话
└── ask_messages              对话消息
```

---

## 非目标（MVP 边界）

- 不执行 AI 生成的真实 SQL。
- 不引入向量库或完整 RAG pipeline。
- 不引入 WebSocket（SSE 足够）。
- 不实现 SQL 校验、预览、执行（留待 Phase 3 SQL 工作台）。
- 不实现多租户权限体系。

---

## 1. LLM 连接管理

### 1.1 数据模型

```sql
CREATE TABLE llm_settings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    base_url        TEXT NOT NULL,
    api_key         TEXT NOT NULL,
    api_key_salt    TEXT NOT NULL,
    model_name      TEXT NOT NULL,
    is_active       INTEGER NOT NULL DEFAULT 0,
    last_tested_at  DATETIME,
    last_tested_ok  INTEGER,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

约束：
- `is_active` 最多一条记录为 1（应用层保证，涉及旧记录置 0 和新记录置 1 在同一事务中）。
- `api_key` 使用 `cryptography.fernet` 加密，加密密钥从环境变量 `METRICFORGE_ENC_KEY` 读取；未设置时启动告警。
- API Key **永不**在 API 响应中明文返回。

### 1.2 API 契约

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/api/llm-settings` | 列表（key 返回 masked: `sk-****Laz2y`） |
| `POST` | `/api/llm-settings` | 创建（接收明文 key，存储加密） |
| `GET` | `/api/llm-settings/{id}` | 详情（key 返回 masked） |
| `PUT` | `/api/llm-settings/{id}` | 更新（key 为空则不修改已有 key） |
| `DELETE` | `/api/llm-settings/{id}` | 删除 |
| `POST` | `/api/llm-settings/{id}/test` | 连接测试 → `{ok, model, latency_ms, error?}` |
| `POST` | `/api/llm-settings/{id}/activate` | 启用（其他置 0，当前置 1） |

#### POST /api/llm-settings — 请求体

```json
{
  "name": "DeepSeek V4 生产",
  "base_url": "http://uat-unifyapi.utflc.com:8080",
  "api_key": "sk-VaZuwZGRVwOSBjgLcM2WEHnwIm6swCgOkydtp2L6uEMLaz2y",
  "model_name": "DeepSeek-V4-Flash"
}
```

#### POST /api/llm-settings — 响应体

```json
{
  "id": 1,
  "name": "DeepSeek V4 生产",
  "base_url": "http://uat-unifyapi.utflc.com:8080",
  "api_key_masked": "sk-****Laz2y",
  "model_name": "DeepSeek-V4-Flash",
  "is_active": true,
  "last_tested_at": null,
  "last_tested_ok": null,
  "created_at": "2026-06-24T12:00:00"
}
```

#### POST /api/llm-settings/{id}/test — 响应体

```json
{
  "ok": true,
  "model": "DeepSeek-V4-Flash",
  "latency_ms": 320,
  "error": null
}
```

失败时：
```json
{
  "ok": false,
  "model": null,
  "latency_ms": null,
  "error": "无法连接到服务器，请检查 Base URL"
}
```

**错误脱敏规则：**
- 网络连接失败 → `"无法连接到服务器，请检查 Base URL"`
- HTTP 401/403 → `"认证失败，请检查 API Key"`
- HTTP 404 → `"模型 'xxx' 不存在，请检查模型名"`
- 超时 → `"连接超时，请检查网络或服务器状态"`
- 其他 → `"连接测试失败（错误类型: {error_class}）"`

### 1.3 页面布局

**路由：** `/app/llm-settings`

**布局：**
```
┌──────────────────────────────────────────────────────────┐
│  LLM 连接管理                           [+ 添加配置]     │
├──────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────┐ │
│ │ [● 已启用] DeepSeek V4 生产                          │ │
│ │   Base URL: http://uat-unifyapi.utflc.com:8080       │ │
│ │   Model: DeepSeek-V4-Flash                           │ │
│ │   API Key: sk-****Laz2y   [测试] [停用] [编辑] [删除] │ │
│ │   ✅ 上次测试: 2026-06-24 12:00 (320ms)               │ │
│ ├──────────────────────────────────────────────────────┤ │
│ │ [○ 停用] Qwen 2.5 开发环境                            │ │
│ │   Base URL: http://192.168.1.50:8000/v1              │ │
│ │   Model: qwen2.5-72b-instruct                        │ │
│ │   API Key: sk-****Demo                               │ │
│ │   ❌ 未测试     [测试] [启用] [编辑] [删除]            │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

**核心组件：**

| 组件 | 职责 |
|------|------|
| `LlmSettingsPage` | 页面容器，Card 列表 + "添加配置"按钮 |
| `LlmSettingCard` | 单条配置卡片（状态徽标、关键信息、操作行） |
| `LlmSettingFormModal` | 新增/编辑弹窗（Ant Design Modal + Form） |
| `TestConnectionButton` | 测试按钮组件：点击→loading→结果反馈（成功/失败） |

**表单字段（LlmSettingFormModal）：**

| 字段 | 组件 | 说明 |
|------|------|------|
| 名称 | `Input` | 必填，最大 50 字符 |
| Base URL | `Input` | 必填，URL 格式校验 |
| API Key | `Input.Password` | 编辑时留空（不修改则保持原值） |
| 模型名 | `Input` | 必填 |

**组件状态：**

| 状态 | 行为 |
|------|------|
| 加载中 | `<Spin />` 居中显示 |
| 列表为空 | `<Empty />` 提示"尚未配置 LLM 连接，点击上方按钮添加" |
| 测试连接中 | 按钮显示 loading 旋转 |
| 测试成功 | `<message.success />` 显示延迟 |
| 测试失败 | `<message.error />` 显示脱敏错误 |

---

## 2. AI 问数对话工作台

### 2.1 数据模型

```sql
CREATE TABLE ask_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL DEFAULT '新对话',
    llm_setting_id  INTEGER REFERENCES llm_settings(id),
    model_name      TEXT NOT NULL,
    message_count   INTEGER NOT NULL DEFAULT 0,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ask_messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      INTEGER NOT NULL REFERENCES ask_sessions(id),
    role            TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content         TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'completed'
                    CHECK(status IN ('pending', 'streaming', 'completed', 'failed')),
    error_message   TEXT,
    tokens_prompt   INTEGER,
    tokens_completion INTEGER,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**消息状态机：**
```
user:    created → completed（立即落库）
assistant: pending → streaming → completed
                         ↘ → failed
```

### 2.2 SSE 消息生命周期

```
用户发送问题

Step 1: POST /api/ask/sessions/{id}/messages  {content: "..."}
  → 创建 user 消息（status=completed）
  → 创建 assistant 占位消息（status=pending, content=''）
  → 返回 { user_message_id, assistant_message_id, session_id }

Step 2: GET /api/ask/sessions/{id}/stream?after={assistant_message_id}
  → SSE 事件流：

  event: meta
  data: {"message_id": 42, "model": "DeepSeek-V4-Flash", "started_at": "..."}

  event: token
  data: {"delta": "根据"}

  event: token
  data: {"delta": "数据仓库"}

  event: token
  data: {"delta": "记录，"}

  ...

  event: done
  data: {"message_id": 42, "tokens_prompt": 1250, "tokens_completion": 348}

  或：

  event: error
  data: {"message_id": 42, "error": "LLM 调用超时，请稍后重试"}

Step 3: 流结束后
  成功 → 更新 assistant 消息 content + status=completed + token 用量
  失败 → 更新 assistant 消息 status=failed + error_message（脱敏）
```

**重连策略：**
- 前端监测 SSE 断连后，自动重连 `GET /stream?after={message_id}`。
- 后端对 `status=streaming` 且超过 120 秒无新 token 的消息标记为 `failed`（超时兜底）。

### 2.3 API 契约

#### 会话管理

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/api/ask/sessions` | 列表（updated_at 倒序，含首条消息摘要） |
| `POST` | `/api/ask/sessions` | 创建会话 |
| `GET` | `/api/ask/sessions/{id}` | 详情 + 消息列表 |
| `PUT` | `/api/ask/sessions/{id}` | 更新标题 |
| `DELETE` | `/api/ask/sessions/{id}` | 删除会话及所有消息 |

#### POST /api/ask/sessions — 请求体

```json
{
  "title": "本月合同到期分析",
  "llm_setting_id": 1
}
```

`llm_setting_id` 不传时默认使用当前启用的 LLM。

#### POST /api/ask/sessions — 响应体

```json
{
  "id": 1,
  "title": "本月合同到期分析",
  "llm_setting_id": 1,
  "model_name": "DeepSeek-V4-Flash",
  "message_count": 0,
  "created_at": "2026-06-24T12:00:00"
}
```

#### POST /api/ask/sessions/{id}/messages — 请求体

```json
{
  "content": "本月合同到期的租赁物有哪些？"
}
```

#### POST /api/ask/sessions/{id}/messages — 响应体

```json
{
  "user_message": { "id": 10, "role": "user", "content": "本月合同到期的租赁物有哪些？", "status": "completed", "created_at": "..." },
  "assistant_message": { "id": 11, "role": "assistant", "content": "", "status": "pending", "created_at": "..." }
}
```

### 2.4 上下文构建（轻量版 Schema Context）

当前阶段不引入向量 RAG，采用关键词匹配从现有元数据中检索上下文：

**检索来源：**
1. `datasource` 和 `metadata` 模块中的表名（从已采集的 DW/DWD/DWS/ADS 表）
2. 字段语义（已注册的业务术语和口径）
3. 指标口径（已注册的业务指标名称和计算口径）

**构建逻辑：**
```
1. 从用户问题中提取关键词（分词或简单匹配）
2. 匹配表名 → 返回表结构（字段名 + 类型 + 注释）
3. 匹配字段语义 → 返回业务术语说明
4. 匹配指标口径 → 返回指标名称和口径
5. 组装 system prompt：

   "你是 MetricForge 数据分析助手。
    当前数据仓库包含以下表：
    {匹配的表结构}
    
    业务字段语义：
    {匹配的字段语义}
    
    指标口径：
    {匹配的指标口径}
    
    请基于以上数据回答用户问题。回答中可以通过 SQL 代码块展示查询逻辑，
    但不要直接执行任何 SQL。"
```

**Token 预算控制：**
- 计算 system prompt token 数，超过模型 max_context 的 60% 时截断（优先保留指标口径 > 字段语义 > 表结构）。

### 2.5 页面布局

**路由：** `/app/ask`

**布局（两栏）：**

```
┌─────────────────────────────────────────────────────────────────────┐
│ ┌──────────────┐ ┌──────────────────────────────────────────────┐  │
│ │  对话历史     │ │  AI 问数工作台     DeepSeek-V4-Flash [●]    │  │
│ │              │ │                                               │  │
│ │ [+ 新对话]   │ │  ┌─────────────────────────────────────────┐  │  │
│ │              │ │  │ user: 本月合同到期的租赁物有哪些？       │  │  │
│ │ ● 本月合同   │ │  └─────────────────────────────────────────┘  │  │
│ │   到期分析   │ │  ┌─────────────────────────────────────────┐  │  │
│ │              │ │  │ assistant: 根据 DW_CONTRACT 表，本月    │  │  │
│ │ 去年营收     │ │  │ 到期的合同共 **15** 份，涉及以下租赁物:  │  │  │
│ │ 趋势分析    │ │  │                                          │  │  │
│ │              │ │  │ ```sql                                 │  │  │
│ │ 新增供应商   │ │  │ SELECT c.contract_code, c.lessee_name, │  │  │
│ │ 清单        │ │  │        a.asset_name                     │  │  │
│ │              │ │  │ FROM DW_CONTRACT c                      │  │  │
│ │ ...          │ │  │ JOIN DW_ASSET a ON c.id=a.contract_id  │  │  │
│ │              │ │  │ WHERE c.end_date BETWEEN ...            │  │  │
│ │              │ │  │ ```                                    │  │  │
│ │              │ │  │                                        │  │  │
│ │              │ │  │ 📊 **关键数据：**                       │  │  │
│ │              │ │  │ - 到期合同: 15 份                       │  │  │
│ │              │ │  │ - 涉及租赁物: 23 项                     │  │  │
│ │              │ │  └─────────────────────────────────────────┘  │  │
│ │              │ │                                               │  │
│ │              │ │  ┌─────────────────────────────────────────┐  │  │
│ │              │ │  │  输入问题...              [发送] 🔍     │  │  │
│ │              │ │  └─────────────────────────────────────────┘  │  │
│ └──────────────┘ └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**布局特征：**
- 左侧栏 280px，右侧为主区域
- 左侧栏可折叠（窄屏时自动隐藏）
- 消息区域自动滚动到底部
- 输入区固定在底部

### 2.6 核心组件

| 组件 | 职责 |
|------|------|
| `AskWorkbenchPage` | 页面容器：管理两栏布局协调 |
| `SessionList` | 左栏：对话列表（新建、选中高亮、删除） |
| `SessionHeader` | 顶部：标题 + 当前模型名称 + 状态指示 |
| `MessageThread` | 消息流容器：滚动管理、自动滚底 |
| `UserMessage` | 用户消息气泡（右对齐） |
| `AssistantMessage` | 助手消息气泡：完整 Markdown 渲染 |
| `StreamingMessage` | 流式消息：逐 token 追加，实时渲染 Markdown |
| `MarkdownRenderer` | Markdown 渲染（react-markdown + remark-gfm） |
| `SqlCodeBlock` | SQL 代码块：语法高亮（prism-react-renderer）+ 复制按钮 |
| `ContextEvidencePanel` | 上下文引用面板（可选展开）：召回的指标/字段/表列表 |
| `AskInput` | 底部输入区：`Input.TextArea` + 发送按钮，支持 Enter 发送 |

### 2.7 组件状态矩阵

**AskWorkbenchPage / SessionList：**

| 状态 | 行为 |
|------|------|
| 加载中 | `<Spin />` |
| 无会话 | `<Empty />` "暂无对话，点击'+ 新对话'开始" |
| 有会话 | 正常列表 |
| 加载失败 | `<Alert type="error" />` |

**MessageThread：**

| 状态 | 行为 |
|------|------|
| 空会话 | 欢迎提示："你好！我是 MetricForge 数据分析助手，请问有什么可以帮助你的？" |
| 正常消息列表 | 渲染消息 |
| 流式输出中 | 底部追加 `StreamingMessage`，实时滚动 |
| SSE 断连 | 自动重连，显示 "重连中..." 指示器 |
| LLM 错误 | `AssistantMessage` 显示错误提示（脱敏），可选"重新生成" |

**AskInput：**

| 状态 | 行为 |
|------|------|
| 空闲 | 文本输入框 + 发送按钮 |
| 发送中 | 按钮 loading，输入框 disabled |
| 无可用 LLM | 按钮 disabled，提示"请先在 LLM 连接管理中启用一个模型" |
| 空输入 | 按钮 disabled |

### 2.8 Markdown 渲染策略

**库选型：**
- `react-markdown` + `remark-gfm`：核心渲染
- `prism-react-renderer`：代码块语法高亮
- 自定义 `SqlCodeBlock`：为 `sql` 语言的代码块提供增强能力（语法高亮 + 复制按钮 + 后续入口）

**安全规则：**
- `rehype-sanitize`：过滤 HTML 标签和属性
- 图片标签渲染为纯文本链接
- 禁止 iframe、script、style 标签
- URL 自动转为纯文本

---

## 3. 后端服务设计

### 3.1 LlmSettingsService

```
class LlmSettingsService:
    - list() → List[LlmSettingResponse]
    - create(CreateLlmSettingRequest) → LlmSettingResponse
    - get(id) → LlmSettingResponse
    - update(id, UpdateLlmSettingRequest) → LlmSettingResponse
    - delete(id) → None
    - test_connection(id) → TestConnectionResponse
    - activate(id) → LlmSettingResponse
    - get_active() → LlmSetting | None          # 获取当前启用配置
```

加密层：
```
class KeyEncryption:
    - encrypt(plaintext: str) → tuple[ciphertext, salt]
    - decrypt(ciphertext: str, salt: str) → str
```

### 3.2 AskService

```
class AskService:
    - list_sessions() → List[SessionSummary]
    - create_session(CreateSessionRequest) → SessionResponse
    - get_session(id) → SessionDetailResponse (with messages)
    - update_session(id, UpdateSessionRequest) → SessionResponse
    - delete_session(id) → None
    - create_message(session_id, content) → CreateMessageResponse
    - stream_response(session_id, after_message_id) → AsyncGenerator[SSEEvent]
```

`stream_response` 核心流程：
```
1. 获取 session 和当前启用的 LLM Setting
2. 构建 system prompt（含 Schema Context）
3. 收集历史消息（user + assistant）
4. 更新 assistant 占位消息 status → streaming
5. 调用 openai.ChatCompletion.create(stream=True)
6. 逐块 yield token 事件
7. 流完成 → 更新 status → completed，记录 token 用量
8. 异常 → 更新 status → failed，记录脱敏错误
```

---

## 4. 安全约束

| 约束 | 实现方式 |
|------|----------|
| API Key 加密存储 | `cryptography.fernet`，密钥来自环境变量 |
| API Key 不回显 | 响应中仅返回 masked: `sk-****{last4}` |
| 编辑时不清除 | PUT 时 key 为空表示不修改 |
| 错误脱敏 | 连接测试和 SSE 错误均经过脱敏处理 |
| HTML 过滤 | Markdown 渲染使用 `rehype-sanitize` |
| 图片安全 | 不渲染图片和 iframe |

---

## 5. 测试策略

| 层 | 工具 | 覆盖范围 |
|----|------|----------|
| Backend unit | pytest | LlmSettingsService CRUD + 加密/解密 |
| Backend API | pytest + TestClient | LLM 配置 CRUD API、消息创建、SSE 模拟 |
| Backend integration | pytest + mock LLM | SSE 流式输出测试（mock OpenAI） |
| Frontend unit | Vitest + RTL | LlmSettingsFormModal 表单验证、AskInput 状态 |
| Frontend component | Vitest + RTL | StreamingMessage 逐块渲染、SqlCodeBlock 语法高亮 |
| Frontend hook | Vitest | useSessions/useMessages TanStack Query hooks |

---

## 6. 文件结构

```
frontend/src/
├── api/
│   ├── client.ts                    # 已有
│   ├── metadataJobs.ts              # 已有
│   ├── llmSettings.ts               # 新增：LLM 配置 hooks
│   └── askSessions.ts               # 新增：问数会话 hooks
├── pages/
│   ├── MetadataJobsPage.tsx         # 已有
│   ├── LlmSettingsPage.tsx          # 新增
│   └── AskWorkbenchPage.tsx         # 新增
├── components/
│   ├── Layout.tsx                   # 已有（需加菜单项）
│   ├── LlmSettingCard.tsx           # 新增
│   ├── LlmSettingFormModal.tsx      # 新增
│   ├── SessionList.tsx              # 新增
│   ├── MessageThread.tsx            # 新增
│   ├── UserMessage.tsx              # 新增
│   ├── AssistantMessage.tsx         # 新增
│   ├── StreamingMessage.tsx         # 新增
│   ├── MarkdownRenderer.tsx         # 新增
│   ├── SqlCodeBlock.tsx             # 新增
│   └── AskInput.tsx                 # 新增
├── stores/
│   └── askStore.ts                  # 新增（Zustand：当前 session、streaming 状态）

app/
├── api/
│   ├── llm_settings.py              # 新增：LLM 配置 API 路由
│   └── ask.py                       # 新增：问数 API 路由（含 SSE）
├── services/
│   ├── key_encryption.py            # 新增：API Key 加密工具
│   ├── llm_settings_service.py      # 新增：LLM 配置服务
│   └── ask_service.py               # 新增：问数编排服务
├── models/
│   └── ask_models.py                # 新增：SQLAlchemy 模型
```

---

## 7. 忽略的文件（不追踪）

- 不提交 `DESIGN-vercel.md`、`reports/`
- 不提交 `frontend/node_modules/`、`frontend/dist/`
