import React, { useEffect, useRef } from 'react'
import { Empty, Typography } from 'antd'
import type { AskMessage } from '../api/askSessions'
import UserMessage from './UserMessage'
import AssistantMessage from './AssistantMessage'
import StreamingMessage from './StreamingMessage'
import ToolCallIndicator from './ToolCallIndicator'
import { useAskStore } from '../stores/askStore'

interface MessageThreadProps {
  messages: AskMessage[]
  isLoading?: boolean
}

const MessageThread: React.FC<MessageThreadProps> = ({
  messages,
  isLoading: _isLoading,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null)
  const streaming = useAskStore((s) => s.streaming)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming?.content])

  return (
    <div
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '16px 24px',
      }}
    >
      {messages.length === 0 && !streaming?.visible && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <Empty description="开始你的第一个问题" />
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              你可以问我关于数据的问题，例如：
            </Typography.Text>
            <div style={{ marginTop: 12, color: '#999', fontSize: 13 }}>
              <div>• 近30天新增客户数是多少？</div>
              <div>• 本月合同金额排名前十的客户</div>
              <div>• 按业务类型统计逾期率</div>
            </div>
          </div>
        </div>
      )}

      {messages.length > 0 && (
        <div>
          {messages.map((msg) =>
            msg.role === 'user' ? (
              <UserMessage
                key={msg.id}
                content={msg.content}
                timestamp={msg.created_at}
              />
            ) : (
              <div key={msg.id}>
                {msg.tool_calls && msg.tool_calls.length > 0 && (
                  <ToolCallIndicator tool_calls={msg.tool_calls} />
                )}
                <AssistantMessage
                  content={msg.content}
                  timestamp={msg.created_at}
                />
              </div>
            )
          )}
        </div>
      )}

      {streaming?.visible && <StreamingMessage content={streaming.content} />}

      <div ref={bottomRef} />
    </div>
  )
}

export default MessageThread
