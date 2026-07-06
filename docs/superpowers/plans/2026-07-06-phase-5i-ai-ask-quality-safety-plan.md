# Phase 5I AI 问数质量与安全保障 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 AI 问数能力基础上建立 Input Guard、Context Policy、Error Recovery、Benchmark Runner 四道防线，不新增功能、不改协议、不接真实 LLM。

**Architecture:** 新增两个纯函数模块（`inputGuard`、`contextPolicy`）由 `AskInput` 与 `AskWorkbenchPage` 双层调用；新增 `ResultTruncatedNotice` 组件显示截断提示；新增独立 `tsx` benchmark 脚本输出 JSON 质量报告；所有改动集中于 `frontend/src/api/aiAsk` 与 `frontend/src/components`。

**Tech Stack:** React + TypeScript + Ant Design + Vite/Vitest + tsx (benchmark runner)

## Global Constraints

- 不 push、不 PR
- 不处理历史 untracked 文件
- 不新增后端 API/DB/migration
- 不接真实 LLM
- 不引入 Playwright/Cypress
- 不修改 Monaco DOM 测试
- SQL Workbench 仍不是主入口
- Input Guard 为共享纯函数，`AskInput` 实时反馈 + `AskWorkbenchPage.handleSend` 最终阻断
- Context Policy 为纯函数，不修改 `aiAskStore`
- 不改变 `AiAskAdapter.analyze()` 返回协议（不引入 `{error, fallback}`）
- 不新增 `AiAskResponse` 字段
- Benchmark 为本地手动运行脚本，不接入 CI/Vitest
- MVP 超长输入阻断阈值：500 字符
- 追问置信度仅使用 `'high' | 'medium' | 'low'` 字符串，不写数值阈值

---

## File Structure

| Path | Responsibility | Change |
|------|---------------|--------|
| `frontend/src/api/aiAsk/inputGuard.ts` | 输入校验纯函数与常量 | 新增 |
| `frontend/src/api/aiAsk/inputGuard.test.ts` | Input Guard 单元测试 | 新增 |
| `frontend/src/api/aiAsk/contextPolicy.ts` | 上下文组装与压缩纯函数 | 新增 |
| `frontend/src/api/aiAsk/contextPolicy.test.ts` | Context Policy 单元测试 | 新增 |
| `frontend/src/api/aiAsk/index.ts` | 统一导出新增模块 | 修改 |
| `frontend/src/components/AskInput.tsx` | 实时校验反馈，不阻断发送按钮 | 修改 |
| `frontend/src/components/AskInput.test.tsx` | 更新测试以匹配新行为 | 修改 |
| `frontend/src/components/ResultTruncatedNotice.tsx` | `resultSummary.truncated` 提示条 | 新增 |
| `frontend/src/components/ResultTruncatedNotice.test.tsx` | 截断提示组件测试 | 新增 |
| `frontend/src/pages/AskWorkbenchPage.tsx` | 集成 Input Guard 阻断、Context Policy、截断提示 | 修改 |
| `frontend/package.json` | 添加 `tsx` devDependency 与 `benchmark` script | 修改 |
| `frontend/.gitignore` | 忽略 `scripts/benchmark-results/*.json` | 修改 |
| `frontend/scripts/runQualityBenchmarks.ts` | Benchmark 主入口，汇总并写 JSON 报告 | 新增 |
| `frontend/scripts/benchmarks/inputGuard.bench.ts` | Input Guard benchmark 用例 | 新增 |
| `frontend/scripts/benchmarks/contextPolicy.bench.ts` | Context Policy benchmark 用例 | 新增 |
| `frontend/scripts/benchmarks/followUpDetector.bench.ts` | FollowUp Detector benchmark 用例 | 新增 |
| `frontend/scripts/benchmarks/adapter.bench.ts` | MockAdapter 多轮 benchmark 用例 | 新增 |
| `frontend/scripts/fixtures/multiRoundHistory.ts` | 多轮上下文 fixture 数据 | 新增 |
| `frontend/scripts/benchmark-results/.gitkeep` | 保留结果目录 | 新增 |

---

### Task 1: Input Guard 纯函数与测试

**Files:**
- Create: `frontend/src/api/aiAsk/inputGuard.ts`
- Create: `frontend/src/api/aiAsk/inputGuard.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `MAX_INPUT_LENGTH: 500`
  - `type InputGuardErrorCode = 'EMPTY_INPUT' | 'PUNCTUATION_ONLY' | 'TOO_LONG' | 'INVALID_CHARS'`
  - `interface InputValidationResult { valid: boolean; error?: { code: InputGuardErrorCode; message: string } }`
  - `function validateAiAskInput(question: string): InputValidationResult`

- [ ] **Step 1: Create `inputGuard.ts` with pure validation function**

```typescript
// frontend/src/api/aiAsk/inputGuard.ts

export interface InputValidationResult {
  valid: boolean
  error?: {
    code: InputGuardErrorCode
    message: string
  }
}

export type InputGuardErrorCode =
  | 'EMPTY_INPUT'
  | 'PUNCTUATION_ONLY'
  | 'TOO_LONG'
  | 'INVALID_CHARS'

export const MAX_INPUT_LENGTH = 500

function containsInvalidControlChars(input: string): boolean {
  for (const ch of input) {
    const code = ch.charCodeAt(0)
    if (code >= 0x00 && code <= 0x08) return true
    if (code === 0x0b || code === 0x0c) return true
    if (code >= 0x0e && code <= 0x1f) return true
    if (code === 0x7f) return true
  }
  return false
}

function isPunctuationOnly(input: string): boolean {
  const withoutWhitespace = input.replace(/\s/g, '')
  if (withoutWhitespace.length === 0) {
    return false
  }
  return [...withoutWhitespace].every((ch) => /\p{P}/u.test(ch))
}

export function validateAiAskInput(question: string): InputValidationResult {
  if (question.trim().length === 0) {
    return {
      valid: false,
      error: { code: 'EMPTY_INPUT', message: '请输入问题' },
    }
  }

  if (isPunctuationOnly(question)) {
    return {
      valid: false,
      error: { code: 'PUNCTUATION_ONLY', message: '请输入有效的问题，不能仅包含标点符号' },
    }
  }

  if (question.length > MAX_INPUT_LENGTH) {
    return {
      valid: false,
      error: { code: 'TOO_LONG', message: '问题过长，请缩短到 500 字以内' },
    }
  }

  if (containsInvalidControlChars(question)) {
    return {
      valid: false,
      error: { code: 'INVALID_CHARS', message: '输入包含无效字符' },
    }
  }

  return { valid: true }
}
```

- [ ] **Step 2: Create failing test file**

```typescript
// frontend/src/api/aiAsk/inputGuard.test.ts
import { describe, it, expect } from 'vitest'
import { validateAiAskInput, MAX_INPUT_LENGTH } from './inputGuard'

