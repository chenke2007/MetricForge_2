import React, { useState } from 'react'
import { Card, Typography } from 'antd'
import { CommentOutlined } from '@ant-design/icons'
import type { AiInsightNarrative, RiskItem, NextQuestion } from '../types/aiAsk'

const { Text } = Typography

const FOLLOWUP_TYPE_LABELS: Record<string, string> = {
  why_down: '🔍',
  drill_down: '🔽',
  switch_metric: '🔄',
  top_n: '🏆',
  explain_anomaly: '⚡',
  time_shift: '📅',
  general_followup: '💬',
}

function renderRiskItem(r: string | RiskItem, i: number) {
  if (typeof r === 'string') {
    return <div key={i} style={{ fontSize: 12, color: '#8c6e00', marginTop: 2 }}>• {r}</div>
  }
  return (
    <div key={i} style={{ fontSize: 12, color: '#8c6e00', marginTop: 2 }}>
      • {r.risk}
      {r.impact && <span style={{ color: '#ad8b00' }}> → {r.impact}</span>}
      {r.suggestion && (
        <span style={{ display: 'block', paddingLeft: 12, color: '#666' }}>
          建议：{r.suggestion}
        </span>
      )}
    </div>
  )
}

function renderConfidence(confidence?: 'high' | 'medium' | 'low') {
  if (confidence === 'high') return <span style={{ color: '#52c41a', fontSize: 12 }}>✅ 高</span>
  if (confidence === 'medium') return <span style={{ color: '#fa8c16', fontSize: 12 }}>⚠️ 中</span>
  if (confidence === 'low') return <span style={{ color: '#ff4d4f', fontSize: 12 }}>❌ 低</span>
  return null
}

function renderNextQuestion(q: string | NextQuestion, i: number, onAsk?: (q: string) => void) {
  const text = typeof q === 'string' ? q : q.question
  const prefix = (typeof q !== 'string' && q.followUpType && FOLLOWUP_TYPE_LABELS[q.followUpType])
    ? FOLLOWUP_TYPE_LABELS[q.followUpType] + ' ' : ''

  return (
    <div
      key={i}
      onClick={() => onAsk?.(text)}
      style={{
        padding: '5px 12px',
        borderRadius: 16,
        border: '1px solid #d9e8ff',
        background: '#f0f5ff',
        fontSize: 12,
        color: '#4E7BF5',
        cursor: onAsk ? 'pointer' : 'default',
        transition: 'all 0.2s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#d9e8ff' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = '#f0f5ff' }}
    >
      {prefix}{text}
    </div>
  )
}

interface AiNarrativeProps {
  narrative: AiInsightNarrative
  onAskQuestion?: (question: string) => void
}

