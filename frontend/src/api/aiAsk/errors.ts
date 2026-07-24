// frontend/src/api/aiAsk/errors.ts

export type AiAskErrorCode =
  | 'ANALYSIS_TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'METADATA_NOT_FOUND'
  | 'NO_DATA'
  | 'ADAPTER_UNAVAILABLE'
  | 'CONTEXT_TOO_LARGE'
  | 'LLM_CONNECTION_ERROR'
  | 'LLM_AUTH_ERROR'
  | 'LLM_NOT_CONFIGURED'
  | 'LLM_RATE_LIMIT'
  | 'EXECUTION_ERROR'
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

export function getAiAskErrorMessage(code: AiAskErrorCode, details?: Record<string, unknown>): string {
  // INVALID_RESPONSE 携带 sqlValidation 时使用 SQL 校验专用文案
  if (code === 'INVALID_RESPONSE' && details?.sqlValidation) {
    return 'SQL 校验未通过，AI 生成的 SQL 存在以下问题'
  }

  switch (code) {
    case 'ANALYSIS_TIMEOUT':
      return '分析超时，请简化你的问题后重试'
    case 'EXECUTION_ERROR':
      return 'SQL 执行出错，请稍后重试'
    case 'INVALID_RESPONSE':
      return 'AI 返回结果异常，请重试'
    case 'METADATA_NOT_FOUND':
      return '未找到该表元数据，请先采集元数据或选择正确的数据表'
    case 'NO_DATA':
      return '当前数据范围无可用数据'
    case 'ADAPTER_UNAVAILABLE':
      return 'AI 服务暂不可用，请稍后重试'
    case 'CONTEXT_TOO_LARGE':
      return '当前对话上下文过长，建议开始新对话'
    case 'LLM_CONNECTION_ERROR':
      return '无法连接到 LLM 服务，请检查网络或 LLM 配置'
    case 'LLM_AUTH_ERROR':
      return 'LLM 认证失败，请检查 API Key'
    case 'LLM_NOT_CONFIGURED':
      return '未配置已启用的 LLM 模型，请先在 LLM 连接管理中启用一个模型'
    case 'LLM_RATE_LIMIT':
      return 'LLM 请求频率过高，请稍后重试'
    case 'UNKNOWN':
      return '分析异常，请重试'
  }
}
