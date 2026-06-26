import React from 'react'
import { Typography, Spin } from 'antd'
import { RobotOutlined } from '@ant-design/icons'
import MarkdownRenderer from './MarkdownRenderer'

const { Text } = Typography

interface StreamingMessageProps {
  content: string
}

const StreamingMessage: React.FC<StreamingMessageProps> = ({ content }) => {
  const isEmpty = !content

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
          <Text style={{ fontSize: 12, color: '#999' }}>AI 助手 正在输入</Text>
        </div>
        <div
          style={{
            background: '#f6f8fa',
            borderRadius: '12px 12px 12px 4px',
            padding: '10px 14px',
            border: '1px solid #e8e8e8',
            minHeight: 40,
            lineHeight: 1.6,
          }}
        >
          {isEmpty ? (
            <Spin size="small" />
          ) : (
            <>
              <MarkdownRenderer content={content} />
              <span
                style={{
                  animation: 'blink 1s step-end infinite',
                  display: 'inline-block',
                  width: 8,
                  height: 16,
                  background: '#1677ff',
                  marginLeft: 2,
                  verticalAlign: 'middle',
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default StreamingMessage
