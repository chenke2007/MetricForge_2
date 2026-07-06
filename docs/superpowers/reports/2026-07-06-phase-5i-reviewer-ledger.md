# Phase 5I — Reviewer Ledger

日期：2026-07-06

## Known Gaps (追认记录)

### Gap #1: CompressHistoryOptions.retainFields 暂未消费

**文件**: `frontend/src/api/aiAsk/contextPolicy.ts`

**现状**：
- `CompressHistoryOptions.retainFields` 接口已定义（`contextPolicy.ts:90-93`），但其值在 `compressHistory` 函数体（`contextPolicy.ts:95-116`）中未被读取或应用。
- `compressHistory` 仅从 options 解构 `level`，忽略 `retainFields`。

**影响**：当前无实际影响。所有调用方均未传入 `retainFields`（通过 `index.ts` 导出，仅在 benchmark 或未来集成时使用）。

### Gap #2: buildMessageHistory 的 compressionLevel / retainFields 暂未应用

**文件**: `frontend/src/api/aiAsk/contextPolicy.ts`

**现状**：
- `buildMessageHistory`（`contextPolicy.ts:17-34`）接收 `ContextPolicyConfig`，但仅使用 `maxHistoryLength`。
- `compressionLevel` 和 `retainFields` 参数被接收但从未传递到 `compressHistory` 或 `compressResponse` 调用链。

**影响**：当前无实际影响。MVP 阶段 `buildMessageHistory` 仅构造单轮历史，不涉及压缩；压缩由调用方自行选择时机调用。

### 处置方案

由 **Task 6 final review** 决定：
- **Option A**: 删除 `retainFields` 和 `compressionLevel` 参数（简化接口）
- **Option B**: 补齐消费路径（`buildMessageHistory` 在适当压缩时机调用 `compressHistory`）
