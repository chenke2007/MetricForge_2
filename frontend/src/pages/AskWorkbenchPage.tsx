import React, { useCallback } from 'react'
import { Layout, Typography, Spin, message } from 'antd'
import { ClearOutlined } from '@ant-design/icons'
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
import { MOCK_ASK_RESPONSE, MOCK_CHART_DATA } from '../api/aiAsk.mock'
import { useAskMessages, useCreateMessage, useCreateSession } from '../api/askSessions'
import { useAskStore } from '../stores/askStore'
import { useAiAskStore } from '../stores/aiAskStore'

const { Sider, Content } = Layout

const AskWorkbenchPage: React.FC = () => {
  const currentSessionId = useAskStore((s) => s.currentSessionId)
  const setCurrentSession = useAskStore((s) => s.setCurrentSession)
  const createMessage = useCreateMessage()
  const createSession = useCreateSession()
  const navigate = useNavigate()

  const { data: messages, isLoading: messagesLoading } =
    useAskMessages(currentSessionId)

  const {
    datasourceId,
    currentResponse,
    isAnalyzing,
    activeChartIndex,
    setCurrentResponse,
    setAnalyzing,
    setActiveChart,
  } = useAiAskStore()

  // 模拟 AI 分析
  const simulateAiAnalysis = useCallback(async (question: string) => {
    setAnalyzing(true)
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 700))
    const mockResponse = {
      ...MOCK_ASK_RESPONSE,
      question,
      sqlPlan: {
        ...MOCK_ASK_RESPONSE.sqlPlan,
        ...(datasourceId ? { datasourceId } : {}),
      },
    }
    setCurrentResponse(mockResponse)
    setAnalyzing(false)
  }, [datasourceId, setAnalyzing, setCurrentResponse])

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
      await simulateAiAnalysis(content)
    } catch {
      message.error('发送失败，请重试')
    }
  }, [currentSessionId, createSession, setCurrentSession, createMessage, simulateAiAnalysis])

  const handlePromptSelect = useCallback((prompt: string) => {
    handleSend(prompt)
  }, [handleSend])

  const handleAskQuestion = useCallback((question: string) => {
    handleSend(question)
  }, [handleSend])

  const handleOpenInWorkbench = useCallback((sql: string, dsId: number) => {
    const encoded = encodeURIComponent(sql)
    navigate(`/sql-workbench?dsId=${dsId}&sql=${encoded}`)
  }, [navigate])

  const [agentMode] = React.useState('ask')

  const showEmptyState = !currentSessionId
  const showWelcomeState = currentSessionId && !currentResponse && !isAnalyzing
  const showResultsState = currentSessionId && (currentResponse || isAnalyzing)

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
            {/* Messages area */}
            {messages && (
              <MessageThread
                messages={messages ?? []}
                isLoading={messagesLoading}
              />
            )}

            {/* Welcome hero + input */}
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

                <PromptCards onSelect={handlePromptSelect} />
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
            {/* Message history + AI results area */}
            <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
              {messages && (
                <MessageThread
                  messages={messages ?? []}
                  isLoading={messagesLoading}
                />
              )}

              {/* AI analyzing indicator */}
              {isAnalyzing && (
                <div style={{ padding: '20px 0', textAlign: 'center' }}>
                  <Spin />
                  <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                    正在分析你的问题...
                  </Typography.Text>
                </div>
              )}

              {/* AI result cards */}
              {currentResponse && !isAnalyzing && (
                <div>
                  {/* Intent card */}
                  <IntentCard
                    intent={currentResponse.intent}
                    semanticGaps={currentResponse.semanticGaps}
                  />

                  {/* Semantic gap alert */}
                  {currentResponse.semanticGaps.filter(
                    (g) => g.reason === 'not_found'
                  ).length > 0 && (
                    <SemanticGapAlert gaps={currentResponse.semanticGaps} />
                  )}

                  {/* SQL plan */}
                  <SqlPlan
                    sqlPlan={currentResponse.sqlPlan}
                    onOpenInWorkbench={handleOpenInWorkbench}
                  />

                  {/* Result summary table */}
                  {currentResponse.resultSummary && (
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
                            {MOCK_CHART_DATA.columns.map((col) => (
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
                          {MOCK_CHART_DATA.rows.map((row, ri) => (
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
                      columns={MOCK_CHART_DATA.columns}
                      rows={MOCK_CHART_DATA.rows}
                      activeIndex={activeChartIndex}
                      onActiveChange={setActiveChart}
                    />
                  )}

                  {/* AI narrative */}
                  <AiNarrative
                    narrative={currentResponse.narrative}
                    onAskQuestion={handleAskQuestion}
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
