// frontend/src/api/aiAsk/errors.ts

export type AiAskErrorCode =
  | 'ANALYSIS_TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'NO_DATA'
  | 'ADAPTER_UNAVAILABLE'
  | 'CONTEXT_TOO_LARGE'
  | 'UNKNOWN'

export class AiAskError extends Error {
  constructor(
    message: string,
    public code: AiAskErrorCode,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AiAskError'
    this.details = details
  }
}

export function getAiAskErrorMessage(code: AiAskErrorCode): string {
  switch (code) {
    case 'ANALYSIS_TIMEOUT':
      return '分析超时，请简化你的问题后重试'
    case 'INVALID_RESPONSE':
      return 'AI 返回结果异常，请重试'
    case 'NO_DATA':
      return '当前数据范围无可用数据'
    case 'ADAPTER_UNAVAILABLE':
      return 'AI 服务暂不可用，请稍后重试'
    case 'CONTEXT_TOO_LARGE':
      return '当前对话上下文过长，建议开始新对话'
    case 'UNKNOWN':
      return '分析异常，请重试'
  }
}
