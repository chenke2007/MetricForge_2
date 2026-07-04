import React, { useCallback, useState } from 'react'
import { message, Layout, Typography } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import SessionList from '../components/SessionList'
import MessageThread from '../components/MessageThread'
import ToolCallIndicator from '../components/ToolCallIndicator'
import AskInput from '../components/AskInput'
import AgentNav from '../components/AgentNav'
import DataScopeSelector from '../components/DataScopeSelector'
import PromptCards from '../components/PromptCards'
import {
  useAskMessages,
  useCreateMessage,
  useCreateSession,
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
  const createSession = useCreateSession()
  const [streamingActive, setStreamingActive] = useState(false)
  const [toolCalls, setToolCalls] = useState<ToolCallRecord[] | null>(null)

  // Flow: ensure session exists, then send the message
  const ensureSessionAndSend = useCallback(
    async (content: string) => {
      let sessionId = currentSessionId

      // Auto-create session if none selected
      if (!sessionId) {
        try {
          const newSession = await createSession.mutateAsync({})
          sessionId = newSession.id
          setCurrentSession(sessionId)
        } catch {
          message.error('创建会话失败，请重试')
          return
        }
      }

      try {
        const result = await createMessage.mutateAsync({
          sessionId,
          content,
        })
        const assistantId = result.assistant_message.id

        qc.invalidateQueries({
          queryKey: ['askSessions', sessionId],
        })
        qc.invalidateQueries({
          queryKey: ['askSessions', sessionId, 'messages'],
        })

        startStream(assistantId)
        setStreamingActive(true)

        const token = Date.now().toString(36)
        const streamUrl = `/api/ask/sessions/${sessionId}/stream?after=${assistantId}&_t=${token}`
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
              queryKey: ['askSessions', sessionId],
            })
            qc.invalidateQueries({
              queryKey: ['askSessions', sessionId, 'messages'],
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
    [
      currentSessionId,
      createSession,
      setCurrentSession,
      createMessage,
      qc,
      startStream,
      appendToken,
      stopStream,
    ]
  )

  const handleSend = useCallback(
    (content: string) => {
      ensureSessionAndSend(content)
    },
    [ensureSessionAndSend]
  )

  const handlePromptSelect = useCallback(
    (prompt: string) => {
      ensureSessionAndSend(prompt)
    },
    [ensureSessionAndSend]
  )

  const [agentMode, setAgentMode] = useState<string>('ask')

  const showWelcome = !currentSessionId

  return (
    <>
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: '0 4px',
          marginBottom: 12,
        }}
      >
        <AgentNav activeKey={agentMode} onChange={setAgentMode} />
      </div>
      <Layout style={{ height: 'calc(100vh - 184px)', background: '#fff' }}>
        <Sider
          width={220}
          style={{
            background: '#fafafa',
            borderRight: '1px solid #f0f0f0',
            overflow: 'auto',
          }}
        >
          <div style={{ padding: '0 12px' }}>
            <DataScopeSelector />
          </div>
          <div style={{ padding: '0 12px' }}>
            <SessionList
              currentId={currentSessionId}
              onSelect={(id) => setCurrentSession(id || null)}
            />
          </div>
        </Sider>
        <Content
          style={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {showWelcome ? (
            /* 欢迎态：无会话时展示智能问数导览 */
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '40px 60px',
                overflow: 'auto',
              }}
            >
              <div style={{ maxWidth: 680, width: '100%' }}>
                {/* 头部 */}
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                  <Typography.Title
                    level={3}
                    style={{ marginBottom: 8, color: '#262626', fontWeight: 600 }}
                  >
                    MetricForge 智能问数
                  </Typography.Title>
                  <Typography.Text
                    style={{
                      display: 'block',
                      color: '#8c8c8c',
                      fontSize: 14,
                      lineHeight: 1.6,
                    }}
                  >
                    用自然语言描述你的业务问题，AI 将自动分析 Oracle 数据仓库，
                    <br />
                    生成 SQL、图表和洞察报告
                  </Typography.Text>
                </div>

                {/* 主输入区 */}
                <div
                  style={{
                    background: '#fafafa',
                    borderRadius: 12,
                    padding: '20px 24px 16px',
                    marginBottom: 24,
                    border: '1px solid #f0f0f0',
                  }}
                >
                  <AskInput
                    onSend={handleSend}
                    loading={createMessage.isPending || createSession.isPending}
                    disabled={streamingActive}
                    autoFocus
                  />
                </div>

                {/* 提示词卡片 */}
                <PromptCards onSelect={handlePromptSelect} />
              </div>
            </div>
          ) : (
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
                <AskInput
                  onSend={handleSend}
                  loading={createMessage.isPending}
                  disabled={streamingActive}
                />
              </div>
            </>
          )}
        </Content>
      </Layout>
    </>
  )
}

export default AskWorkbenchPage
