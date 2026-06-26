import React from 'react'
import { Typography } from 'antd'
import { UserOutlined } from '@ant-design/icons'

const { Text } = Typography

interface UserMessageProps {
  content: string
  timestamp?: string
}

const UserMessage: React.FC<UserMessageProps> = ({ content, timestamp }) => {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        marginBottom: 16,
      }}
    >
      <div style={{ maxWidth: '75%' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            marginBottom: 4,
          }}
        >
          <Text style={{ fontSize: 12, color: '#999', marginRight: 6 }}>
            {timestamp
              ? new Date(timestamp).toLocaleTimeString('zh-CN')
              : ''}
          </Text>
          <UserOutlined style={{ fontSize: 14, color: '#1677ff' }} />
        </div>
        <div
          style={{
            background: '#1677ff',
            color: '#fff',
            borderRadius: '12px 12px 4px 12px',
            padding: '10px 14px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.6,
          }}
        >
          {content}
        </div>
      </div>
    </div>
  )
}

export default UserMessage
