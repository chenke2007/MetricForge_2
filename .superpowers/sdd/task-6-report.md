# Task 6: Page Integration — IntentCard + AskWorkbenchPage 集成

**日期:** 2026-07-05
**Branch:** main
**Commit:** 768530c

---

## 执行概要

完成 Phase 5H Task 6：将 ContextChain + ProcessPanel 集成到 IntentCard 和 AskWorkbenchPage，实现追问上下文追踪和多轮对话 UI 交互。

## 修改文件

| 文件 | 变更 | 说明 |
|------|------|------|
| [IntentCard.tsx](../../frontend/src/components/IntentCard.tsx) | 修改 | 添加 `processInsight` optional prop + `ProcessPanel` 集成 |
| [IntentCard.test.tsx](../../frontend/src/components/IntentCard.test.tsx) | 修改 | 添加 2 个 ProcessPanel 集成测试 |
| [AskWorkbenchPage.tsx](../../frontend/src/pages/AskWorkbenchPage.tsx) | 修改 | 添加 context tracking、follow-up indicator bar、"新会话"按钮、ContextChain 渲染 |
| [AskWorkbenchPage.test.tsx](../../frontend/src/pages/AskWorkbenchPage.test.tsx) | 修改 | Mock ContextChain 组件，确保 9 个测试全部通过 |

## 实现细节

### IntentCard.tsx
- 添加 `processInsight?: ProcessInsight` optional prop
- 在 semantic gaps 部分后插入 `{processInsight && <ProcessPanel process={processInsight} />}`
- 向后兼容：不传 `processInsight` 时无任何 UI 变化

### AskWorkbenchPage.tsx
- **Context tracking state**: `contextChain`, `processInsight`, `isFollowUpMode` + `contextChainRef`（useRef 避免 stale closure）
- **buildProcessInsight()**: 从 response + prevChain 构建 `ProcessInsight` 对象
- **getFollowUpStrategyLabel()**: FollowUpType → 中文分析策略标签映射
- **handleSend 中的 context 更新**: 检测 `followUp` 字段，构建新 context chain，存入 responseHistory
- **Follow-up indicator bar**: 蓝色指示条显示"基于上一轮继续分析" + 上一轮问题摘要 + "新会话"按钮
- **ContextChain**: 当 `contextChain.length > 1` 时渲染
- **IntentCard**: 传入 `processInsight`

### IntentCard.test.tsx (新增 2 个测试)
1. ✅ renders AI 理解过程 toggle when processInsight provided
2. ✅ does not render AI 理解过程 when processInsight is undefined

### AskWorkbenchPage.test.tsx
- Mock ContextChain 组件

## 验证结果

### 测试（4 个文件，28 个测试全部通过）
```
 ✓ src/components/ContextChain.test.tsx (4 tests)
 ✓ src/components/ProcessPanel.test.tsx (6 tests)
 ✓ src/components/IntentCard.test.tsx (9 tests)
 ✓ src/pages/AskWorkbenchPage.test.tsx (9 tests)
```

### TypeScript (`npx tsc --noEmit`)
```
通过 — 无类型错误
```

## 约束检查

| 约束 | 状态 |
|------|------|
| 不硬编码 dwhrpt | ✅ 无新增 hardcoded dwhrpt |
| 单轮问数路径不回归 | ✅ context chain 仅在有 followUp 时追加 |
| SQL Workbench 不改核心逻辑 | ✅ 仅传递下游验证 |
| 不新增后端 API/DB/migration | ✅ |
| 不接真实 LLM | ✅ |
| 不引入 Playwright/Cypress | ✅ |
| 不处理 Phase 4 untracked docs | ✅ |

## 自检清单

- [x] 所有新增 optional 字段向后兼容
- [x] context chain 使用 useRef 避免 stale closure
- [x] "新会话"按钮仅清除本地 context 状态
- [x] 没有修改 store / 后端
- [x] ProcessPanel 默认折叠
- [x] ContextChain 空输入返回 null
