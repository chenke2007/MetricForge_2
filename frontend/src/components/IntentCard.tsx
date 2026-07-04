import React from 'react'
import { Card, Tag, Typography, Space } from 'antd'
import { BulbOutlined } from '@ant-design/icons'
import type { AiAskResponse } from '../types/aiAsk'

const { Text } = Typography

interface IntentCardProps {
  intent: AiAskResponse['intent']
  semanticGaps: AiAskResponse['semanticGaps']
}

const IntentCard: React.FC<IntentCardProps> = ({ intent, semanticGaps }) => {
  return (
    <Card
      size="small"
      style={{
        borderRadius: 10,
        boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <BulbOutlined style={{ color: '#faad14', fontSize: 16 }} />
        <Text strong style={{ fontSize: 13 }}>AI 理解到的分析意图</Text>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>指标</Text>
          <Space size={4}>
            {intent.metrics.map((m) => (
              <Tag key={m} color="blue" style={{ fontSize: 11, borderRadius: 4 }}>
                {m}
              </Tag>
            ))}
          </Space>
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>维度</Text>
          <Space size={4}>
            {intent.dimensions.map((d) => (
              <Tag key={d} color="green" style={{ fontSize: 11, borderRadius: 4 }}>
                {d}
              </Tag>
            ))}
          </Space>
        </div>
        {intent.filters.length > 0 && (
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>筛选条件</Text>
            <Space size={4}>
              {intent.filters.map((f) => (
                <Tag key={f} color="orange" style={{ fontSize: 11, borderRadius: 4 }}>
                  {f}
                </Tag>
              ))}
            </Space>
          </div>
        )}
        {intent.timeRange && (
          <div>
            <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>时间范围</Text>
            <Tag color="purple" style={{ fontSize: 11, borderRadius: 4 }}>
              {intent.timeRange}
            </Tag>
          </div>
        )}
        {!intent.metrics.length && !intent.dimensions.length && !intent.timeRange && (
          <Text type="secondary" style={{ fontSize: 12 }}>暂无意图信息</Text>
        )}
      </div>
      {semanticGaps.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #f0f0f0' }}>
          {semanticGaps.map((gap) => (
            <div key={gap.field} style={{ fontSize: 12, color: '#fa8c16', marginBottom: 2 }}>
              ⚠ AI 推测 "{gap.field}" 的含义
              {gap.suggestion && <span>，{gap.suggestion}</span>}
              {gap.candidates && gap.candidates.length > 0 && (
                <span style={{ color: '#8c8c8c' }}>
                  {' '}（候选字段：{gap.candidates.join('、')}）
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export default IntentCard
