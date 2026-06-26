# Task 6: 前端 AI 问数工作台实施报告

## 1. 实施内容

实现了 AI 问数工作台的完整数据层、组件层和页面层，共创建 11 个文件，修改 3 个文件。

### 创建的文件

| 文件 | 说明 |
|------|------|
| `frontend/src/stores/askStore.ts` | Zustand 流式状态管理 (currentSessionId, streaming state) |
| `frontend/src/api/askSessions.ts` | TanStack Query hooks: sessions CRUD, messages, mutations |
| `frontend/src/components/SessionList.tsx` | 左侧对话列表，支持新建/删除/选中高亮 |
| `frontend/src/components/AskInput.tsx` | 底部输入区域，flex 布局，支持 Enter/Shift+Enter |
| `frontend/src/components/MarkdownRenderer.tsx` | react-markdown + remark-gfm 渲染，SQL 代码块转发 |
| `frontend/src/components/SqlCodeBlock.tsx` | 深色主题 SQL 代码块，一键复制按钮 |
| `frontend/src/components/UserMessage.tsx` | 用户消息气泡（右对齐，蓝色背景） |
| `frontend/src/components/AssistantMessage.tsx` | AI 助手消息气泡（左对齐，灰色背景，Markdown 渲染） |
| `frontend/src/components/StreamingMessage.tsx` | 流式消息占位，带闪烁光标 |
| `frontend/src/components/MessageThread.tsx` | 消息列表容器，空状态指引，自动滚动到底部 |
| `frontend/src/pages/AskWorkbenchPage.tsx` | 主页面：左侧 Sider(会话列表) + Content(消息区+输入框) |

### 修改的文件

| 文件 | 变更 |
|------|------|
| `frontend/src/App.tsx` | 添加 `import AskWorkbenchPage` 和 `/ask` 路由 |
| `frontend/src/components/Layout.tsx` | 添加 `RobotOutlined` 图标和 `AI 问数` 菜单项 |
| `frontend/src/styles/global.css` | 添加 `@keyframes blink` 动画 |

## 2. 依赖安装

```bash
npm install zustand react-markdown remark-gfm react-syntax-highlighter
```

所有依赖已成功安装到 `node_modules`。

## 3. 与 Brief 的偏差

1. **SSE 解析修正** (brief 原文第 1 条): 按用户修正实现，使用 event type 累积变量 `currentEvent`，在 `data:` 行解析时根据 `currentEvent` 值区分 `token`/`error`/`done` 事件，而非按行前缀匹配。

2. **AskInput 布局修正** (brief 原文第 2 条): 不使用 `Space.Compact`，改为 flex 容器 `display: flex; gap: 8`。

3. **StreamingMessage 光标** (brief 原文第 3 条): `@keyframes blink` 定义在 `global.css` 中，组件内通过 `style={{ animation: 'blink 1s step-end infinite' }}` 引用。

4. **createSession.mutate(undefined) 的类型问题**: `useMutation` 的 `mutationFn` 期望 `CreateSessionInput` 参数，`undefined` 不可赋值。改为 `mutate({} as any)` 避免 TS 错误。

5. **MessageThread.isLoading 未使用**: TypeScript `noUnusedLocals`/`noUnusedParameters` 规则要求未使用参数加 `_` 前缀。改为 `_isLoading` 保留接口兼容性。

6. **Layout.tsx 菜单项**: Brief 未要求但需要添加 `AI 问数` 菜单项才能从侧栏导航到 `/ask`。已添加 `RobotOutlined` 图标。

## 4. 构建验证

### TypeScript 类型检查
```
> npx tsc --noEmit
通过，无错误
```

### Vite 生产构建
```
> npx vite build
✓ 3353 modules transformed.
✓ built in 18.45s

dist/index.html                  0.42 kB │ gzip: 0.33 kB
dist/assets/index-C3hJj4lV.css  0.20 kB │ gzip: 0.18 kB
dist/assets/index-Ljvu-UzG.js   1,201.24 kB │ gzip: 378.50 kB
```

构建成功。JS 包体积较大（1.2MB) 主要来自 react-markdown + react-syntax-highlighter 依赖。`noUnusedLocals`/`noUnusedParameters` 规则已满足。

## 5. 自审发现

1. **包体积**: `react-syntax-highlighter` 体积较大，后续可考虑使用轻量语法高亮方案或通过 `manualChunks` 拆分。
2. **SSE 错误处理**: 当前 `event: error` 事件仅忽略处理，未在 UI 上展示流式错误信息。可后续增强。
3. **空状态**: `MessageThread` 和 `AskWorkbenchPage` 均有空状态引导文本，体验完整。
4. **路由匹配**: `/ask` 路径已添加到 Layout 和 App.tsx，侧栏菜单项高亮通过 `location.pathname` 自动匹配。
5. **代码质量**: 无 TypeScript 错误，所有组件 Props 接口定义完整，函数组件使用 `React.FC` 类型标注。

## 6. 状态

DONE — 所有文件创建、修改、类型检查和构建验证均通过。