describe('validateAiAskInput', () => {
  it('accepts normal business question', () => {
    const result = validateAiAskInput('各区域近30天销售额')
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('returns EMPTY_INPUT for empty string', () => {
    const result = validateAiAskInput('')
    expect(result.valid).toBe(false)
    expect(result.error?.code).toBe('EMPTY_INPUT')
    expect(result.error?.message).toBe('请输入问题')
  })

  it('returns EMPTY_INPUT for whitespace-only string', () => {
    const result = validateAiAskInput('   ')
    expect(result.error?.code).toBe('EMPTY_INPUT')
  })

  it('returns PUNCTUATION_ONLY for Chinese punctuation only', () => {
    const result = validateAiAskInput('，，！？')
    expect(result.valid).toBe(false)
    expect(result.error?.code).toBe('PUNCTUATION_ONLY')
  })

  it('returns PUNCTUATION_ONLY for English punctuation only', () => {
    const result = validateAiAskInput('!@#$%^&*()_+')
    expect(result.error?.code).toBe('PUNCTUATION_ONLY')
  })

  it('returns EMPTY_INPUT for whitespace and newline only', () => {
    const result = validateAiAskInput('\n\t\n')
    expect(result.error?.code).toBe('EMPTY_INPUT')
  })

  it('returns TOO_LONG for 501 characters', () => {
    const result = validateAiAskInput('a'.repeat(MAX_INPUT_LENGTH + 1))
    expect(result.error?.code).toBe('TOO_LONG')
  })

  it('accepts exactly 500 characters', () => {
    const result = validateAiAskInput('a'.repeat(MAX_INPUT_LENGTH))
    expect(result.valid).toBe(true)
  })

  it('returns INVALID_CHARS for null byte', () => {
    const result = validateAiAskInput('abc\x00def')
    expect(result.error?.code).toBe('INVALID_CHARS')
  })

  it('accepts tabs and newlines inside normal text', () => {
    const result = validateAiAskInput('第一行\n第二行\t带制表符')
    expect(result.valid).toBe(true)
  })

  it('accepts long but valid question under limit', () => {
    const result = validateAiAskInput(
      '请分析2024年各区域销售额TOP10客户的分布情况并按产品线拆解毛利率变化趋势'
    )
    expect(result.valid).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests to verify they pass**

Run:
```bash
cd frontend
npx vitest run src/api/aiAsk/inputGuard.test.ts
```

Expected: 11 tests PASS.

- [ ] **Step 4: Commit**

```bash
cd d:/projects/MetricForge
git add frontend/src/api/aiAsk/inputGuard.ts frontend/src/api/aiAsk/inputGuard.test.ts
git commit -m "feat(phase-5i): add Input Guard pure function with validation rules and tests"
```

---

### Task 2: AskInput + AskWorkbenchPage 双层集成

**Files:**
- Modify: `frontend/src/components/AskInput.tsx`
- Modify: `frontend/src/components/AskInput.test.tsx`
- Modify: `frontend/src/pages/AskWorkbenchPage.tsx`
- Modify: `frontend/src/api/aiAsk/index.ts`

**Interfaces:**
- Consumes: `validateAiAskInput` from `inputGuard.ts`
- Produces:
  - `AskInput` displays real-time validation error below the textarea and no longer disables the send button based on input content.
  - `AskWorkbenchPage.handleSend` blocks invalid inputs via `message.error()` before creating sessions or calling `adapter.analyze()`.

- [ ] **Step 1: Export `validateAiAskInput` from the barrel file**

Modify `frontend/src/api/aiAsk/index.ts` to add these two lines after the existing `validateAiAskResponse` export:

```typescript
export { validateAiAskInput } from './inputGuard'
export type { InputValidationResult, InputGuardErrorCode } from './inputGuard'
```

- [ ] **Step 2: Modify `AskInput` for real-time validation feedback**

Replace the contents of `frontend/src/components/AskInput.tsx` with:

```typescript
// frontend/src/components/AskInput.tsx
import React, { useState, useEffect } from 'react'
import { Input, Button, Typography } from 'antd'
import { SendOutlined } from '@ant-design/icons'
import { validateAiAskInput } from '../api/aiAsk'

const { TextArea } = Input
const { Text } = Typography

interface AskInputProps {
  onSend: (content: string) => void
  loading?: boolean
  disabled?: boolean
  placeholder?: string
  initialValue?: string
  autoFocus?: boolean
}

const AskInput: React.FC<AskInputProps> = ({
  onSend,
  loading,
  disabled,
  placeholder = '用自然语言描述你的业务问题，例如：近 30 天各区域的销售额和同比增长',
  initialValue,
  autoFocus,
}) => {
  const [value, setValue] = useState(initialValue || '')
  const [inputError, setInputError] = useState<string | null>(null)

  useEffect(() => {
    if (initialValue !== undefined) {
      setValue(initialValue)
    }
  }, [initialValue])

  const handleValueChange = (next: string) => {
    setValue(next)
    if (next.trim().length === 0) {
      setInputError(null)
      return
    }
    const validation = validateAiAskInput(next)
    setInputError(validation.valid ? null : validation.error!.message)
  }

  const handleSend = () => {
    if (loading || disabled) return
    const trimmed = value.trim()
    onSend(trimmed)
    const validation = validateAiAskInput(value)
    if (validation.valid) {
      setValue('')
      setInputError(null)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <TextArea
          value={value}
          onChange={(e) => handleValueChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoSize={{ minRows: 2, maxRows: 6 }}
          autoFocus={autoFocus}
          style={{
            flex: 1,
            resize: 'none',
            borderRadius: 10,
            border: `1px solid ${inputError ? '#ff4d4f' : '#e0e0e0'}`,
            padding: '10px 14px',
            fontSize: 14,
            lineHeight: 1.6,
            background: '#fff',
            transition: 'border-color 0.2s, box-shadow 0.2s',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = inputError ? '#ff4d4f' : '#4E7BF5'
            e.currentTarget.style.boxShadow = inputError
              ? '0 0 0 2px rgba(255, 77, 79, 0.08)'
              : '0 0 0 2px rgba(78, 123, 245, 0.08)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = inputError ? '#ff4d4f' : '#e0e0e0'
            e.currentTarget.style.boxShadow = 'none'
          }}
          disabled={disabled}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={loading}
          disabled={loading || disabled}
          style={{
            height: 44,
            minWidth: 96,
            borderRadius: 10,
            border: 'none',
            fontSize: 14,
            fontWeight: 500,
            background:
              loading || disabled
                ? undefined
                : 'linear-gradient(135deg, #4E7BF5, #58B9FF)',
          }}
          onMouseEnter={(e) => {
            if (!loading && !disabled) {
              e.currentTarget.style.background =
                'linear-gradient(135deg, #3A6BE0, #4AADF0)'
            }
          }}
          onMouseLeave={(e) => {
            if (!loading && !disabled) {
              e.currentTarget.style.background =
                'linear-gradient(135deg, #4E7BF5, #58B9FF)'
            }
          }}
        >
          问数
        </Button>
      </div>
      {inputError && (
        <Text
          type="danger"
          style={{ display: 'block', marginTop: 6, fontSize: 13 }}
        >
          {inputError}
        </Text>
      )}
    </div>
  )
}

export default AskInput
```

- [ ] **Step 3: Update `AskInput.test.tsx` to match new behavior**

Replace `frontend/src/components/AskInput.test.tsx` with:

```typescript
// frontend/src/components/AskInput.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AskInput from './AskInput'

describe('AskInput', () => {
  it('renders textarea and send button', () => {
    render(<AskInput onSend={() => {}} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述你的业务问题/)
    expect(textarea).toBeInTheDocument()
    expect(screen.getByText('问数')).toBeInTheDocument()
  })

  it('renders custom placeholder', () => {
    render(<AskInput onSend={() => {}} placeholder="自定义占位文本" />)
    expect(screen.getByPlaceholderText('自定义占位文本')).toBeInTheDocument()
  })

  it('shows initial value when provided', () => {
    render(<AskInput onSend={() => {}} initialValue="上季度收入" />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    expect((textarea as HTMLTextAreaElement).value).toBe('上季度收入')
  })

  it('calls onSend and clears input on valid send', () => {
    const onSend = vi.fn()
    render(<AskInput onSend={onSend} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: '近 7 天销量' } })
    fireEvent.click(screen.getByText('问数'))
    expect(onSend).toHaveBeenCalledWith('近 7 天销量')
    expect((textarea as HTMLTextAreaElement).value).toBe('')
  })

  it('sends on Enter without Shift', () => {
    const onSend = vi.fn()
    render(<AskInput onSend={onSend} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: '本月收入' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
    expect(onSend).toHaveBeenCalledWith('本月收入')
  })

  it('does not send when loading', () => {
    const onSend = vi.fn()
    render(<AskInput onSend={onSend} loading />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: 'test' } })
    fireEvent.click(screen.getByText('问数'))
    expect(onSend).not.toHaveBeenCalled()
  })

  it('does not disable send button based on input content', () => {
    render(<AskInput onSend={() => {}} />)
    const button = screen.getByText('问数').closest('button')
    expect(button).not.toBeDisabled()
  })

  it('does not clear input when validation fails', () => {
    const onSend = vi.fn()
    render(<AskInput onSend={onSend} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: '   ' } })
    fireEvent.click(screen.getByText('问数'))
    expect(onSend).toHaveBeenCalledWith('')
    expect((textarea as HTMLTextAreaElement).value).toBe('   ')
  })

  it('shows real-time error for punctuation-only input', () => {
    render(<AskInput onSend={() => {}} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: '，，！' } })
    expect(screen.getByText(/不能仅包含标点符号/)).toBeInTheDocument()
  })

  it('shows real-time error for too-long input', () => {
    render(<AskInput onSend={() => {}} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: 'a'.repeat(501) } })
    expect(screen.getByText(/缩短到 500 字以内/)).toBeInTheDocument()
  })

  it('clears real-time error when input becomes valid', () => {
    render(<AskInput onSend={() => {}} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: '，，！' } })
    expect(screen.getByText(/不能仅包含标点符号/)).toBeInTheDocument()
    fireEvent.change(textarea, { target: { value: '各区域销售额' } })
    expect(screen.queryByText(/不能仅包含标点符号/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Integrate Input Guard into `AskWorkbenchPage.handleSend`**

In `frontend/src/pages/AskWorkbenchPage.tsx`:

1. Update the import from `'../api/aiAsk'` to include `validateAiAskInput`:

```typescript
import { useAiAskService, AiAskError, getAiAskErrorMessage, validateAiAskInput } from '../api/aiAsk'
```

2. Insert the Input Guard check at the very top of `handleSend`, before session creation:

```typescript
const handleSend = useCallback(async (content: string) => {
  // Phase 5I: Input Guard final blocking layer
  const validation = validateAiAskInput(content)
  if (!validation.valid) {
    message.error(validation.error.message)
    return
  }

  let sessionId = currentSessionId
  // ... rest of existing handleSend unchanged
```

The remainder of `handleSend` (session creation, message creation, adapter call, error handling) stays exactly as-is for this task.

- [ ] **Step 5: Run AskInput and related tests**

Run:
```bash
cd frontend
npx vitest run src/components/AskInput.test.tsx
```

Expected: 12 tests PASS.

Then run the full aiAsk test suite to ensure no regressions:
```bash
npx vitest run src/api/aiAsk
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
cd d:/projects/MetricForge
git add frontend/src/components/AskInput.tsx frontend/src/components/AskInput.test.tsx frontend/src/pages/AskWorkbenchPage.tsx frontend/src/api/aiAsk/index.ts
git commit -m "feat(phase-5i): integrate Input Guard into AskInput and AskWorkbenchPage"
```

---

### Task 3: Context Policy 纯函数与测试

**Files:**
- Create: `frontend/src/api/aiAsk/contextPolicy.ts`
- Create: `frontend/src/api/aiAsk/contextPolicy.test.ts`
- Modify: `frontend/src/pages/AskWorkbenchPage.tsx`
- Modify: `frontend/src/api/aiAsk/index.ts`

**Interfaces:**
- Consumes:
  - `AiAskResponse` from `../../types/aiAsk`
  - `AiAskContext` from `./adapter`
- Produces:
  - `interface ContextPolicyConfig { maxHistoryLength: number; compressionLevel: 'none' | 'light' | 'full'; retainFields: string[] }`
  - `const DEFAULT_CONTEXT_CONFIG: ContextPolicyConfig`
  - `function buildMessageHistory(currentResponse: AiAskResponse | null, config?: Partial<ContextPolicyConfig>): AiAskContext['messageHistory'] | undefined`
  - `function compressResponse(response: AiAskResponse, level: 'light' | 'full'): AiAskResponse`

- [ ] **Step 1: Create `contextPolicy.ts` pure functions**

```typescript
// frontend/src/api/aiAsk/contextPolicy.ts
import type { AiAskResponse } from '../../types/aiAsk'
import type { AiAskContext } from './adapter'

export interface ContextPolicyConfig {
  maxHistoryLength: number
  compressionLevel: 'none' | 'light' | 'full'
  retainFields: string[]
}

export const DEFAULT_CONTEXT_CONFIG: ContextPolicyConfig = {
  maxHistoryLength: 1,
  compressionLevel: 'none',
  retainFields: [],
}

export function buildMessageHistory(
  currentResponse: AiAskResponse | null,
  config?: Partial<ContextPolicyConfig>
): AiAskContext['messageHistory'] | undefined {
  const effectiveConfig = { ...DEFAULT_CONTEXT_CONFIG, ...config }
  if (!currentResponse || effectiveConfig.maxHistoryLength < 1) {
    return undefined
  }

  return [
    { role: 'user' as const, content: currentResponse.question },
    {
      role: 'assistant' as const,
      content: '',
      responseJson: currentResponse as unknown as Record<string, unknown>,
    },
  ]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function compressResponse(
  response: AiAskResponse,
  level: 'light' | 'full'
): AiAskResponse {
  if (level === 'light') {
    const compressed = clone(response)
    compressed.chartSuggestions = []
    compressed.narrative = {
      summary: response.narrative.summary,
      conclusion: response.narrative.conclusion,
      keyFindings: [],
      evidence: [],
      risks: [],
      nextQuestions: [],
    }
    compressed.sqlPlan = {
      ...clone(response.sqlPlan),
      sql: response.sqlPlan.sql.slice(0, 200),
    }
    return compressed
  }

  return {
    question: response.question,
    intent: clone(response.intent),
    sqlPlan: {
      datasourceId: response.sqlPlan.datasourceId,
      datasourceName: response.sqlPlan.datasourceName,
      tables: clone(response.sqlPlan.tables),
      fields: clone(response.sqlPlan.fields),
      sql: '',
      assumptions: [],
      safetyWarnings: [],
    },
    resultSummary: response.resultSummary ? clone(response.resultSummary) : undefined,
    chartSuggestions: [],
    narrative: {
      summary: response.narrative.summary.slice(0, 200),
      keyFindings: [],
      evidence: [],
      risks: [],
      nextQuestions: [],
    },
    semanticGaps: [],
    followUp: response.followUp ? clone(response.followUp) : undefined,
    contextSummary: response.contextSummary,
  }
}
```

- [ ] **Step 2: Create `contextPolicy.test.ts`**

```typescript
// frontend/src/api/aiAsk/contextPolicy.test.ts
import { describe, it, expect } from 'vitest'
import { buildMessageHistory, compressResponse, DEFAULT_CONTEXT_CONFIG } from './contextPolicy'
import type { AiAskResponse } from '../../types/aiAsk'

const baseResponse: AiAskResponse = {
  question: '各区域销售额',
  intent: { metrics: ['销售额'], dimensions: ['区域'], filters: [], timeRange: '近 30 天' },
  sqlPlan: {
    datasourceId: 2,
    datasourceName: 'dwhrpt',
    sql: 'SELECT region, SUM(revenue) FROM sales',
    tables: ['sales'],
    fields: ['region', 'revenue'],
    assumptions: [],
    safetyWarnings: [],
  },
  resultSummary: { rowCount: 6, durationMs: 120, truncated: false },
  chartSuggestions: [
    {
      title: '图',
      chartType: 'bar',
      xField: 'region',
      yFields: ['revenue'],
      rationale: 'r',
      limitations: [],
    },
  ],
  narrative: {
    summary: 'summary',
    keyFindings: ['k1'],
    evidence: [{ claim: 'c', fields: [] }],
    risks: ['r1'],
    nextQuestions: ['q1'],
    conclusion: 'conclusion',
  },
  semanticGaps: [{ field: 'x', reason: 'not_found' }],
}

describe('buildMessageHistory', () => {
  it('returns undefined when currentResponse is null', () => {
    expect(buildMessageHistory(null)).toBeUndefined()
  })

  it('returns undefined when maxHistoryLength is 0', () => {
    expect(buildMessageHistory(baseResponse, { maxHistoryLength: 0 })).toBeUndefined()
  })

  it('builds single-turn history from currentResponse', () => {
    const history = buildMessageHistory(baseResponse)
    expect(history).toHaveLength(2)
    expect(history?.[0]).toEqual({ role: 'user', content: '各区域销售额' })
    expect(history?.[1].role).toBe('assistant')
    expect(history?.[1].responseJson).toEqual(baseResponse as unknown as Record<string, unknown>)
  })

  it('uses DEFAULT_CONTEXT_CONFIG when config is omitted', () => {
    expect(DEFAULT_CONTEXT_CONFIG.maxHistoryLength).toBe(1)
    expect(DEFAULT_CONTEXT_CONFIG.compressionLevel).toBe('none')
    expect(DEFAULT_CONTEXT_CONFIG.retainFields).toEqual([])
  })
})

describe('compressResponse', () => {
  it('light compression removes chartSuggestions', () => {
    const compressed = compressResponse(baseResponse, 'light')
    expect(compressed.chartSuggestions).toHaveLength(0)
    expect(compressed.question).toBe(baseResponse.question)
    expect(compressed.intent).toEqual(baseResponse.intent)
  })

  it('light compression keeps narrative summary and conclusion', () => {
    const compressed = compressResponse(baseResponse, 'light')
    expect(compressed.narrative.summary).toBe('summary')
    expect(compressed.narrative.conclusion).toBe('conclusion')
    expect(compressed.narrative.keyFindings).toHaveLength(0)
    expect(compressed.narrative.evidence).toHaveLength(0)
  })

  it('light compression truncates sql text to 200 characters', () => {
    const longSql = 'SELECT '.repeat(50)
    const response = { ...baseResponse, sqlPlan: { ...baseResponse.sqlPlan, sql: longSql } }
    const compressed = compressResponse(response, 'light')
    expect(compressed.sqlPlan.sql.length).toBeLessThanOrEqual(200)
  })

  it('full compression keeps only core fields', () => {
    const compressed = compressResponse(baseResponse, 'full')
    expect(compressed.question).toBe('各区域销售额')
    expect(compressed.intent).toEqual(baseResponse.intent)
    expect(compressed.chartSuggestions).toHaveLength(0)
    expect(compressed.semanticGaps).toHaveLength(0)
    expect(compressed.narrative.summary).toBe('summary')
    expect(compressed.narrative.keyFindings).toHaveLength(0)
    expect(compressed.narrative.conclusion).toBeUndefined()
  })

  it('full compression removes sql text', () => {
    const compressed = compressResponse(baseResponse, 'full')
    expect(compressed.sqlPlan.sql).toBe('')
    expect(compressed.sqlPlan.tables).toEqual(['sales'])
  })

  it('does not mutate original response', () => {
    const original: AiAskResponse = {
      ...baseResponse,
      chartSuggestions: [...baseResponse.chartSuggestions],
    }
    compressResponse(original, 'full')
    expect(original.chartSuggestions).toHaveLength(1)
    expect(original.narrative.keyFindings).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run Context Policy tests**

Run:
```bash
cd frontend
npx vitest run src/api/aiAsk/contextPolicy.test.ts
```

Expected: 10 tests PASS.

- [ ] **Step 4: Export Context Policy from barrel file**

Add to `frontend/src/api/aiAsk/index.ts` after the input guard exports:

```typescript
export { buildMessageHistory, compressResponse, DEFAULT_CONTEXT_CONFIG } from './contextPolicy'
export type { ContextPolicyConfig } from './contextPolicy'
```

- [ ] **Step 5: Replace inline messageHistory construction in `AskWorkbenchPage.handleSend`**

In `frontend/src/pages/AskWorkbenchPage.tsx`:

1. Add `buildMessageHistory` to the import from `'../api/aiAsk'`:

```typescript
import { useAiAskService, AiAskError, getAiAskErrorMessage, validateAiAskInput, buildMessageHistory } from '../api/aiAsk'
```

2. Replace the inline Phase 5H messageHistory block (lines 145-151 in the current file) with a call to `buildMessageHistory`:

```typescript
      // Phase 5I: Build messageHistory via Context Policy (Phase 5H behavior preserved)
      const prevResponse = useAiAskStore.getState().currentResponse
      const messageHistory = buildMessageHistory(prevResponse)
```

The surrounding code remains unchanged:

```typescript
      const resp = await adapter.analyze(content, {
        datasourceId,
        datasourceName,
        selectedTables,
        messageHistory,
        options: { mockDelay: [1500, 2500] },
      })
```

- [ ] **Step 6: Run full aiAsk and page-level type checks**

Run:
```bash
cd frontend
npx vitest run src/api/aiAsk
npx tsc --noEmit
```

Expected: all tests PASS, TypeScript reports no errors.

- [ ] **Step 7: Commit**

```bash
cd d:/projects/MetricForge
git add frontend/src/api/aiAsk/contextPolicy.ts frontend/src/api/aiAsk/contextPolicy.test.ts frontend/src/api/aiAsk/index.ts frontend/src/pages/AskWorkbenchPage.tsx
git commit -m "feat(phase-5i): add Context Policy pure function and integrate into AskWorkbenchPage"
```

---

### Task 4: `resultSummary.truncated` UI 提示

**Files:**
- Create: `frontend/src/components/ResultTruncatedNotice.tsx`
- Create: `frontend/src/components/ResultTruncatedNotice.test.tsx`
- Modify: `frontend/src/pages/AskWorkbenchPage.tsx`

**Interfaces:**
- Consumes: `truncated?: boolean`
- Produces: `ResultTruncatedNotice` component renders an Ant Design `Alert` when `truncated` is `true`

- [ ] **Step 1: Create the truncated notice component**

```typescript
// frontend/src/components/ResultTruncatedNotice.tsx
import React from 'react'
import { Alert } from 'antd'

interface ResultTruncatedNoticeProps {
  truncated?: boolean
}

export const ResultTruncatedNotice: React.FC<ResultTruncatedNoticeProps> = ({ truncated }) => {
  if (!truncated) return null
  return (
    <Alert
      type="warning"
      showIcon
      message="结果仅显示前 100 行数据，建议细化查询条件"
      style={{ borderRadius: 8, marginBottom: 12 }}
    />
  )
}

export default ResultTruncatedNotice
```

- [ ] **Step 2: Create component tests**

```typescript
// frontend/src/components/ResultTruncatedNotice.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ResultTruncatedNotice from './ResultTruncatedNotice'

describe('ResultTruncatedNotice', () => {
  it('renders warning when truncated is true', () => {
    render(<ResultTruncatedNotice truncated />)
    expect(screen.getByText(/结果仅显示前 100 行数据/)).toBeInTheDocument()
  })

  it('renders nothing when truncated is false', () => {
    const { container } = render(<ResultTruncatedNotice truncated={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when truncated is undefined', () => {
    const { container } = render(<ResultTruncatedNotice />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 3: Run component tests**

Run:
```bash
cd frontend
npx vitest run src/components/ResultTruncatedNotice.test.tsx
```

Expected: 3 tests PASS.

- [ ] **Step 4: Integrate into `AskWorkbenchPage`**

In `frontend/src/pages/AskWorkbenchPage.tsx`:

1. Import the component:

```typescript
import ResultTruncatedNotice from '../components/ResultTruncatedNotice'
```

2. Place the notice inside the `currentResponse && !isAnalyzing` block, after the context chain and before `IntentCard`:

```tsx
                  {contextChain.length > 1 && (
                    <ContextChain
                      contextChain={contextChain}
                      currentIndex={contextChain.length - 1}
                    />
                  )}

                  <ResultTruncatedNotice truncated={currentResponse.resultSummary?.truncated} />

                  <IntentCard
```

- [ ] **Step 5: Run affected tests and type check**

Run:
```bash
cd frontend
npx vitest run src/components/ResultTruncatedNotice.test.tsx
npx tsc --noEmit
```

Expected: tests PASS, TypeScript reports no errors.

- [ ] **Step 6: Commit**

```bash
cd d:/projects/MetricForge
git add frontend/src/components/ResultTruncatedNotice.tsx frontend/src/components/ResultTruncatedNotice.test.tsx frontend/src/pages/AskWorkbenchPage.tsx
git commit -m "feat(phase-5i): add resultSummary.truncated notice banner"
```

---

### Task 5: Benchmark Runner 与本地报告输出

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/.gitignore`
- Create: `frontend/scripts/runQualityBenchmarks.ts`
- Create: `frontend/scripts/benchmarks/inputGuard.bench.ts`
- Create: `frontend/scripts/benchmarks/contextPolicy.bench.ts`
- Create: `frontend/scripts/benchmarks/followUpDetector.bench.ts`
- Create: `frontend/scripts/benchmarks/adapter.bench.ts`
- Create: `frontend/scripts/fixtures/multiRoundHistory.ts`
- Create: `frontend/scripts/benchmark-results/.gitkeep`

**Interfaces:**
- Consumes: `validateAiAskInput`, `buildMessageHistory`, `compressResponse`, `detectFollowUpType`, `MockAdapter` from `src`
- Produces:
  - `interface QualityBenchmarkReport { timestamp: string; duration: number; modules: { inputGuard: ModuleReport; contextPolicy: ModuleReport; followUpDetector: ModuleReport; adapter: ModuleReport } }`
  - `interface ModuleReport { total: number; passed: number; failed: number; failures: BenchmarkFailure[] }`
  - JSON report written to `frontend/scripts/benchmark-results/<ISO-timestamp>.json`

- [ ] **Step 1: Install `tsx` as devDependency**

Run:
```bash
cd frontend
npm install -D tsx
```

Expected: `frontend/package.json` now lists `tsx` under `devDependencies`, and `frontend/package-lock.json` is updated.

- [ ] **Step 2: Add `benchmark` script to `package.json`**

Modify `frontend/package.json` scripts section to:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "benchmark": "tsx scripts/runQualityBenchmarks.ts"
}
```

- [ ] **Step 3: Ignore generated benchmark result files**

Add to `frontend/.gitignore`:

```gitignore
scripts/benchmark-results/*.json
```

- [ ] **Step 4: Create benchmark fixtures**

```typescript
// frontend/scripts/fixtures/multiRoundHistory.ts
import type { AiAskResponse } from '../../src/types/aiAsk.ts'

export const REVENUE_BY_REGION_RESPONSE: AiAskResponse = {
  question: '各区域销售额表现如何？',
  intent: { metrics: ['销售额'], dimensions: ['区域'], filters: [], timeRange: '近 30 天' },
  sqlPlan: {
    datasourceId: 2,
    datasourceName: 'dwhrpt',
    sql: 'SELECT r.region, SUM(r.amount) AS total_revenue\nFROM REVENUE r\nWHERE r.transaction_date >= SYSDATE - 30\nGROUP BY r.region\nORDER BY total_revenue DESC',
    tables: ['REVENUE'],
    fields: ['region', 'total_revenue'],
    assumptions: ['使用 SYSDATE 作为当前日期边界'],
    safetyWarnings: [],
  },
  resultSummary: { rowCount: 6, durationMs: 230, truncated: false },
  chartSuggestions: [],
  narrative: {
    summary: '近 30 天各区域销售额呈梯度分布，华东以 ¥12.3M 领跑，占总销售额的 29.4%。',
    keyFindings: ['华东区域销售额 ¥12.3M，领先第二华南 25.5%', '西北+东北区域合计贡献仅 14%，提升空间大'],
    evidence: [{ claim: '华东领先', fields: ['region', 'total_revenue'], sqlSnippet: 'SUM(r.amount) GROUP BY region' }],
    risks: ['数据仅覆盖 30 天'],
    nextQuestions: ['华东区域近 6 个月趋势如何？', '各区域毛利率分布情况？'],
  },
  semanticGaps: [],
}

export function buildFixtureResponse(overrides?: Partial<AiAskResponse>): AiAskResponse {
  return { ...REVENUE_BY_REGION_RESPONSE, ...overrides }
}
```

- [ ] **Step 5: Create the benchmark runner entry point**

```typescript
// frontend/scripts/runQualityBenchmarks.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInputGuardBenchmark } from './benchmarks/inputGuard.bench.ts'
import { runContextPolicyBenchmark } from './benchmarks/contextPolicy.bench.ts'
import { runFollowUpBenchmark } from './benchmarks/followUpDetector.bench.ts'
import { runAdapterBenchmark } from './benchmarks/adapter.bench.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface BenchmarkFailure {
  label: string
  expected: string
  actual: string
  detail?: string
}

export interface ModuleReport {
  total: number
  passed: number
  failed: number
  failures: BenchmarkFailure[]
}

export interface QualityBenchmarkReport {
  timestamp: string
  duration: number
  modules: {
    inputGuard: ModuleReport
    contextPolicy: ModuleReport
    followUpDetector: ModuleReport
    adapter: ModuleReport
  }
}

async function main(): Promise<void> {
  const start = Date.now()
  const timestamp = new Date().toISOString()

  const [inputGuard, contextPolicy, followUpDetector, adapter] = await Promise.all([
    runInputGuardBenchmark(),
    runContextPolicyBenchmark(),
    runFollowUpBenchmark(),
    runAdapterBenchmark(),
  ])

  const report: QualityBenchmarkReport = {
    timestamp,
    duration: Date.now() - start,
    modules: { inputGuard, contextPolicy, followUpDetector, adapter },
  }

  const outDir = path.join(__dirname, 'benchmark-results')
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true })
  }
  const filename = `${timestamp.replace(/[:.]/g, '-')}.json`
  const outPath = path.join(outDir, filename)
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8')

  console.log(`Benchmark completed in ${report.duration}ms`)
  console.log(`Report written to ${outPath}`)
  console.log(JSON.stringify(report, null, 2))

  const totalFailed = Object.values(report.modules).reduce((sum, m) => sum + m.failed, 0)
  if (totalFailed > 0) {
    console.error(`${totalFailed} benchmark assertion(s) failed`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 6: Create Input Guard benchmark**

```typescript
// frontend/scripts/benchmarks/inputGuard.bench.ts
import { validateAiAskInput, MAX_INPUT_LENGTH } from '../../src/api/aiAsk/inputGuard.ts'
import type { ModuleReport, BenchmarkFailure } from '../runQualityBenchmarks.ts'

interface InputGuardCase {
  input: string
  label: string
  expectedValid: boolean
  expectedCode?: string
}

const TEST_CASES: InputGuardCase[] = [
  { input: '', label: '空字符串', expectedValid: false, expectedCode: 'EMPTY_INPUT' },
  { input: '   ', label: '纯空格', expectedValid: false, expectedCode: 'EMPTY_INPUT' },
  { input: '你好'.repeat(250), label: '刚好 500 字符', expectedValid: true },
  { input: '你好'.repeat(251), label: '超 1 个字符（502）', expectedValid: false, expectedCode: 'TOO_LONG' },
  { input: '1'.repeat(1000), label: '1000 字符超长', expectedValid: false, expectedCode: 'TOO_LONG' },
  { input: '，，，', label: '中文标点', expectedValid: false, expectedCode: 'PUNCTUATION_ONLY' },
  { input: '!@#$%^&*()_+', label: '英文符号', expectedValid: false, expectedCode: 'PUNCTUATION_ONLY' },
  { input: '\n\t\n', label: '仅换行与制表符', expectedValid: false, expectedCode: 'EMPTY_INPUT' },
  { input: 'abc\x00def', label: '含空字符', expectedValid: false, expectedCode: 'INVALID_CHARS' },
  { input: '各区域近30天销售额', label: '正常业务问题', expectedValid: true },
  { input: '为什么华东最高', label: '正常追问', expectedValid: true },
  { input: '请分析2024年各区域销售额TOP10客户的分布情况并按产品线拆解毛利率变化趋势', label: '长句但合法', expectedValid: true },
]

export async function runInputGuardBenchmark(): Promise<ModuleReport> {
  const failures: BenchmarkFailure[] = []
  for (const tc of TEST_CASES) {
    const result = validateAiAskInput(tc.input)
    const actualCode = result.valid ? 'valid' : result.error!.code
    const passed = result.valid === tc.expectedValid && actualCode === (tc.expectedCode ?? 'valid')
    if (!passed) {
      failures.push({
        label: tc.label,
        expected: tc.expectedValid ? 'valid' : tc.expectedCode!,
        actual: actualCode,
      })
    }
  }
  return {
    total: TEST_CASES.length,
    passed: TEST_CASES.length - failures.length,
    failed: failures.length,
    failures,
  }
}
```

- [ ] **Step 7: Create Context Policy benchmark**

```typescript
// frontend/scripts/benchmarks/contextPolicy.bench.ts
import { buildMessageHistory, compressResponse } from '../../src/api/aiAsk/contextPolicy.ts'
import { REVENUE_BY_REGION_RESPONSE } from '../fixtures/multiRoundHistory.ts'
import type { ModuleReport, BenchmarkFailure } from '../runQualityBenchmarks.ts'

function approximateBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf-8')
}

export async function runContextPolicyBenchmark(): Promise<ModuleReport> {
  const failures: BenchmarkFailure[] = []

  const scenarios = [
    { name: '1 轮 none', turnCount: 1, level: 'none' as const },
    { name: '3 轮 light', turnCount: 3, level: 'light' as const },
    { name: '5 轮 full', turnCount: 5, level: 'full' as const },
    { name: '10 轮 full', turnCount: 10, level: 'full' as const },
  ]

  const reports = scenarios.map((s) => {
    const history = Array.from({ length: s.turnCount })
      .map(() => buildMessageHistory(REVENUE_BY_REGION_RESPONSE))
      .flat()
      .filter((h): h is NonNullable<typeof h> => h !== undefined)

    const compressed = history.map((h) => ({
      ...h,
      responseJson: compressResponse(h.responseJson as any, s.level),
    }))
    const originalBytes = approximateBytes(history)
    const compressedBytes = approximateBytes(compressed)
    return { name: s.name, originalBytes, compressedBytes, ratio: (compressedBytes / originalBytes).toFixed(2) }
  })

  console.log('Context policy compression reports:', reports)

  const history = buildMessageHistory(REVENUE_BY_REGION_RESPONSE)
  if (!history || history.length !== 2) {
    failures.push({
      label: 'buildMessageHistory shape',
      expected: '2 messages',
      actual: String(history?.length ?? 'undefined'),
    })
  }

  const light = compressResponse(REVENUE_BY_REGION_RESPONSE, 'light')
  if (light.chartSuggestions.length !== 0) {
    failures.push({
      label: 'light removes chartSuggestions',
      expected: '0',
      actual: String(light.chartSuggestions.length),
    })
  }

  const full = compressResponse(REVENUE_BY_REGION_RESPONSE, 'full')
  if (full.narrative.keyFindings.length !== 0 || full.semanticGaps.length !== 0) {
    failures.push({
      label: 'full removes narrative details and semanticGaps',
      expected: 'removed',
      actual: 'kept',
    })
  }

  return {
    total: scenarios.length + 3,
    passed: scenarios.length + 3 - failures.length,
    failed: failures.length,
    failures,
  }
}
```

- [ ] **Step 8: Create FollowUp Detector benchmark**

```typescript
// frontend/scripts/benchmarks/followUpDetector.bench.ts
import { detectFollowUpType } from '../../src/api/aiAsk/followUpDetector.ts'
import type { FollowUpType } from '../../src/types/aiAsk.ts'
import { REVENUE_BY_REGION_RESPONSE } from '../fixtures/multiRoundHistory.ts'
import type { ModuleReport, BenchmarkFailure } from '../runQualityBenchmarks.ts'

interface FollowUpCase {
  question: string
  expectedType: FollowUpType
  expectedConfidence: 'high' | 'medium' | 'low'
}

const TEST_CASES: FollowUpCase[] = [
  { question: '为什么销售额下降', expectedType: 'why_down', expectedConfidence: 'high' },
  { question: '下降的原因是什么', expectedType: 'why_down', expectedConfidence: 'high' },
  { question: '为什么华东最高', expectedType: 'drill_down', expectedConfidence: 'high' },
  { question: '按产品线拆分', expectedType: 'drill_down', expectedConfidence: 'medium' },
  { question: '看 TOP10 客户', expectedType: 'top_n', expectedConfidence: 'high' },
  { question: '去年同期的数据', expectedType: 'time_shift', expectedConfidence: 'high' },
  { question: '换成毛利率来看', expectedType: 'switch_metric', expectedConfidence: 'medium' },
  { question: '为什么这个月突然下降', expectedType: 'explain_anomaly', expectedConfidence: 'medium' },
  { question: '再说说', expectedType: 'general_followup', expectedConfidence: 'low' },
  { question: '还有吗', expectedType: 'general_followup', expectedConfidence: 'low' },
]

export async function runFollowUpBenchmark(): Promise<ModuleReport> {
  const failures: BenchmarkFailure[] = []
  for (const tc of TEST_CASES) {
    const result = detectFollowUpType(tc.question, REVENUE_BY_REGION_RESPONSE)
    const passed = result.type === tc.expectedType && result.confidence === tc.expectedConfidence
    if (!passed) {
      failures.push({
        label: tc.question,
        expected: `${tc.expectedType}:${tc.expectedConfidence}`,
        actual: `${result.type}:${result.confidence}`,
      })
    }
  }
  return {
    total: TEST_CASES.length,
    passed: TEST_CASES.length - failures.length,
    failed: failures.length,
    failures,
  }
}
```

- [ ] **Step 9: Create Adapter benchmark**

```typescript
// frontend/scripts/benchmarks/adapter.bench.ts
import { MockAdapter } from '../../src/api/aiAsk/mockAdapter.ts'
import { REVENUE_BY_REGION_RESPONSE } from '../fixtures/multiRoundHistory.ts'
import type { AiAskContext } from '../../src/api/aiAsk/adapter.ts'
import type { ModuleReport, BenchmarkFailure } from '../runQualityBenchmarks.ts'

function makeContext(previousResponse: typeof REVENUE_BY_REGION_RESPONSE): AiAskContext {
  return {
    datasourceId: null,
    datasourceName: null,
    selectedTables: [],
    messageHistory: [
      { role: 'user', content: '各区域销售额' },
      { role: 'assistant', content: '', responseJson: previousResponse as unknown as Record<string, unknown> },
    ],
  }
}

export async function runAdapterBenchmark(): Promise<ModuleReport> {
  const adapter = MockAdapter.create()
  const failures: BenchmarkFailure[] = []

  const cases = [
    { question: '为什么华东最高', expectedType: 'drill_down', expectedDegraded: false },
    { question: '随便说说其他事', expectedType: 'general_followup', expectedDegraded: true },
  ]

  for (const tc of cases) {
    const result = await adapter.analyze(tc.question, makeContext(REVENUE_BY_REGION_RESPONSE))
    if (result.followUp?.type !== tc.expectedType) {
      failures.push({
        label: tc.question,
        expected: tc.expectedType,
        actual: result.followUp?.type ?? 'undefined',
      })
      continue
    }
    const degraded = result.followUp?.type === 'general_followup' && result.followUp?.confidence === 'low'
    if (degraded !== tc.expectedDegraded) {
      failures.push({
        label: `${tc.question} degraded flag`,
        expected: String(tc.expectedDegraded),
        actual: String(degraded),
      })
    }
  }

  const drillDownResult = await adapter.analyze('为什么华东最高', makeContext(REVENUE_BY_REGION_RESPONSE))
  if (drillDownResult.chartSuggestions.length === 0) {
    failures.push({
      label: 'drill_down has chart suggestions',
      expected: '>0',
      actual: '0',
    })
  }

  return {
    total: cases.length + 1,
    passed: cases.length + 1 - failures.length,
    failed: failures.length,
    failures,
  }
}
```

- [ ] **Step 10: Preserve benchmark results directory**

Create `frontend/scripts/benchmark-results/.gitkeep` with an empty file:

```bash
cd frontend
mkdir -p scripts/benchmark-results
touch scripts/benchmark-results/.gitkeep
```

- [ ] **Step 11: Run the benchmark**

Run:
```bash
cd frontend
npm run benchmark
```

Expected: console prints a report with `failed: 0` for all modules and writes a JSON file to `frontend/scripts/benchmark-results/2026-07-06T...json`.

- [ ] **Step 12: Commit**

```bash
cd d:/projects/MetricForge
git add frontend/package.json frontend/package-lock.json frontend/.gitignore frontend/scripts/
git commit -m "feat(phase-5i): add local quality benchmark runner and fixtures"
```

---

### Task 6: 最终集成验证与约束检查

**Files:**
- No new files

**Interfaces:**
- Consumes: all previous tasks
- Produces: verified working tree ready for final commit

- [ ] **Step 1: Run full frontend test suite**

```bash
cd frontend
npm test
```

Expected: all Vitest tests PASS.

- [ ] **Step 2: Run TypeScript type check**

```bash
cd frontend
npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 3: Run benchmark one final time**

```bash
cd frontend
npm run benchmark
```

Expected: exits with code 0, JSON report generated, all modules `failed: 0`.

- [ ] **Step 4: Verify no backend changes**

Run:
```bash
cd d:/projects/MetricForge
git status --short
```

Expected: no changes under `backend/`, no new migration files, no new API route files.

- [ ] **Step 5: Verify no prohibited tools were added**

Check the following are absent from `frontend/package.json`:
- `playwright`
- `cypress`
- `@playwright/test`

Check the following are absent from the repository:
- New files under `.github/workflows/`
- New files matching `*.e2e.*` or `*.spec.*` outside of the benchmark scripts

- [ ] **Step 6: Verify no AiAskResponse or adapter protocol changes**

Open `frontend/src/types/aiAsk.ts` and `frontend/src/api/aiAsk/adapter.ts` and confirm:
- `AiAskResponse` has no new fields
- `AiAskAdapter.analyze` still returns `Promise<AiAskResponse>` and may throw `AiAskError`
- No `{ error, fallback }` return shape was introduced

- [ ] **Step 7: Final commit (conditional)**

Run:

```bash
cd d:/projects/MetricForge
git status --short
```

If every previous task was committed individually, there should be no remaining changes and this step is a no-op.

If the verification steps produced new or modified files that need to be committed (e.g., benchmark-related generated files are ignored and should not appear), do **not** commit automatically. Instead, list the files here and ask the user for confirmation before committing:

```bash
git add <file1> <file2> ...
git commit -m "feat(phase-5i): implement AI ask quality and safety guards"
```

Do **not** use `--no-verify`.

---

## Self-Review

### 1. Spec Coverage

| Spec Section | Implementing Task |
|--------------|-------------------|
| 2. Input Guard pure function + `MAX_INPUT_LENGTH = 500` | Task 1 |
| 2.3 Double-layer integration (AskInput + handleSend) | Task 2 |
| 2.4 Real-time error feedback | Task 2 |
| 3. Context Policy pure function | Task 3 |
| 3.3 `buildMessageHistory` preserving Phase 5H behavior | Task 3 |
| 3.3 `compressResponse` (light/full) | Task 3 |
| 4.3.4 `resultSummary.truncated` notice | Task 4 |
| 5. Benchmark runner + JSON report | Task 5 |
| 6. No backend/DB/migration changes | Global Constraints + Task 6 |
| 7. No AiAskResponse/adapter protocol changes | Global Constraints + Task 6 |
| 9. Test strategy (Vitest unit tests + standalone benchmark) | Tasks 1, 3, 4, 5 |

No gaps identified.

### 2. Placeholder Scan

- No `TBD`, `TODO`, `implement later`, or `fill in details`.
- No vague phrases like "add appropriate error handling".
- No "write tests for the above" without test code.
- No "similar to Task N" references.
- Every code-changing step includes the actual code.

### 3. Type Consistency

- `validateAiAskInput(question: string): InputValidationResult` is consistent across Task 1 and Task 2.
- `buildMessageHistory(currentResponse: AiAskResponse | null, config?: Partial<ContextPolicyConfig>): AiAskContext['messageHistory'] | undefined` is consistent across Task 3 and Task 5.
- `compressResponse(response: AiAskResponse, level: 'light' | 'full'): AiAskResponse` is consistent across Task 3 and Task 5.
- `AiAskError` / `getAiAskErrorMessage` are not modified, preserving existing error codes.
- No renamed or mismatched functions between tasks.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-06-phase-5i-ai-ask-quality-safety-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

**Which approach?**
