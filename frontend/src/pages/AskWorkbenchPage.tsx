import React, { useCallback, useRef } from 'react'
import { Layout, Typography, message, Alert, Button, Space, Table } from 'antd'
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
import ContextChain from '../components/ContextChain'
import { useAskMessages, useCreateMessage, useCreateSession } from '../api/askSessions'
import { useAskStore } from '../stores/askStore'
import { useAiAskStore } from '../stores/aiAskStore'
import { useAiAskService, AiAskError, getAiAskErrorMessage, validateAiAskInput } from '../api/aiAsk'
import { formatCompact } from '../utils/numberFormat'
import type { ProcessInsight, FollowUpQuestion, AiAskResponse } from '../types/aiAsk'

const { Sider, Content } = Layout

const ANALYSIS_STEPS = [
  'AI 正在理解你的问题',
  '正在分析查询计划',
  '正在获取数据',
  '正在生成图表',
  '正在生成解读摘要',
]

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

  // Phase 5H: Context tracking
  const [contextChain, setContextChain] = React.useState<string[]>([])
  const [processInsight, setProcessInsight] = React.useState<ProcessInsight | null>(null)
  const [isFollowUpMode, setIsFollowUpMode] = React.useState(false)
  const contextChainRef = useRef(contextChain)
  contextChainRef.current = contextChain

  const buildProcessInsight = useCallback((
    response: AiAskResponse,
    prevChain: string[],
  ): ProcessInsight => {
    const resp = response as any
    return {
      understoodMetrics: resp.intent.metrics,
      understoodDimensions: resp.intent.dimensions,
      understoodTimeRange: resp.intent.timeRange,
      understoodFilters: resp.intent.filters,
      semanticGaps: (resp.semanticGaps || []).map((g: any) => ({
        field: g.field,
        candidates: g.candidates,
        severity: g.reason === 'not_found' ? 'high' as const : 'medium' as const,
      })),
      analysisStrategy: resp.followUp
        ? `基于上一轮 "${prevChain[prevChain.length - 1] ?? ''}" 的结果，${getFollowUpStrategyLabel(resp.followUp.type)}`
        : '按维度分组汇总，基于规则推荐图表',
      contextChain: [...prevChain, resp.question],
    }
  }, [])

  function getFollowUpStrategyLabel(type: string): string {
    const labels: Record<string, string> = {
      drill_down: '下钻分析',
      why_down: '归因分析',
      time_shift: '时间维切换',
      top_n: '排名分析',
      switch_metric: '指标切换',
      explain_anomaly: '异常解读',
      general_followup: '深入分析',
    }
    return labels[type] || '深入分析'
  }

  const handleSend = useCallback(async (content: string) => {
    // Phase 5I: Input Guard final blocking layer
    const validation = validateAiAskInput(content)
    if (!validation.valid) {
      message.error(validation.error.message)
      return
    }

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

      // Phase 5H: Build messageHistory from previous response for follow-up context
      const prevResponse = useAiAskStore.getState().currentResponse
      const messageHistory = prevResponse
        ? [
            { role: 'user' as const, content: prevResponse.question },
            { role: 'assistant' as const, content: '', responseJson: prevResponse as unknown as Record<string, unknown> },
          ]
        : undefined

      const resp = await adapter.analyze(content, {
        datasourceId,
        datasourceName,
        selectedTables,
        messageHistory,
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

      // Phase 5H: Update context chain and process insight
      const followUp = (resp as any).followUp as FollowUpQuestion | undefined
      const currentChain = contextChainRef.current
      const newChain = followUp
        ? [...currentChain, resp.question]
        : [resp.question]

      setContextChain(newChain)
      setIsFollowUpMode(!!followUp)

      const insight = buildProcessInsight(resp as any, currentChain)
      setProcessInsight(insight)

      // Store in responseHistory
      const msgId = Date.now()
      useAiAskStore.getState().saveResponseForMessage(msgId, resp as any)
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
                <div
                  style={{
                    padding: '24px',
                    background: '#fafafa',
                    borderRadius: 12,
                    marginBottom: 12,
                    border: '1px solid #f0f0f0',
                  }}
                >
                  {/* Skeleton card placeholders */}
                  <div
                    style={{
                      display: 'flex',
                      gap: 12,
                      marginBottom: 20,
                    }}
                  >
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        style={{
                          flex: 1,
                          height: 72,
                          borderRadius: 10,
                          background:
                            `linear-gradient(135deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)`,
                          backgroundSize: '200% 100%',
                          animation: 'pulse 1.5s ease-in-out infinite',
                        }}
                      />
                    ))}
                  </div>

                  {/* Step progress indicator */}
                  <div
                    style={{
                      maxWidth: 360,
                      margin: '0 auto',
                      textAlign: 'left',
                    }}
                  >
                    <Typography.Text
                      type="secondary"
                      style={{
                        display: 'block',
                        textAlign: 'center',
                        marginBottom: 14,
                        fontSize: 13,
                      }}
                    >
                      AI 正在分析你的问题...
                    </Typography.Text>
                    {ANALYSIS_STEPS.map((label, i) => {
                      const stepNum = i + 1
                      let icon = '◻'
                      let color = '#d9d9d9'
                      let fontWeight = 'normal'
                      if (stepNum < analysisStep) {
                        icon = '✅'
                        color = '#52c41a'
                      } else if (stepNum === analysisStep) {
                        icon = '⟳'
                        color = '#4E7BF5'
                        fontWeight = '600'
                      }
                      return (
                        <div
                          key={i}
                          style={{
                            fontSize: 12,
                            color,
                            padding: '5px 0',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontWeight,
                          }}
                        >
                          <span style={{ width: 16, textAlign: 'center' }}>{icon}</span>
                          <span>{label}</span>
                          {stepNum === analysisStep && (
                            <span style={{ marginLeft: 'auto', fontSize: 10, color: '#bbb' }}>
                              进行中...
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* AI result cards */}
              {currentResponse && !isAnalyzing && (
                <div>
                  {/* Phase 5H: Follow-up context indicator */}
                  {isFollowUpMode && (
                    <div style={{
                      marginBottom: 12, padding: '6px 12px', background: '#f0f5ff',
                      borderRadius: 6, border: '1px solid #d9e8ff',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 12 }}>📎</span>
                        <Typography.Text style={{ fontSize: 12, color: '#4E7BF5' }}>基于上一轮继续分析</Typography.Text>
                        {contextChain.length >= 2 && (
                          <Typography.Text style={{ fontSize: 11, color: '#999' }}>
                            上一轮：{contextChain[contextChain.length - 2]}
                          </Typography.Text>
                        )}
                      </div>
                      <Button
                        size="small"
                        type="text"
                        icon={<ClearOutlined />}
                        onClick={() => {
                          setIsFollowUpMode(false)
                          setContextChain([])
                          setProcessInsight(null)
                        }}
                        style={{ fontSize: 12, color: '#999' }}
                      >
                        新会话
                      </Button>
                    </div>
                  )}

                  {contextChain.length > 1 && (
                    <ContextChain
                      contextChain={contextChain}
                      currentIndex={contextChain.length - 1}
                    />
                  )}

                  <IntentCard
                    intent={currentResponse.intent}
                    semanticGaps={currentResponse.semanticGaps}
                    processInsight={processInsight ?? undefined}
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

                  {/* Result summary table — Ant Design Table */}
                  {currentResponse.resultSummary && chartDataRef.current && (
                    <div
                      style={{
                        marginBottom: 12,
                        padding: '12px 16px',
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
                          marginBottom: 10,
                        }}
                      >
                        查询结果（{currentResponse.resultSummary.rowCount} 行 ·{' '}
                        {currentResponse.resultSummary.durationMs}ms
                        {currentResponse.resultSummary.truncated ? ' · 仅展示部分数据' : ''}）
                      </Typography.Text>
                      <Table
                        dataSource={chartDataRef.current.rows.map((row, i) => {
                          const record: Record<string, any> = { _key: i }
                          chartDataRef.current!.columns.forEach((col, ci) => {
                            record[col] = row[ci]
                          })
                          return record
                        })}
                        columns={chartDataRef.current.columns.map((col) => {
                          const colIndex = chartDataRef.current!.columns.indexOf(col)
                          const sampleVal = chartDataRef.current!.rows[0]?.[colIndex]
                          const isNumeric = typeof sampleVal === 'number'
                          return {
                            title: col,
                            dataIndex: col,
                            key: col,
                            sorter: isNumeric
                              ? (a: any, b: any) => (a[col] as number) - (b[col] as number)
                              : (a: any, b: any) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')),
                            align: isNumeric ? 'right' as any : 'left' as any,
                            render: (val: any) => {
                              if (val === null || val === undefined) {
                                return <Typography.Text type="secondary" style={{ fontSize: 12 }}>NULL</Typography.Text>
                              }
                              if (typeof val === 'number') {
                                if (val > 0 && val < 1) return (val * 100).toFixed(2) + '%'
                                if (Math.abs(val) >= 10000) return formatCompact(val, 1)
                                return val.toLocaleString()
                              }
                              if (typeof val === 'string' && val.length > 60) {
                                return (
                                  <Typography.Paragraph
                                    style={{ fontSize: 12, marginBottom: 0 }}
                                    ellipsis={{ rows: 1, tooltip: val }}
                                  >
                                    {val}
                                  </Typography.Paragraph>
                                )
                              }
                              return <span style={{ fontSize: 12 }}>{String(val)}</span>
                            },
                          }
                        })}
                        rowKey="_key"
                        size="small"
                        pagination={{
                          pageSize: 10,
                          size: 'small',
                          showSizeChanger: false,
                          showTotal: (total: number) => `共 ${total} 行`,
                        }}
                        style={{ fontSize: 12 }}
                      />
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
