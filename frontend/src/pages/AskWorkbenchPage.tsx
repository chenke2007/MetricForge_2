import React, { useCallback } from 'react'
import { message, Layout, Typography } from 'antd'
import { ClearOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import SessionList from '../components/SessionList'
import MessageThread from '../components/MessageThread'
import AskInput from '../components/AskInput'
import {
  useAskMessages,
  useCreateMessage,
} from '../api/askSessions'
import { useAskStore } from '../stores/askStore'

const { Sider, Content } = Layout

const AskWorkbenchPage: React.FC = () => {
  const qc = useQueryClient()
  const currentSessionId = useAskStore((s) => s.currentSessionId)
  const setCurrentSession = useAskStore((s) => s.setCurrentSession)
  const streaming = useAskStore((s) => s.streaming)
  const startStream = useAskStore((s) => s.startStream)
  const appendToken = useAskStore((s) => s.appendToken)
  const stopStream = useAskStore((s) => s.stopStream)

  const { data: messages, isLoading: messagesLoading } =
    useAskMessages(currentSessionId)
  const createMessage = useCreateMessage()

  const handleSend = useCallback(
    async (content: string) => {
      if (!currentSessionId) {
        message.warning('请先创建或选择一个对话')
        return
      }

      try {
        const result = await createMessage.mutateAsync({
          sessionId: currentSessionId,
          content,
        })
        const assistantId = result.assistant_message.id

        // Invalidate session query to refresh messages
        qc.invalidateQueries({
          queryKey: ['askSessions', currentSessionId],
        })
        qc.invalidateQueries({
          queryKey: ['askSessions', currentSessionId, 'messages'],
        })

        // Start SSE stream
        startStream(assistantId)
        const controller = new AbortController()

        const token = Date.now().toString(36)
        const response = await fetch(
          `/api/ask/sessions/${currentSessionId}/stream?after=${assistantId}&_t=${token}`,
          { signal: controller.signal }
        )

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let buffer = ''
        let currentEvent = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim()
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                if (currentEvent === 'token' && data.delta) {
                  appendToken(data.delta)
                } else if (currentEvent === 'error') {
                  const errMsg = data.error || data.detail || '流式响应出错'
                  stopStream()
                  message.error(errMsg)
                  qc.invalidateQueries({
                    queryKey: ['askSessions', currentSessionId],
                  })
                  qc.invalidateQueries({
                    queryKey: ['askSessions', currentSessionId, 'messages'],
                  })
                  qc.invalidateQueries({ queryKey: ['askSessions'] })
                  return // exit cleanly
                }
              } catch {
                // ignore parse errors
              }
            } else if (line === '' && currentEvent === 'done') {
              // End of stream
            }
          }
        }

        stopStream()
        qc.invalidateQueries({
          queryKey: ['askSessions', currentSessionId],
        })
        qc.invalidateQueries({
          queryKey: ['askSessions', currentSessionId, 'messages'],
        })
        qc.invalidateQueries({ queryKey: ['askSessions'] })
      } catch (err: any) {
        if (err.name === 'AbortError') return
        stopStream()
        message.error('发送失败，请重试')
      }
    },
    [currentSessionId, createMessage, qc, startStream, appendToken, stopStream]
  )

  return (
    <Layout style={{ height: 'calc(100vh - 104px)', background: '#fff' }}>
      <Sider
        width={220}
        style={{
          background: '#fafafa',
          borderRight: '1px solid #f0f0f0',
          overflow: 'auto',
        }}
      >
        <SessionList
          currentId={currentSessionId}
          onSelect={(id) => setCurrentSession(id || null)}
        />
      </Sider>
      <Content
        style={{
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {currentSessionId ? (
          <>
            <MessageThread
              messages={messages ?? []}
              isLoading={messagesLoading}
            />
            <div
              style={{
                borderTop: '1px solid #f0f0f0',
                padding: '12px 24px',
                background: '#fff',
              }}
            >
              <AskInput onSend={handleSend} loading={createMessage.isPending} disabled={streaming?.visible ?? false} />
            </div>
          </>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <ClearOutlined
                style={{ fontSize: 48, color: '#d9d9d9', marginBottom: 16 }}
              />
              <Typography.Title level={4} type="secondary">
                选择或创建一个对话开始提问
              </Typography.Title>
              <Typography.Text type="secondary">
                左侧列表管理你的所有对话历史
              </Typography.Text>
            </div>
          </div>
        )}
      </Content>
    </Layout>
  )
}

export default AskWorkbenchPage
