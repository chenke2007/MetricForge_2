import React from 'react'
import { Card, Typography } from 'antd'
import { CommentOutlined } from '@ant-design/icons'
import type { AiInsightNarrative } from '../types/aiAsk'

const { Text } = Typography

interface AiNarrativeProps {
  narrative: AiInsightNarrative
  onAskQuestion?: (question: string) => void
}

const AiNarrative: React.FC<AiNarrativeProps> = ({ narrative, onAskQuestion }) => {
  const renderRisk = (risk: string | AiInsightNarrative['risks'][number]): string => {
    if (typeof risk === 'string') return risk
    return risk.risk || '未知风险'
  }

  const renderQuestion = (q: string | AiInsightNarrative['nextQuestions'][number]): string => {
    if (typeof q === 'string') return q
    return q.question || '继续追问'
  }
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

      {/* 数据说明/风险 */}
      {narrative.risks.length > 0 && (
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
          {narrative.risks.map((risk, i) => (
            <div key={i} style={{ fontSize: 12, color: '#8c6e00', marginTop: 2 }}>
              • {renderRisk(risk)}
            </div>
          ))}
        </div>
      )}

      {/* 追问建议 */}
      {narrative.nextQuestions.length > 0 && (
        <div>
          <Text strong style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 6 }}>
            后续可以追问
          </Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {narrative.nextQuestions.map((q, i) => (
              <div
                key={i}
                onClick={() => onAskQuestion?.(renderQuestion(q))}
                style={{
                  padding: '5px 12px',
                  borderRadius: 16,
                  border: '1px solid #d9e8ff',
                  background: '#f0f5ff',
                  fontSize: 12,
                  color: '#4E7BF5',
                  cursor: onAskQuestion ? 'pointer' : 'default',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#d9e8ff'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#f0f5ff'
                }}
              >
                {renderQuestion(q)}
              </div>
            ))}
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
