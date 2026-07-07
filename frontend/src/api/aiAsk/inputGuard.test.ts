// frontend/src/api/aiAsk/inputGuard.test.ts
import { describe, it, expect } from 'vitest'
import { validateAiAskInput, MAX_INPUT_LENGTH } from './inputGuard'

describe('validateAiAskInput', () => {
  it('accepts normal text that mixes Chinese characters with punctuation/symbols', () => {
    const result = validateAiAskInput('销售额 + 毛利率 对比')
    expect(result.valid).toBe(true)
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
    expect(result.error?.message).toContain('标点或符号')
  })

  it('returns PUNCTUATION_ONLY for English symbols and punctuation only', () => {
    const result = validateAiAskInput('!@#$%^&*()_+')
    expect(result.error?.code).toBe('PUNCTUATION_ONLY')
    expect(result.error?.message).toContain('标点或符号')
  })

  it('returns EMPTY_INPUT for whitespace and newline only', () => {
    const result = validateAiAskInput('\n\t\n')
    expect(result.error?.code).toBe('EMPTY_INPUT')
  })

  it('returns TOO_LONG for 1001 characters', () => {
    const result = validateAiAskInput('a'.repeat(MAX_INPUT_LENGTH + 1))
    expect(result.error?.code).toBe('TOO_LONG')
  })

  it('accepts exactly 1000 characters', () => {
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
