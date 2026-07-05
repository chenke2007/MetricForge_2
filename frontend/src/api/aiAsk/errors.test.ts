// frontend/src/api/aiAsk/errors.test.ts
import { describe, it, expect } from 'vitest'
import { AiAskError, getAiAskErrorMessage } from './errors'

describe('AiAskError', () => {
  it('creates error with code and message', () => {
    const err = new AiAskError('test', 'UNKNOWN', { detail: 'x' })
    expect(err.message).toBe('test')
    expect(err.code).toBe('UNKNOWN')
    expect(err.name).toBe('AiAskError')
    expect(err.details).toEqual({ detail: 'x' })
  })

  it('getAiAskErrorMessage returns Chinese message for each code', () => {
    expect(getAiAskErrorMessage('ANALYSIS_TIMEOUT')).toContain('超时')
    expect(getAiAskErrorMessage('INVALID_RESPONSE')).toContain('异常')
    expect(getAiAskErrorMessage('NO_DATA')).toContain('无可用数据')
    expect(getAiAskErrorMessage('ADAPTER_UNAVAILABLE')).toContain('暂不可用')
    expect(getAiAskErrorMessage('CONTEXT_TOO_LARGE')).toContain('过长')
    expect(getAiAskErrorMessage('UNKNOWN')).toContain('异常')
  })
})
