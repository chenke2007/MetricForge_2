import React, { useCallback, useState } from 'react'
import { message, Layout, Typography } from 'antd'
import { ClearOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import SessionList from '../components/SessionList'
import MessageThread from '../components/MessageThread'
import ToolCallIndicator from '../components/ToolCallIndicator'
import AskInput from '../components/AskInput'
import {
  useAskMessages,
  useCreateMessage,
} from '../api/askSessions'
import { useAskStore } from '../stores/askStore'
import type { ToolCallRecord } from '../api/askSessions'

const { Sider, Content } = Layout

const AskWorkbenchPage: React.FC = () => {
  const qc = useQueryClient()
  const currentSessionId = useAskStore((s) => s.currentSessionId)
  const setCurrentSession = useAskStore((s) => s.setCurrentSession)
  const startStream = useAskStore((s) => s.startStream)
  const appendToken = useAskStore((s) => s.appendToken)
  const stopStream = useAskStore((s) => s.stopStream)

  const { data: messages, isLoading: messagesLoading } =
    useAskMessages(currentSessionId)
  const createMessage = useCreateMessage()
  const [streamingActive, setStreamingActive] = useState(false)
  const [toolCalls, setToolCalls] = useState<ToolCallRecord[] | null>(null)

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
        setStreamingActive(true)

        const token = Date.now().toString(36)
        const streamUrl = `/api/ask/sessions/${currentSessionId}/stream?after=${assistantId}&_t=${token}`
        const es = new EventSource(streamUrl)

        await new Promise<void>((resolve) => {
          let handled = false
          const cleanup = () => {
            if (handled) return
            handled = true
            es.close()
            stopStream()
            setStreamingActive(false)
            setToolCalls(null)
            qc.invalidateQueries({
              queryKey: ['askSessions', currentSessionId],
            })
            qc.invalidateQueries({
              queryKey: ['askSessions', currentSessionId, 'messages'],
            })
            qc.invalidateQueries({ queryKey: ['askSessions'] })
            resolve()
          }

          es.addEventListener('token', (e) => {
            try {
              const data = JSON.parse((e as MessageEvent).data)
              if (data.delta) appendToken(data.delta)
            } catch {
              // ignore parse errors
            }
          })

          es.addEventListener('tool_call_start', (e) => {
            try {
              const data = JSON.parse((e as MessageEvent).data)
              setToolCalls(
                data.tool_names.map((name: string, idx: number) => ({
                  id: idx,
                  message_id: data.message_id,
                  tool_name: name,
                  arguments: '{}',
                  result: null,
                  status: 'running',
                  error_message: null,
                  created_at: new Date().toISOString(),
                }))
              )
            } catch {
              // ignore parse errors
            }
          })

          es.addEventListener('tool_call_done', (e) => {
            try {
              const data = JSON.parse((e as MessageEvent).data)
              setToolCalls(data.tool_calls)
            } catch {
              // ignore parse errors
            }
          })

          es.addEventListener('error', (e) => {
            try {
              const data = JSON.parse((e as MessageEvent).data)
              const errMsg = data.error || data.detail || '流式响应出错'
              message.error(errMsg)
              cleanup()
            } catch {
              // ignore parse errors
            }
          })

          es.addEventListener('done', () => {
            cleanup()
          })

          es.onerror = () => {
            message.error('SSE 连接失败')
            cleanup()
          }
        })
      } catch (err: any) {
        if (err.name === 'AbortError') return
        stopStream()
        setStreamingActive(false)
        message.error('发送失败，请重试')
      }
    },
    [currentSessionId, createMessage, qc, startStream, appendToken, stopStream, setStreamingActive, setToolCalls]
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
            {toolCalls && <ToolCallIndicator tool_calls={toolCalls} />}
            <div
              style={{
                borderTop: '1px solid #f0f0f0',
                padding: '12px 24px',
                background: '#fff',
              }}
            >
              <AskInput onSend={handleSend} loading={createMessage.isPending} disabled={streamingActive} />
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
