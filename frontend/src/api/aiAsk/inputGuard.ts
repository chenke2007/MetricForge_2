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

// Phase 5I: block inputs that contain only punctuation or symbols after trimming whitespace.
function isPunctuationOrSymbolOnly(input: string): boolean {
  const withoutWhitespace = input.replace(/\s/g, '')
  if (withoutWhitespace.length === 0) {
    return false
  }
  return [...withoutWhitespace].every((ch) => /\p{P}|\p{S}/u.test(ch))
}

export function validateAiAskInput(question: string): InputValidationResult {
  if (question.trim().length === 0) {
    return {
      valid: false,
      error: { code: 'EMPTY_INPUT', message: '请输入问题' },
    }
  }

  if (isPunctuationOrSymbolOnly(question)) {
    return {
      valid: false,
      error: { code: 'PUNCTUATION_ONLY', message: '请输入有效的问题，不能仅包含标点或符号' },
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
