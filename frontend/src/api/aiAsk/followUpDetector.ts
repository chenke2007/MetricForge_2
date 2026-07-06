import type { FollowUpQuestion, AiAskResponse } from '../../types/aiAsk'

const DRILL_DOWN_PATTERNS = [
  { re: /为什么\s*(.+?)\s*(最高|最低|突出|领先)/, extract: (m: RegExpExecArray) => {
    const raw = m[1].trim()
    const cleaned = raw.replace(/(销售额|收入|营收|利润|成本|订单数|毛利率|增长率)$/, '')
    return { targetValue: cleaned || raw, targetDimension: undefined as string | undefined }
  } },
  { re: /按(.+?)拆/, extract: (m: RegExpExecArray) => ({ targetValue: undefined as string | undefined, targetDimension: m[1].trim() }) },
  { re: /(.+?)区域/, extract: (m: RegExpExecArray) => ({ targetValue: m[1].trim(), targetDimension: undefined as string | undefined }) },
  { re: /(.+?)分布/, extract: (m: RegExpExecArray) => ({ targetValue: undefined as string | undefined, targetDimension: m[1].trim() }) },
]

const WHY_DOWN_PATTERNS = [/为什么.*(下降|减少|降低|变差)/, /(下降|减少|降低).*(原因|为什么)/]

const TOP_N_PATTERNS = [/TOP\s*\d+/i, /前\d/, /排名前/, /(最高|最多).*\d/, /(TOP|前几)/]

const TIME_SHIFT_PATTERNS = [/去年/, /同比/, /环比/, /去年同期/, /上月/, /上个月/, /去年同/]

const SWITCH_METRIC_PATTERNS = [
  { re: /换(成|为)\s*(.+?)(看|来|的|$)/, extract: (m: RegExpExecArray) => ({ metric: m[2].trim() }) },
  { re: /看(.+?率|.+?比|.+?额|.+?量)/, extract: (m: RegExpExecArray) => ({ metric: m[1].trim() }) },
]

const EXPLAIN_ANOMALY_PATTERNS = [/为什么.*(突然|异常|本月|这个月)/, /解释.*(异常|波动)/]

export function detectFollowUpType(
  question: string,
  _previousResponse: AiAskResponse,
  forceType?: import('../../types/aiAsk').FollowUpType
): FollowUpQuestion {
  if (forceType) {
    return { type: forceType, confidence: 'high', inferenceReason: `forceFollowUpType override: ${forceType}` }
  }

  // why_down
  for (const p of WHY_DOWN_PATTERNS) {
    if (p.test(question)) {
      return { type: 'why_down', confidence: 'high', inferenceReason: 'matched why_down pattern' }
    }
  }

  // explain_anomaly
  for (const p of EXPLAIN_ANOMALY_PATTERNS) {
    if (p.test(question)) {
      return { type: 'explain_anomaly', confidence: 'medium', inferenceReason: 'matched explain_anomaly pattern' }
    }
  }

  // time_shift
  for (const p of TIME_SHIFT_PATTERNS) {
    if (p.test(question)) {
      return { type: 'time_shift', confidence: 'high', inferenceReason: 'matched time_shift pattern' }
    }
  }

  // top_n
  for (const p of TOP_N_PATTERNS) {
    if (p.test(question)) {
      return { type: 'top_n', confidence: 'high', inferenceReason: 'matched top_n pattern' }
    }
  }

  for (const entry of DRILL_DOWN_PATTERNS) {
    const m = entry.re.exec(question)
    if (m) {
      const extracted = entry.extract(m)
      const targetValue = extracted.targetValue
      const targetDimension = extracted.targetDimension
      return {
        type: 'drill_down',
        targetValue,
        targetDimension,
        confidence: targetValue ? 'high' : 'medium',
        inferenceReason: `matched drill_down pattern: target=${targetValue ?? targetDimension}`,
      }
    }
  }

  // switch_metric
  for (const entry of SWITCH_METRIC_PATTERNS) {
    const m = entry.re.exec(question)
    if (m) {
      const extracted = entry.extract(m)
      return {
        type: 'switch_metric',
        relatedMetrics: extracted.metric ? [extracted.metric] : undefined,
        confidence: 'medium',
        inferenceReason: `matched switch_metric pattern: ${extracted.metric}`,
      }
    }
  }

  // fallback
  return { type: 'general_followup', confidence: 'low', inferenceReason: 'no pattern matched, fallback to general' }
}
