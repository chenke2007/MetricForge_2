import React, { useCallback, useRef } from 'react'
import { Layout, Typography, message, Alert, Button, Space } from 'antd'
import { ClearOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import SessionList from '../components/SessionList'
import MessageThread from '../components/MessageThread'
import AgentNav from '../components/AgentNav'
import DataScopeSelector from '../components/DataScopeSelector'
import PromptCards from '../components/PromptCards'
import AskInput from '../components/AskInput'
import IntentCard from '../components/IntentCard'
import SqlPlan from '../components/SqlPlan'
import AiChartBoard from '../components/AiChartBoard'
import AiNarrative from '../components/AiNarrative'
import SemanticGapAlert from '../components/SemanticGapAlert'
import { useAskMessages, useCreateMessage, useCreateSession } from '../api/askSessions'
import { useAskStore } from '../stores/askStore'
import { useAiAskStore } from '../stores/aiAskStore'
import { useAiAskService, AiAskError, getAiAskErrorMessage } from '../api/aiAsk'

const { Sider, Content } = Layout

const AskWorkbenchPage: React.FC = () => {
  const currentSessionId = useAskStore((s) => s.currentSessionId)
  const setCurrentSession = useAskStore((s) => s.setCurrentSession)
  const createMessage = useCreateMessage()
  const createSession = useCreateSession()
  const navigate = useNavigate()

  const { data: messages, isLoading: messagesLoading } = useAskMessages(currentSessionId)

  const {
    datasourceId,
    datasourceName,
    selectedTables,
    currentResponse,
    isAnalyzing,
    error: storeError,
    activeChartIndex,
    analysisStep,
    setCurrentResponse,
    setAnalyzing,
    setActiveChart,
    setAnalysisStep,
    setAdapterName,
    setResponseValidation,
    setError,
    clearError,
  } = useAiAskStore()

  const adapter = useAiAskService()
  const chartDataRef = useRef<{ columns: string[]; rows: any[][] } | null>(null)

  const handleSend = useCallback(async (content: string) => {
    let sessionId = currentSessionId
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
      await createMessage.mutateAsync({ sessionId, content })
    } catch {
      message.error('发送失败，请重试')
      return
    }

    // Use adapter
    clearError()
    setAdapterName(adapter.name)
    setAnalyzing(true)
    setAnalysisStep(1)

    try {
      // Simulate step progression
      const stepInterval = setInterval(() => {
        const current = useAiAskStore.getState().analysisStep
        if (current < 5) {
          useAiAskStore.getState().setAnalysisStep(current + 1)
        } else {
          clearInterval(stepInterval)
        }
      }, 800)

      const resp = await adapter.analyze(content, {
        datasourceId,
        datasourceName,
        selectedTables,
        options: { mockDelay: [1500, 2500] },
      })

      clearInterval(stepInterval)
      setAnalysisStep(5)

      // Validate
      const validation = adapter.validate(resp as any)
      setResponseValidation(validation)

      // Store chart data from adapter
      chartDataRef.current = adapter.getChartData(resp.chartSuggestions[0], resp as any)

      setCurrentResponse(resp as any)
      setAnalyzing(false)
    } catch (err) {
      setAnalyzing(false)
      if (err instanceof AiAskError) {
        setError(err)
      } else {
        setError(new AiAskError('分析异常', 'UNKNOWN'))
      }
    }
  }, [
    currentSessionId, createSession, setCurrentSession,
    createMessage, datasourceId, datasourceName, selectedTables,
    adapter, clearError, setAdapterName, setAnalyzing, setAnalysisStep,
    setResponseValidation, setCurrentResponse, setError,
  ])

  const handleOpenInWorkbench = useCallback((sql: string, dsId: number) => {
    const encoded = encodeURIComponent(sql)
    navigate(`/sql-workbench?dsId=${dsId}&sql=${encoded}`)
  }, [navigate])

  const [agentMode] = React.useState('ask')

  const showEmptyState = !currentSessionId
  const showWelcomeState = currentSessionId && !currentResponse && !isAnalyzing && !storeError
  const showResultsState = currentSessionId && (currentResponse || isAnalyzing || storeError)

  return (
    <Layout style={{ height: 'calc(100vh - 104px)', background: '#fff' }}>
      {/* Left sidebar */}
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
            onSelect={(id) => {
              setCurrentSession(id || null)
              if (!id) setCurrentResponse(null)
            }}
          />
        </div>
      </Sider>

      {/* Main content area */}
      <Content
        style={{
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Agent nav bar */}
        <div
          style={{
            background: '#fff',
            borderBottom: '1px solid #f0f0f0',
            padding: '0 24px',
          }}
        >
          <AgentNav activeKey={agentMode} onChange={() => {}} />
        </div>

        {/* Empty state */}
        {showEmptyState && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
            }}
          >
            <ClearOutlined style={{ fontSize: 48, color: '#d9d9d9', marginBottom: 16 }} />
            <Typography.Title level={4} type="secondary">
              选择或创建一个对话开始提问
            </Typography.Title>
            <Typography.Text type="secondary">
              左侧列表管理你的所有对话历史
            </Typography.Text>
          </div>
        )}

        {/* Welcome state */}
        {showWelcomeState && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'auto',
              padding: '16px 24px',
            }}
          >
            {messages && (
              <MessageThread
                messages={messages ?? []}
                isLoading={messagesLoading}
              />
            )}

            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                padding: '40px 60px',
              }}
            >
              <div style={{ maxWidth: 680, width: '100%', margin: '0 auto' }}>
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
                    用自然语言描述你的业务问题，AI 将自动分析数据并生成图表和报告
                  </Typography.Text>
                </div>

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
                    autoFocus
                  />
                </div>

                <PromptCards onSelect={handleSend} />
              </div>
            </div>
          </div>
        )}

        {/* Results state */}
        {showResultsState && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
              {messages && (
                <MessageThread
                  messages={messages ?? []}
                  isLoading={messagesLoading}
                />
              )}

              {/* Error state */}
              {storeError && !isAnalyzing && (
                <Alert
                  type="error"
                  showIcon
                  style={{ borderRadius: 8, marginBottom: 12 }}
                  message={
                    <div>
                      <div style={{ fontWeight: 500, marginBottom: 4 }}>分析异常</div>
                      <div style={{ fontSize: 12 }}>{getAiAskErrorMessage(storeError.code)}</div>
                      {storeError.code && (
                        <Space style={{ marginTop: 6 }}>
                          <Button size="small" icon={<ReloadOutlined />} onClick={() => clearError()}>关闭</Button>
                        </Space>
                      )}
                    </div>
                  }
                />
              )}

              {/* Analyzing with skeleton + step indicator */}
              {isAnalyzing && (
                <div style={{ padding: '20px 24px', textAlign: 'center' }}>
                  <div style={{
                    display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 16,
                  }}>
                    {[1, 2, 3].map((i) => (
                      <div key={i} style={{
                        width: 100, height: 60, borderRadius: 8,
                        background: '#f0f0f0', animation: 'pulse 1.5s ease-in-out infinite',
                      }} />
                    ))}
                  </div>
                  <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                    正在分析你的问题...
                  </Typography.Text>
                  <div style={{ maxWidth: 320, margin: '0 auto', textAlign: 'left' }}>
                    {[
                      'AI 正在理解你的问题',
                      '正在分析查询计划',
                      '正在获取数据',
                      '正在生成图表',
                      '正在生成解读摘要',
                    ].map((label, i) => {
                      const stepNum = i + 1
                      let icon = '◻'
                      let color = '#d9d9d9'
                      if (stepNum < analysisStep) { icon = '✅'; color = '#52c41a' }
                      else if (stepNum === analysisStep) { icon = '⟳'; color = '#4E7BF5' }
                      return (
                        <div key={i} style={{
                          fontSize: 12, color, padding: '4px 0', display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                          <span>{icon}</span>
                          <span>{label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* AI result cards */}
              {currentResponse && !isAnalyzing && (
                <div>
                  <IntentCard
                    intent={currentResponse.intent}
                    semanticGaps={currentResponse.semanticGaps}
                  />

                  {currentResponse.semanticGaps.filter(
                    (g) => g.reason === 'not_found'
                  ).length > 0 && (
                    <SemanticGapAlert gaps={currentResponse.semanticGaps} />
                  )}

                  <SqlPlan
                    sqlPlan={currentResponse.sqlPlan}
                    onOpenInWorkbench={handleOpenInWorkbench}
                  />

                  {/* Result summary table */}
                  {currentResponse.resultSummary && chartDataRef.current && (
                    <div
                      style={{
                        marginBottom: 12,
                        padding: '8px 12px',
                        background: '#fafafa',
                        borderRadius: 8,
                        border: '1px solid #f0f0f0',
                      }}
                    >
                      <Typography.Text
                        strong
                        style={{
                          fontSize: 12,
                          color: '#666',
                          display: 'block',
                          marginBottom: 8,
                        }}
                      >
                        查询结果（{currentResponse.resultSummary.rowCount} 行 ·{' '}
                        {currentResponse.resultSummary.durationMs}ms）
                      </Typography.Text>
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          fontSize: 13,
                        }}
                      >
                        <thead>
                          <tr style={{ background: '#f5f5f5' }}>
                            {chartDataRef.current.columns.map((col) => (
                              <th
                                key={col}
                                style={{
                                  padding: '6px 10px',
                                  textAlign: 'left',
                                  borderBottom: '1px solid #e8e8e8',
                                  fontWeight: 500,
                                  fontSize: 12,
                                  color: '#666',
                                }}
                              >
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {chartDataRef.current.rows.map((row, ri) => (
                            <tr key={ri}>
                              {row.map((cell: any, ci: number) => (
                                <td
                                  key={ci}
                                  style={{
                                    padding: '6px 10px',
                                    borderBottom: '1px solid #f0f0f0',
                                    fontSize: 12,
                                    textAlign:
                                      typeof cell === 'number' ? 'right' : 'left',
                                  }}
                                >
                                  {typeof cell === 'number'
                                    ? cell.toLocaleString()
                                    : cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* AI chart board */}
                  {currentResponse.chartSuggestions.length > 0 && (
                    <AiChartBoard
                      chartSuggestions={currentResponse.chartSuggestions}
                      columns={chartDataRef.current?.columns ?? []}
                      rows={chartDataRef.current?.rows ?? []}
                      activeIndex={activeChartIndex}
                      onActiveChange={setActiveChart}
                    />
                  )}

                  <AiNarrative
                    narrative={currentResponse.narrative}
                    onAskQuestion={handleSend}
                  />
                </div>
              )}
            </div>

            {/* Fixed bottom input */}
            <div
              style={{
                borderTop: '1px solid #f0f0f0',
                padding: '12px 24px',
                background: '#fff',
              }}
            >
              <AskInput
                onSend={handleSend}
                loading={isAnalyzing}
              />
            </div>
          </div>
        )}
      </Content>
    </Layout>
  )
}

export default AskWorkbenchPage
