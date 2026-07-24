// frontend/src/api/aiAsk/executeApi.ts

import type { AiAskResponse } from '../../types/aiAsk'
import { AiAskError } from './errors'
import { validateAiAskResponse } from './validator'

export interface ExecuteSqlResponse {
  data: AiAskResponse
}

export async function executeSql(
  sessionId: number,
  assistantMessageId: number,
): Promise<ExecuteSqlResponse> {
  let resp: Response
  try {
    resp = await fetch('/api/ai-ask/execute-sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, assistantMessageId }),
    })
  } catch (networkErr) {
    throw new AiAskError(
      '无法连接到 AI 问数服务，请检查网络',
      'LLM_CONNECTION_ERROR',
      { originalError: String(networkErr) },
    )
  }

  let body: unknown
  try {
    body = await resp.json()
  } catch {
    const text = await resp.text().catch(() => '')
    throw new AiAskError(
      '执行服务返回了无法解析的响应',
      'INVALID_RESPONSE',
      { status: resp.status, text },
    )
  }

  // HTTP 409 — executing
  if (resp.status === 409) {
    throw new AiAskError(
      '正在执行中，请稍候',
      'EXECUTION_ERROR',
      { httpStatus: 409 },
    )
  }

  // HTTP 422 — validation/state error
  if (resp.status === 422) {
    const errBody = (body && typeof body === 'object' && !Array.isArray(body)
      ? body
      : {}) as Record<string, unknown>
    const detail = errBody.detail
    const detailMsg = Array.isArray(detail)
      ? (detail as any[]).map((d: any) => d.msg ?? String(d)).join('; ')
      : String(detail ?? '')
    throw new AiAskError(
      `请求参数校验失败：${detailMsg || '消息状态不合法'}`,
      'INVALID_RESPONSE',
      { status: 422, detail: detailMsg },
    )
  }

  // Non-2xx other
  if (!resp.ok) {
    const errBody = (body && typeof body === 'object' && !Array.isArray(body)
      ? body
      : {}) as Record<string, unknown>
    throw new AiAskError(
      String(errBody.errorMessage ?? `执行服务错误（HTTP ${resp.status}）`),
      (errBody.errorCode as any) ?? 'UNKNOWN',
      (errBody.details as Record<string, unknown>) ?? {},
    )
  }

  // Non-object body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AiAskError(
      '执行服务返回了无法识别的响应',
      'UNKNOWN',
      { status: resp.status, body },
    )
  }

  const result = body as Record<string, unknown>

  // Business error
  if (result.ok === false) {
    throw new AiAskError(
      String(result.errorMessage ?? 'SQL 执行失败'),
      (result.errorCode as any) ?? 'EXECUTION_ERROR',
      (result.details as Record<string, unknown>) ?? {},
    )
  }

  // Missing or invalid ok field
  if (result.ok !== true) {
    throw new AiAskError(
      '执行服务返回了无法识别的响应',
      'UNKNOWN',
      { body: result },
    )
  }

  // Validate response structure (enforces queryResult contract for executed)
  const data = result.data as unknown
  const validation = validateAiAskResponse(data)
  if (!validation.valid) {
    throw new AiAskError('模型响应未通过前端二次校验', 'INVALID_RESPONSE', {
      errors: validation.errors,
    })
  }

  return { data: data as AiAskResponse }
}
