import React from 'react'
import { Typography } from 'antd'
import { RobotOutlined } from '@ant-design/icons'
import MarkdownRenderer from './MarkdownRenderer'

const { Text } = Typography

interface AssistantMessageProps {
  content: string
  timestamp?: string
}

const AssistantMessage: React.FC<AssistantMessageProps> = ({
  content,
  timestamp,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        marginBottom: 16,
      }}
    >
      <div style={{ maxWidth: '85%' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: 4,
          }}
        >
          <RobotOutlined style={{ fontSize: 14, color: '#52c41a', marginRight: 6 }} />
          <Text style={{ fontSize: 12, color: '#999' }}>
            AI 助手
            {timestamp
              ? ` · ${new Date(timestamp).toLocaleTimeString('zh-CN')}`
              : ''}
          </Text>
        </div>
        <div
          style={{
            background: '#f6f8fa',
            borderRadius: '12px 12px 12px 4px',
            padding: '10px 14px',
            border: '1px solid #e8e8e8',
            lineHeight: 1.6,
            wordBreak: 'break-word',
          }}
        >
          <MarkdownRenderer content={content} />
        </div>
      </div>
    </div>
  )
}

export default AssistantMessage