const AiNarrative: React.FC<AiNarrativeProps> = ({ narrative, onAskQuestion }) => {
  const [expandedEvidenceIndices, setExpandedEvidenceIndices] = useState<Set<number>>(new Set())

  const toggleEvidence = (index: number) => {
    setExpandedEvidenceIndices(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }
  const hasConclusion = narrative.conclusion && narrative.conclusion.length > 0
  const hasEvidence = narrative.evidence && narrative.evidence.length > 0
  const hasRisks = narrative.risks && narrative.risks.length > 0
  const hasNextQuestions = narrative.nextQuestions && narrative.nextQuestions.length > 0

  return (
    <Card
      size="small"
      style={{
        borderRadius: 10,
        boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        marginTop: 12,
      }}
    >
      {/* 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <CommentOutlined style={{ color: '#52c41a', fontSize: 16 }} />
        <Text strong style={{ fontSize: 13 }}>AI 解读</Text>
      </div>

      {/* Conclusion (Phase 5H) */}
      {hasConclusion && (
        <div
          style={{
            fontSize: 14,
            lineHeight: 1.7,
            color: '#333',
            marginBottom: 12,
            background: '#f0f5ff',
            padding: '10px 14px',
            borderRadius: 6,
            borderLeft: '3px solid #4E7BF5',
          }}
        >
          <Text strong style={{ fontSize: 12, color: '#4E7BF5', display: 'block', marginBottom: 4 }}>
            结论
          </Text>
          {narrative.conclusion}
        </div>
      )}

      {/* 总结 */}
      <div
        style={{
          fontSize: 14,
          lineHeight: 1.7,
          color: '#333',
          marginBottom: 12,
          background: '#f6fff0',
          padding: '10px 14px',
          borderRadius: 6,
          borderLeft: '3px solid #52c41a',
        }}
      >
        {narrative.summary}
      </div>

      {/* 主要发现 */}
      {narrative.keyFindings.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text strong style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 6 }}>
            主要发现
          </Text>
          {narrative.keyFindings.map((finding, i) => (
            <div
              key={i}
              style={{
                fontSize: 13,
                color: '#444',
                padding: '4px 0 4px 16px',
                position: 'relative',
                lineHeight: 1.6,
              }}
            >
              <span style={{ position: 'absolute', left: 0, color: '#52c41a' }}>•</span>
              {finding}
            </div>
          ))}
        </div>
      )}

      {/* Evidence (Phase 5H enhanced + Phase 5J progressive disclosure) */}
      {hasEvidence && (
        <div style={{ marginBottom: 12 }}>
          <Text strong style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 6 }}>
            证据
          </Text>

          {/* evidenceSummary (Phase 5J) */}
          {narrative.evidenceSummary && (
            <div style={{
              fontSize: 12, color: '#666', marginBottom: 8, padding: '6px 10px',
              background: '#fafafa', borderRadius: 4, border: '1px solid #f0f0f0',
            }}>
              📎 {narrative.evidenceSummary}
            </div>
          )}

          {narrative.evidence.map((e, i) => {
            const isExpanded = expandedEvidenceIndices.has(i)
            const hasDetails = e.sourceFields || e.calculation || e.confidence || e.sqlSnippet
            return (
              <div key={i} style={{ marginBottom: 4 }}>
                {/* Evidence row */}
                <div style={{
                  fontSize: 13, color: '#444', padding: '4px 0 4px 16px',
                  lineHeight: 1.6, position: 'relative',
                }}>
                  <span style={{ position: 'absolute', left: 0, color: '#52c41a' }}>•</span>
                  <span>{e.claim}</span>
                  {e.displayValue && (
                    <span style={{ color: '#333', fontWeight: 500 }}>
                      {' — '}{e.displayValue}
                    </span>
                  )}
                  {!e.displayValue && (e.value || e.significance) && (
                    <span style={{ color: '#666', fontSize: 12 }}>
                      {' — '}
                      {e.value && <span>{e.value}</span>}
                      {e.value && e.significance && <span> · </span>}
                      {e.significance && <span>{e.significance}</span>}
                    </span>
                  )}
                  {/* Inline confidence indicator */}
                  {e.confidence && (
                    <span style={{ marginLeft: 8 }}>{renderConfidence(e.confidence)}</span>
                  )}
                </div>

                {/* "查看证据" button — only show if there are Phase 5J details */}
                {hasDetails && (
                  <div style={{ paddingLeft: 16 }}>
                    <span
                      onClick={() => toggleEvidence(i)}
                      style={{
                        fontSize: 11, color: '#999', cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      {isExpanded ? '收起证据 ▲' : '查看证据 ▼'}
                    </span>
                  </div>
                )}

                {/* Expanded detail panel */}
                {isExpanded && hasDetails && (
                  <div style={{
                    margin: '4px 0 6px 16px', padding: '10px 12px',
                    background: '#fafafa', borderRadius: 6, border: '1px solid #f0f0f0',
                    fontSize: 12, lineHeight: 1.8,
                  }}>
                    {/* 结论来源 */}
                    {e.sourceFields && e.sourceFields.length > 0 && (
                      <div style={{ marginBottom: 6 }}>
                        <Text strong style={{ fontSize: 11, color: '#666', display: 'block' }}>
                          结论来源
                        </Text>
                        <div style={{ color: '#555', paddingLeft: 8 }}>
                          字段：{e.sourceFields.join(', ')}
                          {e.fields.length > 0 && <span>（业务名：{e.fields.join(', ')}）</span>}
                        </div>
                      </div>
                    )}

                    {/* 计算说明 */}
                    {e.calculation && (
                      <div style={{ marginBottom: 6 }}>
                        <Text strong style={{ fontSize: 11, color: '#666', display: 'block' }}>
                          计算说明
                        </Text>
                        <code style={{
                          display: 'block', padding: '6px 8px', background: '#f5f5f5',
                          borderRadius: 4, fontSize: 11, color: '#1d1d1d',
                          fontFamily: "'Consolas', 'Courier New', monospace",
                          whiteSpace: 'pre-wrap', lineHeight: 1.5,
                        }}>
                          {e.calculation}
                        </code>
                      </div>
                    )}

                    {/* SQL snippet */}
                    {e.sqlSnippet && (
                      <div style={{ marginBottom: 6 }}>
                        <Text strong style={{ fontSize: 11, color: '#666', display: 'block' }}>
                          关联查询
                        </Text>
                        <code style={{
                          display: 'block', padding: '6px 8px', background: '#f5f5f5',
                          borderRadius: 4, fontSize: 11, color: '#1d1d1d',
                          fontFamily: "'Consolas', 'Courier New', monospace",
                          whiteSpace: 'pre-wrap', lineHeight: 1.5, maxHeight: 160, overflowY: 'auto',
                        }}>
                          {e.sqlSnippet}
                        </code>
                      </div>
                    )}

                    {/* 可信度 */}
                    {e.confidence && (
                      <div>
                        <Text strong style={{ fontSize: 11, color: '#666', display: 'block' }}>
                          可信度：{renderConfidence(e.confidence)}
                        </Text>
                        {e.confidenceReason && (
                          <div style={{ color: '#555', paddingLeft: 8, fontSize: 11 }}>
                            原因：{e.confidenceReason}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Fallback: old format without Phase 5J fields shows source fields inline */}
                {!hasDetails && e.fields.length > 0 && (
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2, paddingLeft: 16 }}>
                    → 来源字段：{e.fields.join(', ')}
                    {e.sqlSnippet && <span> · SQL: {e.sqlSnippet}</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 数据说明/风险 */}
      {hasRisks && (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: '#fffbe6',
            borderRadius: 6,
            border: '1px solid #ffe58f',
          }}
        >
          <Text style={{ fontSize: 12, color: '#ad8b00' }}>⚠ 数据说明</Text>
          {narrative.risks.map((r, i) => renderRiskItem(r, i))}
        </div>
      )}

      {/* 追问建议 */}
      {hasNextQuestions && (
        <div>
          <Text strong style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 6 }}>
            后续可以追问
          </Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {narrative.nextQuestions.map((q, i) => renderNextQuestion(q, i, onAskQuestion))}
          </div>
        </div>
      )}

      {!narrative.summary && narrative.keyFindings.length === 0 && (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', textAlign: 'center' }}>
          暂无解读内容
        </Text>
      )}
    </Card>
  )
}

export default AiNarrative
