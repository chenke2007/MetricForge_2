// frontend/src/api/aiAsk/realLlmAdapter.ts
import type { AiAskAdapter, AiAskContext, ChartDataResult } from './adapter'
import type { AiAskResponse, AiChartSpec } from '../../types/aiAsk'
import { AiAskError } from './errors'
import { validateAiAskResponse } from './validator'
import { matchChartFields } from './chartFieldMatch'

export class RealLlmAdapter implements AiAskAdapter {
  readonly name = 'RealLlmAdapter'

  private constructor() {}

  static create(): RealLlmAdapter {
    return new RealLlmAdapter()
  }

  async analyze(question: string, context: AiAskContext): Promise<AiAskResponse> {
    const payload = {
      question,
      datasourceId: context.datasourceId,
      datasourceName: context.datasourceName,
      selectedTables: context.selectedTables,
      messageHistory: context.messageHistory ?? [],
      sessionId: context.sessionId,
      assistantMessageId: context.assistantMessageId,
    }

    let resp: Response
    try {
      resp = await fetch('/api/ai-ask/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
        'AI 问数服务返回了无法解析的响应',
        'INVALID_RESPONSE',
        { status: resp.status, text },
      )
    }

    // Non-2xx status or non-object body
    if (!resp.ok || !body || typeof body !== 'object' || Array.isArray(body)) {
      const errBody = (body && typeof body === 'object' && !Array.isArray(body)
        ? body
        : {}) as Record<string, unknown>

      // Phase 5L: Map HTTP 422 (validation error) to a friendlier code
      if (resp.status === 422) {
        const detail = errBody.detail
        const detailMsg = Array.isArray(detail)
          ? (detail as any[]).map((d: any) => d.msg ?? String(d)).join('; ')
          : String(detail ?? '')
        throw new AiAskError(
          `请求参数校验失败：${detailMsg || '请检查数据源选择是否完整'}`,
          'INVALID_RESPONSE',
          { status: 422, detail: detailMsg },
        )
      }

      throw new AiAskError(
        String(errBody.errorMessage ?? `AI 问数服务错误（HTTP ${resp.status}）`),
        (errBody.errorCode as any) ?? 'UNKNOWN',
        (errBody.details as Record<string, unknown>) ?? {},
      )
    }

    const result = body as Record<string, unknown>

    // Business error: ok === false (HTTP 200 with error payload)
    if (result.ok === false) {
      throw new AiAskError(
        String(result.errorMessage ?? 'LLM 分析失败'),
        (result.errorCode as any) ?? 'UNKNOWN',
        (result.details as Record<string, unknown>) ?? {},
      )
    }

    // Unexpected ok value
    if (result.ok !== true) {
      throw new AiAskError(
        'AI 问数服务返回了无法识别的响应',
        'INVALID_RESPONSE',
        { body: result },
      )
    }

    const data = result.data as unknown
    const validation = validateAiAskResponse(data)
    if (!validation.valid) {
      throw new AiAskError('模型响应未通过前端二次校验', 'INVALID_RESPONSE', {
        errors: validation.errors,
      })
    }

    return data as AiAskResponse
  }

  getChartData(spec: AiChartSpec, response: AiAskResponse): ChartDataResult {
    // Phase 5N: use real queryResult data when available
    if (response.narrativeLevel !== 'executed' || !response.queryResult) {
      return {
        columns: [],
        rows: [],
        isEmpty: true,
        error: response.narrativeLevel === 'sql_pending'
          ? 'SQL 待验证（sql_pending），无法提供图表数据'
          : '当前无查询结果',
      }
    }

    const { columns, rows } = response.queryResult

    // Check that spec fields match queryResult columns (case-insensitive)
    // Phase 5N follow-up: reuse shared matchChartFields function
    const fieldMatch = matchChartFields(spec, columns)
    if (!fieldMatch.match) {
      return {
        columns: [],
        rows: [],
        isEmpty: true,
        error: '图表字段与查询结果不匹配',
      }
    }

    return {
      columns,
      rows,
      isEmpty: rows.length === 0,
    }
  }

  isAvailable(): boolean {
    return true
  }
}
