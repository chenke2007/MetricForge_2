import React, { useCallback, useRef, useEffect } from 'react'
import { Layout, Typography, message, Alert, Button, Space, Tooltip, Table } from 'antd'
import { ClearOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import SessionList from '../components/SessionList'
import MessageThread from '../components/MessageThread'
import AgentNav from '../components/AgentNav'
import DataScopeBar from '../components/DataScopeBar'
import PromptCards from '../components/PromptCards'
import AskInput from '../components/AskInput'
import IntentCard from '../components/IntentCard'
import SqlPlan from '../components/SqlPlan'
import AiChartBoard from '../components/AiChartBoard'
import AiNarrative from '../components/AiNarrative'
import SemanticGapAlert from '../components/SemanticGapAlert'
import ContextChain from '../components/ContextChain'
import SqlValidationAlert from '../components/SqlValidationAlert'
import { useAskMessages, useCreateMessage, useCreateSession, useUpdateSessionTitle, useAskSession } from '../api/askSessions'
import { useLlmSettings } from '../api/llmSettings'
import { useAskStore } from '../stores/askStore'
import { useAiAskStore } from '../stores/aiAskStore'
import { useAiAskService, AiAskError, getAiAskErrorMessage, validateAiAskInput, buildMessageHistory, validateAiAskResponse } from '../api/aiAsk'
import { navigateToExternal } from '../utils/navigation'
import { generateTitle } from '../utils/title'
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
  const updateTitle = useUpdateSessionTitle()

  const { data: messages, isLoading: messagesLoading } = useAskMessages(currentSessionId)

  const { data: sessionData } = useAskSession(currentSessionId)

  const {
    datasourceId,
    datasourceName,
    selectedTables,
    currentResponse,
    isAnalyzing,
    isExecuting,
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
    setCurrentAssistantMessageId,
    setExecuting,
  } = useAiAskStore()

  const { data: llmSettings } = useLlmSettings()
  const hasActiveLlm = llmSettings?.some((s) => s.is_active) ?? false

  const adapter = useAiAskService()
  const chartDataRef = useRef<{ columns: string[]; rows: any[][]; columnTypes?: string[] } | null>(null)
  const requestTokenRef = useRef(0)

  // Phase 5H: Context tracking
  const [contextChain, setContextChain] = React.useState<string[]>([])
  const [processInsight, setProcessInsight] = React.useState<ProcessInsight | null>(null)
  const [isFollowUpMode, setIsFollowUpMode] = React.useState(false)
  const contextChainRef = useRef(contextChain)
  contextChainRef.current = contextChain

  // ── Phase 5N: Session recovery from response_json ──
  useEffect(() => {
    if (!currentSessionId || !messages) return

    // Messages loaded but empty — clear stale analysis state
    if (messages.length === 0 && !messagesLoading) {
      setCurrentResponse(null)
      setCurrentAssistantMessageId(null)
      return
    }

    // Search from the end, skip invalid, restore the first valid response
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (
        m.role !== 'assistant' ||
        !m.response_json ||
        typeof m.response_json !== 'object'
      ) continue

      const envelope = m.response_json as Record<string, unknown>
      if (envelope.schemaVersion !== 1) continue

      const data = envelope.data as Record<string, unknown> | undefined
      if (!data || typeof data !== 'object') continue

      const validation = validateAiAskResponse(data)
      if (validation.valid) {
        setCurrentResponse(data as unknown as AiAskResponse)
        setCurrentAssistantMessageId(m.id)
        return
      }
    }

    // Messages loaded but no valid response — fail closed clear stale state
    if (!messagesLoading) {
      setCurrentResponse(null)
      setCurrentAssistantMessageId(null)
    }
  }, [currentSessionId, messages, messagesLoading, setCurrentResponse, setCurrentAssistantMessageId])

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

  // ── Phase 5N: Session switch handler — immediate isolation ──
  const handleSessionSelect = useCallback(
    (id: number | null) => {
      // ── Phase 5N: No-op when selecting the same session ──
      if (id === currentSessionId) return

      // Invalidate any in-flight request
      requestTokenRef.current++
      setCurrentSession(id || null)
      // Immediately clear all analysis state for previous session
      setCurrentResponse(null)
      setCurrentAssistantMessageId(null)
      setError(null)
      setResponseValidation(null)
      setActiveChart(0)
      setAnalysisStep(0)
      setAnalyzing(false)
      setExecuting(false)
      chartDataRef.current = null
      // Clear follow-up context to prevent cross-session state leakage
      setContextChain([])
      setProcessInsight(null)
      setIsFollowUpMode(false)
    },
    [
      currentSessionId,
      setCurrentSession,
      setCurrentResponse,
      setCurrentAssistantMessageId,
      setError,
      setResponseValidation,
      setActiveChart,
      setAnalysisStep,
      setAnalyzing,
      setExecuting,
    ],
  )

  const handleSend = useCallback(async (content: string) => {
    // Phase 5I: Input Guard final blocking layer
    const inputValidation = validateAiAskInput(content)
    if (!inputValidation.valid) {
      message.error(inputValidation.error?.message ?? '输入无效')
      return
    }

    // ── Phase 5N Task 5: Hard guards before any session/message creation ──
    // (Production is always real LLM; missing config or datasource must not
    // leave orphan sessions or pending assistant messages)
    if (!hasActiveLlm) {
      message.error('请先在 LLM 连接管理中启用模型')
      return
    }
    if (!datasourceId || !datasourceName) {
      setError(new AiAskError('请先选择数据源', 'UNKNOWN'))
      return
    }

    // ── Phase 5N: Capture shouldAutoTitle before any async ──
    // (Capture the session's current title at call time, not after awaits)
    const shouldAutoTitle = !!(
      currentSessionId && sessionData?.title === '新对话'
    )

    // ── Phase 5N: Capture request token before any async ──
    const token = ++requestTokenRef.current

    // ── Phase 5N: Resolve session id before any async ──
    let resolvedSessionId = currentSessionId
    let didCreateSession = false
    if (!resolvedSessionId) {
      try {
        const newSession = await createSession.mutateAsync({})

        // ── Token check after session creation await ──
        if (token !== requestTokenRef.current) return

        resolvedSessionId = newSession.id
        didCreateSession = true
        setCurrentSession(resolvedSessionId)
      } catch {
        if (token !== requestTokenRef.current) return
        message.error('创建会话失败，请重试')
        return
      }
    }

    // ── Second token check (covers non-creation path) ──
    if (token !== requestTokenRef.current) return

    // ── Phase 5N: Create message with resolved session id ──
    let assistantMessageId: number
    try {
      const created = await createMessage.mutateAsync({
        sessionId: resolvedSessionId,
        content,
      })
      assistantMessageId = created.assistant_message.id
    } catch {
      if (token !== requestTokenRef.current) return
      message.error('发送失败，请重试')
      return
    }

    // ── Token check after message creation await ──
    if (token !== requestTokenRef.current) return

    // Set exact assistant message id (not Date.now(), not guesswork)
    setCurrentAssistantMessageId(assistantMessageId)

    // Use adapter
    clearError()
    setAdapterName(adapter.name)
    setAnalyzing(true)
    setAnalysisStep(1)

    // ── Phase 5N: Step progression with token guard ──
    let stepInterval: ReturnType<typeof setInterval> | undefined
    stepInterval = setInterval(() => {
      // Stop if the request that started this interval is stale
      if (token !== requestTokenRef.current) {
        clearInterval(stepInterval!)
        stepInterval = undefined
        return
      }
      const current = useAiAskStore.getState().analysisStep
      if (current < 5) {
        useAiAskStore.getState().setAnalysisStep(current + 1)
      } else {
        clearInterval(stepInterval!)
        stepInterval = undefined
      }
    }, 800)

    try {
      // Phase 5I: Build messageHistory via Context Policy
      const prevResponse = useAiAskStore.getState().currentResponse
      const messageHistory = buildMessageHistory(prevResponse)

      const resp = await adapter.analyze(content, {
        datasourceId,
        datasourceName,
        selectedTables,
        sessionId: resolvedSessionId,
        assistantMessageId,
        messageHistory,
        options: { mockDelay: [1500, 2500] },
      })

      // ── Phase 5N: Late response guard (token-based) ──
      if (token !== requestTokenRef.current) return

      setAnalysisStep(5)

      // Validate
      const respValidation = adapter.validate(resp as any)
      setResponseValidation(respValidation)

      // Store chart data from adapter (defensively skip empty chartSuggestions)
      if (resp.chartSuggestions && resp.chartSuggestions.length > 0) {
        chartDataRef.current = adapter.getChartData(resp.chartSuggestions[0], resp as any)
      } else {
        chartDataRef.current = null
      }

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

      // ── Phase 5N: Auto-title ──
      // didCreateSession signals a brand-new session (from createSession path).
      // shouldAutoTitle was captured before any await for existing sessions.
      if (didCreateSession || shouldAutoTitle) {
        updateTitle.mutate({ id: resolvedSessionId, title: generateTitle(content) })
      }
    } catch (err) {
      // ── Phase 5N: Late response guard for errors too ──
      if (token !== requestTokenRef.current) return

      setAnalyzing(false)
      if (err instanceof AiAskError) {
        setError(err)
      } else {
        setError(new AiAskError('分析异常', 'UNKNOWN'))
      }
    } finally {
      if (stepInterval) {
        clearInterval(stepInterval)
        stepInterval = undefined
      }
    }
  }, [
    currentSessionId, sessionData, createSession, setCurrentSession,
    createMessage, datasourceId, datasourceName, selectedTables,
    adapter, clearError, setAdapterName, setAnalyzing, setAnalysisStep,
    setResponseValidation, setCurrentResponse, setError, setCurrentAssistantMessageId,
    hasActiveLlm, updateTitle, buildProcessInsight,
  ])

  const handleOpenInWorkbench = useCallback((sql: string, dsId: number) => {
    const encoded = encodeURIComponent(sql)
    navigate(`/sql-workbench?dsId=${dsId}&sql=${encoded}`)
  }, [navigate])

  // ── Phase 5N Task 8: Safe SQL execution ──
  const handleExecute = useCallback(async () => {
    const resolvedSessionId = useAskStore.getState().currentSessionId
    const msgId = useAiAskStore.getState().currentAssistantMessageId

    if (!resolvedSessionId || !msgId) return

    const token = ++requestTokenRef.current
    setExecuting(true)
    clearError()

    try {
      const { executeSql } = await import('../api/aiAsk')
      const result = await executeSql(resolvedSessionId, msgId)

      // ── Late response guard ──
      if (token !== requestTokenRef.current) return

      // Populate chart data from queryResult
      const qr = result.data.queryResult as { columns: string[]; rows: unknown[][]; columnTypes?: string[] } | undefined
      if (qr) {
        // Phase 5N Task 6.5D: columnTypes 一并存入图表数据，用于 Decimal 安全展示
        chartDataRef.current = { columns: qr.columns, rows: qr.rows, columnTypes: qr.columnTypes }
      }

      setCurrentResponse(result.data as unknown as AiAskResponse)
      setExecuting(false)
    } catch (err) {
      // ── Late response guard for errors too ──
      if (token !== requestTokenRef.current) return

      setExecuting(false)
      if (err instanceof AiAskError) {
        setError(err)
      } else {
        setError(new AiAskError('执行失败', 'EXECUTION_ERROR'))
      }
    }
  }, [setExecuting, setCurrentResponse, clearError, setError])

  const [agentMode] = React.useState('ask')

  const showEmptyState = !currentSessionId && !storeError
  const showWelcomeState = currentSessionId && !currentResponse && !isAnalyzing && !storeError
  const showResultsState = (currentSessionId || storeError) && (currentResponse || isAnalyzing || storeError)

  return (
    <Layout style={{ height: 'calc(100vh - 104px)', background: '#fff' }}>
      {/* Left sidebar — compact session area only */}
      <Sider
        width={260}
        trigger={null}
        style={{
          background: '#fafafa',
          borderRight: '1px solid #f0f0f0',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '0 12px', overflow: 'auto', height: '100%' }}>
          <div style={{ marginBottom: 0 }}>
            <SessionList
              compact
              currentId={currentSessionId}
              onSelect={handleSessionSelect}
            />
          </div>
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
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <AgentNav activeKey={agentMode} onChange={() => {}} />
        </div>

        {/* Data scope bar — below agent nav */}
        <DataScopeBar />

        {/* Empty state */}
        {showEmptyState && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'auto',
              padding: '16px 24px',
            }}
          >
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
                <div>{(storeError.code === 'METADATA_NOT_FOUND') ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ borderRadius: 8, marginBottom: 12 }}
                    message={
                      <div>
                        <div style={{ fontWeight: 500, marginBottom: 4 }}>
                          表元数据未采集
                        </div>
                        <div style={{ fontSize: 12 }}>
                          请先采集元数据或选择已采集的数据表
                        </div>
                      </div>
                    }
                    action={
                      <Space>
                        <Button size="small" onClick={() => navigateToExternal('/web/datasources')}>
                          前往数据源管理
                        </Button>
                        <Button size="small" onClick={() => clearError()}>
                          关闭
                        </Button>
                      </Space>
                    }
                  />
                ) : (storeError.code === 'INVALID_RESPONSE' && (storeError as any).details?.sqlValidation) ? (
                  <div style={{ marginBottom: 12 }}>
                    <SqlValidationAlert detail={(storeError as any).details.sqlValidation} />
                  </div>
                ) : (storeError.code === 'EXECUTION_ERROR') ? (
                  <Alert
                    type="error"
                    showIcon
                    closable
                    onClose={() => clearError()}
                    style={{ borderRadius: 8, marginBottom: 12 }}
                    message={
                      <div>
                        <div style={{ fontWeight: 500, marginBottom: 4 }}>
                          SQL 执行出错
                        </div>
                        <div style={{ fontSize: 12 }}>
                          {storeError.message || '请检查数据源连接或 SQL 是否有效'}
                        </div>
                      </div>
                    }
                  />
                ) : (
                  <Alert
                    type="error"
                    showIcon
                    style={{ borderRadius: 8, marginBottom: 12 }}
                    message={
                      <div>
                        <div style={{ fontWeight: 500, marginBottom: 4 }}>
                          {storeError.code === 'UNKNOWN' && storeError.message === '请先选择数据源'
                            ? '配置不足'
                            : '分析异常'}
                        </div>
                        <div style={{ fontSize: 12 }}>{storeError.message || getAiAskErrorMessage(storeError.code)}</div>
                        {storeError.code && (
                          <Space style={{ marginTop: 6 }}>
                            <Button size="small" icon={<ReloadOutlined />} onClick={() => clearError()}>关闭</Button>
                          </Space>
                        )}
                      </div>
                    }
                  />
                )}</div>
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
              {currentResponse && !isAnalyzing && !(
                storeError?.code === 'METADATA_NOT_FOUND' ||
                (storeError?.code === 'INVALID_RESPONSE' && (storeError as any).details?.sqlValidation)
              ) && (
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

                  {/* Phase 5N Task 8: Execute button — only when sql_pending */}
                  {currentResponse.narrativeLevel === 'sql_pending' && (
                    <div style={{ marginBottom: 12 }}>
                      <Typography.Text
                        type="secondary"
                        style={{ display: 'block', marginBottom: 8, fontSize: 12 }}
                        data-testid="execute-safety-disclaimer"
                      >
                        将安全执行当前 SQL（最大返回 1000 行，30 秒超时，仅允许 SELECT）。
                      </Typography.Text>
                      <Button
                        type="primary"
                        icon={<PlayCircleOutlined />}
                        onClick={handleExecute}
                        loading={isExecuting}
                        disabled={isExecuting || !currentSessionId || !useAiAskStore.getState().currentAssistantMessageId}
                        data-testid="execute-sql-btn"
                      >
                        {isExecuting ? '执行中...' : '验证并执行'}
                      </Button>
                    </div>
                  )}

                  {/* Phase 5I: Truncated data notice — from queryResult when executed, else resultSummary */}
                  {currentResponse.queryResult?.truncated && (
                    <Alert
                      type="warning"
                      showIcon
                      message="结果仅显示部分数据，建议细化查询条件以获得更精确的结果"
                      closable
                      style={{ marginBottom: 12, borderRadius: 8 }}
                    />
                  )}

                  {/* Result summary table — authoritative source is queryResult, not chartDataRef */}
                  {currentResponse.narrativeLevel === 'executed' && currentResponse.queryResult && (
                    <div
                      style={{
                        marginBottom: 12,
                        padding: '12px 16px',
                        background: '#fafafa',
                        borderRadius: 8,
                        border: '1px solid #f0f0f0',
                      }}
                    >
                      {currentResponse.queryResult.rows.length === 0 ? (
                        <Typography.Text
                          type="secondary"
                          style={{ fontSize: 12, display: 'block', padding: '12px 0', textAlign: 'center' }}
                        >
                          查询成功但无数据
                        </Typography.Text>
                      ) : (
                        <>
                          <Typography.Text
                            strong
                            style={{
                              fontSize: 12,
                              color: '#666',
                              display: 'block',
                              marginBottom: 10,
                            }}
                          >
                            查询结果（{currentResponse.queryResult.rowCount} 行 ·{' '}
                            {currentResponse.queryResult.elapsedMs}ms
                            {currentResponse.queryResult.truncated ? ' · 仅展示部分数据' : ''}）
                          </Typography.Text>
                          <Table
                            dataSource={currentResponse.queryResult.rows.map((row: any, i: number) => {
                              const record: Record<string, any> = { _key: i }
                              currentResponse.queryResult!.columns.forEach((col, ci) => {
                                record[col] = row[ci]
                              })
                              return record
                            })}
                            columns={currentResponse.queryResult.columns.map((col) => {
                              const colIndex = currentResponse.queryResult!.columns.indexOf(col)
                              const sampleVal = currentResponse.queryResult!.rows[0]?.[colIndex]
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
                                    return String(val)
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
                        </>
                      )}
                    </div>
                  )}

                  {/* AI chart board — receives queryResult for real data display */}
                  {(currentResponse.chartSuggestions.length > 0 || currentResponse.narrativeLevel === 'executed') && (
                    <AiChartBoard
                      chartSuggestions={currentResponse.chartSuggestions}
                      columns={chartDataRef.current?.columns ?? currentResponse.queryResult?.columns ?? []}
                      rows={chartDataRef.current?.rows ?? currentResponse.queryResult?.rows ?? []}
                      activeIndex={activeChartIndex}
                      onActiveChange={setActiveChart}
                      narrativeLevel={currentResponse.narrativeLevel}
                      queryResult={currentResponse.queryResult}
                      columnTypes={chartDataRef.current?.columnTypes ?? currentResponse.queryResult?.columnTypes}
                    />
                  )}

                  <AiNarrative
                    narrative={currentResponse.narrative}
                    narrativeLevel={currentResponse.narrativeLevel}
                    onAskQuestion={handleSend}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Unified bottom input — shared by empty / welcome / results / error states */}
        <div
          style={{
            borderTop: '1px solid #f0f0f0',
            padding: '12px 24px',
            background: '#fff',
          }}
        >
          <Tooltip
            title={hasActiveLlm ? '' : '请先在 LLM 连接管理中启用模型'}
          >
            <div data-testid="ask-input-tooltip-trigger" style={{ width: '100%' }}>
              <AskInput
                onSend={handleSend}
                loading={isAnalyzing || createMessage.isPending || createSession.isPending}
                disabled={!hasActiveLlm}
                autoFocus
              />
            </div>
          </Tooltip>
        </div>
      </Content>
    </Layout>
  )
}

export default AskWorkbenchPage
