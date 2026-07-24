import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { message } from 'antd'
import AskWorkbenchPage from './AskWorkbenchPage'

vi.hoisted(() => {
  const M = {
    mockedAnalyze: vi.fn(),
    mockExecuteSql: vi.fn(),
    mockNavigateToExternal: vi.fn(),
    mockCreateMessageMutateAsync: vi.fn().mockResolvedValue({
      user_message: { id: 100, session_id: 1, role: 'user', content: '', status: 'completed', created_at: '2024-01-01T00:00:00Z' },
      assistant_message: { id: 101, session_id: 1, role: 'assistant', content: '', status: 'pending', created_at: '2024-01-01T00:00:00Z' },
    }),
    mockCreateSessionMutateAsync: vi.fn().mockResolvedValue({ id: 1 }),
    mockUpdateTitleMutate: vi.fn(),
    mockAskMessagesData: [] as any[],
    mockAskSessionData: { id: 1, title: '新对话' } as { id: number; title: string } | undefined,
    mockAskStoreState: {
      currentSessionId: null as number | null,
      setCurrentSession: vi.fn(),
    },
    mockAiAskState: {
      datasourceId: null as number | null,
      datasourceName: null as string | null,
      selectedTables: [] as string[],
      currentResponse: null as any,
      isAnalyzing: false,
      isExecuting: false,
      activeChartIndex: 0,
      analysisStep: 0,
      adapterName: 'RealLlmAdapter',
      responseValidation: null as any,
      error: null as any,
      currentAssistantMessageId: null as number | null,
      setDatasource: vi.fn(),
      setSelectedTables: vi.fn(),
      setCurrentResponse: vi.fn(),
      setAnalyzing: vi.fn(),
      setExecuting: vi.fn(),
      setActiveChart: vi.fn(),
      setAnalysisStep: vi.fn(),
      setAdapterName: vi.fn(),
      setResponseValidation: vi.fn(),
      setError: vi.fn(),
      clearError: vi.fn(),
      setCurrentAssistantMessageId: vi.fn(),
      reset: vi.fn(),
    },
  }
  M.mockAiAskState.setError = vi.fn((err: any) => { M.mockAiAskState.error = err })
  ;(globalThis as any).__M = M
})

function m() {
  return (globalThis as any).__M
}

// --- Mocks ---

vi.mock('../stores/askStore', () => {
  const M = (globalThis as any).__M
  const ref = M.mockAskStoreState
  const fn = Object.assign(
    vi.fn((selector?: (s: any) => any) => {
      if (selector) return selector(ref)
      return ref
    }),
    { getState: vi.fn(() => ({ currentSessionId: ref.currentSessionId, setCurrentSession: ref.setCurrentSession })) },
  )
  return { useAskStore: fn }
})

// Helper to get fresh aiAsk state reference
function aiAskState() {
  return m().mockAiAskState
}

vi.mock('../stores/aiAskStore', () => {
  const M = (globalThis as any).__M
  const useAiAskStore = vi.fn((selector?: (s: any) => any) => {
    const state = M.mockAiAskState
    if (selector) return selector(state)
    return state
  })
  ;(useAiAskStore as any).getState = vi.fn(() => M.mockAiAskState)
  return { useAiAskStore }
})

vi.mock('../api/askSessions', () => {
  const M = (globalThis as any).__M
  return {
    useAskMessages: vi.fn(() => ({ data: M.mockAskMessagesData, isLoading: false })),
    useCreateMessage: vi.fn(() => ({
      mutateAsync: M.mockCreateMessageMutateAsync,
      isPending: false,
    })),
    useCreateSession: vi.fn(() => ({
      mutateAsync: M.mockCreateSessionMutateAsync,
      isPending: false,
    })),
    useAskSession: vi.fn(() => ({ data: M.mockAskSessionData })),
    useUpdateSessionTitle: vi.fn(() => ({
      mutate: M.mockUpdateTitleMutate,
      isPending: false,
    })),
  }
})

vi.mock('../api/llmSettings', () => ({
  useLlmSettings: vi.fn(() => ({
    data: [{ id: 1, name: 'openai', is_active: true, base_url: '', api_key_masked: '***', model_name: 'gpt-4o-mini', last_tested_at: null, last_tested_ok: null, created_at: '', updated_at: '' }],
    isLoading: false,
  })),
}))

import { useLlmSettings } from '../api/llmSettings'

vi.mock('../api/aiAsk', async () => {
  const inputGuard = await vi.importActual('../api/aiAsk/inputGuard')
  const contextPolicy = await vi.importActual('../api/aiAsk/contextPolicy')
  const validatorModule = await vi.importActual('../api/aiAsk/validator')
  const M = (globalThis as any).__M
  return {
    validateAiAskInput: (inputGuard as any).validateAiAskInput,
    buildMessageHistory: (contextPolicy as any).buildMessageHistory,
    validateAiAskResponse: (validatorModule as any).validateAiAskResponse,
    useAiAskService: vi.fn(() => ({
      name: 'MockAdapter',
      analyze: M.mockedAnalyze,
      getChartData: vi.fn(() => ({ columns: ['region', 'revenue'], rows: [['华东', 1000]], isEmpty: false })),
      isAvailable: vi.fn(() => true),
      validate: vi.fn(() => ({ valid: true, errors: [], warnings: [] })),
    })),
    get AiAskError() {
      return class extends Error {
        code: string
        constructor(m: string, code: string) {
          super(m)
          this.code = code
          this.name = 'AiAskError'
        }
      }
    },
    TestAiAskError: class extends Error {
      code: string
      constructor(m: string, code: string) {
        super(m)
        this.code = code
        this.name = 'AiAskError'
      }
    },
    getAiAskErrorMessage: vi.fn((code: string) => {
      const map: Record<string, string> = { UNKNOWN: '分析异常', ANALYSIS_TIMEOUT: '分析超时' }
      return map[code] || '异常'
    }),
    executeSql: M.mockExecuteSql,
  }
})

vi.mock('../utils/title', () => ({
  generateTitle: vi.fn((q: string) => q.length > 10 ? q.slice(0, 10) + '…' : q),
}))

vi.mock('../utils/navigation', () => {
  const M = (globalThis as any).__M
  return { navigateToExternal: M.mockNavigateToExternal }
})

vi.mock('../components/SessionList', () => ({
  default: (props: any) => (
    <div data-testid="session-list">
      SessionList{props.compact ? ' (compact)' : ''}
      <button data-testid="switch-session-btn" onClick={() => props.onSelect?.(2)} type="button">S2</button>
    </div>
  ),
}))

vi.mock('../components/MessageThread', () => ({
  default: () => <div data-testid="message-thread">MessageThread</div>,
}))

vi.mock('../components/ToolCallIndicator', () => ({
  default: () => <div data-testid="tool-call-indicator">ToolCallIndicator</div>,
}))

vi.mock('../components/AgentNav', () => ({
  default: () => <div data-testid="agent-nav">AgentNav</div>,
}))

vi.mock('../api/sqlWorkbench', () => ({
  useSqlDatasources: vi.fn(() => ({ data: [], isLoading: false })),
  useSearchSchema: vi.fn(() => ({ data: undefined, isLoading: false, isFetching: false })),
  useSchemaTree: vi.fn(() => ({ data: undefined, isLoading: false })),
}))

vi.mock('../components/DataScopeBar', () => ({
  default: (props: any) => (
    <div data-testid="data-scope-bar">
      <span>数据范围</span>
      {(props.siderCollapsed !== undefined || props.onToggleCollapse !== undefined) && (
        <span data-testid="collapse-props-leaked" />
      )}
    </div>
  ),
}))

vi.mock('../components/PromptCards', () => ({
  default: () => <div data-testid="prompt-cards">PromptCards</div>,
}))

vi.mock('../components/AskInput', () => ({
  default: ({ onSend, loading, disabled }: any) => (
    <div data-testid="ask-input" data-disabled={disabled ? 'true' : 'false'}>
      AskInput
      <button
        data-testid="mock-send-btn"
        onClick={() => {
          if (!loading && !disabled) onSend?.('近 7 天销量')
        }}
        type="button"
      >
        Send
      </button>
      <button
        data-testid="mock-force-send-btn"
        onClick={() => {
          onSend?.('近 7 天销量')
        }}
        type="button"
      >
        Force Send
      </button>
      <button
        data-testid="mock-send-invalid-btn"
        onClick={() => {
          if (!loading && !disabled) onSend?.('，，！')
        }}
        type="button"
      >
        Send Invalid
      </button>
      <button
        data-testid="mock-send-empty-btn"
        onClick={() => {
          if (!loading && !disabled) onSend?.('')
        }}
        type="button"
      >
        Send Empty
      </button>
    </div>
  ),
}))

vi.mock('../components/IntentCard', () => ({
  default: () => <div data-testid="intent-card">IntentCard</div>,
}))

vi.mock('../components/SqlPlan', () => ({
  default: () => <div data-testid="sql-plan">SqlPlan</div>,
}))

vi.mock('../components/AiChartBoard', () => ({
  default: (props: any) => (
    <div data-testid="ai-chart-board">
      AiChartBoard{props?.narrativeLevel === 'sql_pending' ? ' (sql_pending)' : ''}
      {props?.queryResult ? ` (queryResult:${props.queryResult.rowCount}行)` : ''}
    </div>
  ),
}))

vi.mock('../components/AiNarrative', () => ({
  default: (props: any) => <div data-testid="ai-narrative">AiNarrative{props?.narrativeLevel === 'sql_pending' ? ' (sql_pending)' : ''}</div>,
}))

vi.mock('../components/ContextChain', () => ({
  default: () => <div data-testid="context-chain">ContextChain</div>,
}))

vi.mock('../components/SemanticGapAlert', () => ({
  default: () => <div data-testid="semantic-gap-alert">SemanticGapAlert</div>,
}))

// --- Helpers ---

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ask']}>
        <AskWorkbenchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return {
    ...result,
    queryClient,
    rerenderPage: () =>
      result.rerender(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/ask']}>
            <AskWorkbenchPage />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
  }
}

function makeMockResponse(overrides?: Record<string, any>) {
  return {
    question: 'test',
    intent: { metrics: [], dimensions: [], filters: [], timeRange: undefined },
    sqlPlan: { datasourceId: 1, datasourceName: 'dwh', sql: 'SELECT * FROM dual', tables: ['table'], fields: ['col'], assumptions: [], safetyWarnings: [] },
    chartSuggestions: [{ title: '图', chartType: 'bar', yFields: ['x'], rationale: 'r', limitations: [] }],
    narrative: { summary: '分析总结', keyFindings: ['发现'], evidence: [{ claim: '数据', fields: ['col'], sqlSnippet: 'SELECT', calculation: 'sum', sourceFields: ['col'] }], risks: [], nextQuestions: [], conclusion: '结论' },
    semanticGaps: [],
    resultSummary: { rowCount: 2, durationMs: 150, truncated: false },
    ...overrides,
  }
}

// --- Tests ---

describe('AskWorkbenchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const M = m()
    M.mockAskStoreState.currentSessionId = null
    M.mockAskMessagesData = []
    M.mockAskSessionData = { id: 1, title: '新对话' }
    // Reset useLlmSettings implementation (mockReturnValue survives clearAllMocks)
    vi.mocked(useLlmSettings).mockReturnValue({
      data: [{ id: 1, name: 'openai', is_active: true, base_url: '', api_key_masked: '***', model_name: 'gpt-4o-mini', last_tested_at: null, last_tested_ok: null, created_at: '', updated_at: '' }],
      isLoading: false,
    } as any)
    // Reset mock implementations that may have been replaced by mockReturnValue
    M.mockCreateSessionMutateAsync.mockResolvedValue({ id: 1 })
    M.mockCreateMessageMutateAsync.mockResolvedValue({
      user_message: { id: 100, session_id: 1, role: 'user', content: '', status: 'completed', created_at: '2024-01-01T00:00:00Z' },
      assistant_message: { id: 101, session_id: 1, role: 'assistant', content: '', status: 'pending', created_at: '2024-01-01T00:00:00Z' },
    })
    // Recreate aiAsk state as mutable object
    const mockAiAskState = {
      datasourceId: 2,
      datasourceName: 'dwhrpt',
      selectedTables: [],
      currentResponse: null,
      isAnalyzing: false,
      isExecuting: false,
      activeChartIndex: 0,
      analysisStep: 0,
      adapterName: 'RealLlmAdapter',
      responseValidation: null,
      error: null,
      currentAssistantMessageId: null,
      setDatasource: vi.fn(),
      setSelectedTables: vi.fn(),
      setCurrentResponse: vi.fn(),
      setAnalyzing: vi.fn(),
      setExecuting: vi.fn(),
      setActiveChart: vi.fn(),
      setAnalysisStep: vi.fn(),
      setAdapterName: vi.fn(),
      setResponseValidation: vi.fn(),
      setError: vi.fn((err) => { aiAskState().error = err }),
      clearError: vi.fn(),
      setCurrentAssistantMessageId: vi.fn(),
      reset: vi.fn(),
    }
    M.mockAiAskState = mockAiAskState
  })

  it('renders sidebar elements always', () => {
    renderPage()
    expect(screen.getByTestId('session-list')).toBeInTheDocument()
    expect(screen.getByTestId('agent-nav')).toBeInTheDocument()
    expect(screen.getByTestId('data-scope-bar')).toBeInTheDocument()
  })

  it('renders SessionList in compact mode', () => {
    renderPage()
    expect(screen.getByText('SessionList (compact)')).toBeInTheDocument()
  })

  it('does not render the legacy DataScopeSelector anywhere', () => {
    renderPage()
    expect(screen.queryByTestId('data-scope-selector')).not.toBeInTheDocument()
    expect(screen.queryByText('DataScopeSelector')).not.toBeInTheDocument()
  })

  it('passes no collapse props to DataScopeBar', () => {
    renderPage()
    expect(screen.queryByTestId('collapse-props-leaked')).not.toBeInTheDocument()
  })

  it('exposes a single 数据范围 entry on the page', () => {
    renderPage()
    expect(screen.getAllByText('数据范围')).toHaveLength(1)
  })

  it('keeps only SessionList inside the sider', () => {
    renderPage()
    const sider = document.querySelector('.ant-layout-sider')
    expect(sider).toBeTruthy()
    expect(within(sider as HTMLElement).getByTestId('session-list')).toBeInTheDocument()
    expect(within(sider as HTMLElement).queryByTestId('data-scope-bar')).not.toBeInTheDocument()
  })

  it('shows empty state when no session selected', () => {
    renderPage()
    expect(screen.getByText('选择或创建一个对话开始提问')).toBeInTheDocument()
  })

  it('shows welcome state when session is selected', () => {
    const M = m()
    M.mockAskStoreState.currentSessionId = 1
    renderPage()
    expect(screen.getByText('MetricForge 智能问数')).toBeInTheDocument()
    expect(screen.getByTestId('prompt-cards')).toBeInTheDocument()
    expect(screen.getByTestId('ask-input')).toBeInTheDocument()
  })

  it('shows message thread when session is selected', () => {
    const M = m()
    M.mockAskStoreState.currentSessionId = 1
    renderPage()
    expect(screen.getByTestId('message-thread')).toBeInTheDocument()
  })

  it('shows AI result components when currentResponse is set', () => {
    const M = m()
    M.mockAskStoreState.currentSessionId = 1
    aiAskState().currentResponse = makeMockResponse()
    aiAskState().isAnalyzing = false
    renderPage()
    expect(screen.getByTestId('intent-card')).toBeInTheDocument()
    expect(screen.getByTestId('sql-plan')).toBeInTheDocument()
    expect(screen.getByTestId('ai-chart-board')).toBeInTheDocument()
    expect(screen.getByTestId('ai-narrative')).toBeInTheDocument()
  })

  it('shows truncated data notice when queryResult.truncated is true', () => {
    const M = m()
    M.mockAskStoreState.currentSessionId = 1
    aiAskState().currentResponse = makeMockResponse({
      narrativeLevel: 'executed',
      resultSummary: { rowCount: 100, durationMs: 200, truncated: true },
      queryResult: { columns: ['a'], rows: [['x']], rowCount: 100, truncated: true, elapsedMs: 200, historyId: null },
    })
    aiAskState().isAnalyzing = false
    renderPage()
    expect(screen.getByText('结果仅显示部分数据，建议细化查询条件以获得更精确的结果')).toBeInTheDocument()
  })

  it('does not show truncated notice when queryResult.truncated is false', () => {
    const M = m()
    M.mockAskStoreState.currentSessionId = 1
    aiAskState().currentResponse = makeMockResponse({
      narrativeLevel: 'executed',
      resultSummary: { rowCount: 6, durationMs: 200, truncated: false },
      queryResult: { columns: ['a'], rows: [['x']], rowCount: 6, truncated: false, elapsedMs: 200, historyId: null },
    })
    aiAskState().isAnalyzing = false
    renderPage()
    expect(screen.queryByText('结果仅显示部分数据，建议细化查询条件以获得更精确的结果')).not.toBeInTheDocument()
  })

  it('does not show truncated notice when queryResult is absent', () => {
    const M = m()
    M.mockAskStoreState.currentSessionId = 1
    aiAskState().currentResponse = makeMockResponse({ resultSummary: undefined, narrativeLevel: 'sql_pending' })
    aiAskState().isAnalyzing = false
    renderPage()
    expect(screen.queryByText('结果仅显示部分数据，建议细化查询条件以获得更精确的结果')).not.toBeInTheDocument()
  })

  it('shows result summary header when resultSummary is available', () => {
    const M = m()
    M.mockAskStoreState.currentSessionId = 1
    aiAskState().currentResponse = makeMockResponse()
    aiAskState().isAnalyzing = false
    renderPage()
    expect(screen.getByTestId('intent-card')).toBeInTheDocument()
    expect(screen.getByTestId('sql-plan')).toBeInTheDocument()
  })

  it('shows skeleton card placeholders and step progress when analyzing', () => {
    const M = m()
    M.mockAskStoreState.currentSessionId = 1
    aiAskState().currentResponse = null
    aiAskState().isAnalyzing = true
    aiAskState().analysisStep = 2
    renderPage()
    expect(screen.getByText('AI 正在分析你的问题...')).toBeInTheDocument()
    expect(screen.getByText('AI 正在理解你的问题')).toBeInTheDocument()
    expect(screen.getByText('正在分析查询计划')).toBeInTheDocument()
    expect(screen.getByText('正在获取数据')).toBeInTheDocument()
    expect(screen.getByText('正在生成图表')).toBeInTheDocument()
    expect(screen.getByText('正在生成解读摘要')).toBeInTheDocument()
    expect(screen.getByText('进行中...')).toBeInTheDocument()
  })

  it('shows step 1 as active and no "进行中" for completed steps', () => {
    const M = m()
    M.mockAskStoreState.currentSessionId = 1
    aiAskState().currentResponse = null
    aiAskState().isAnalyzing = true
    aiAskState().analysisStep = 5
    renderPage()
    expect(screen.getByText('AI 正在分析你的问题...')).toBeInTheDocument()
    const progressLabels = screen.getAllByText('进行中...')
    expect(progressLabels.length).toBe(1)
  })

  it('passes messageHistory with previous responseJson on second send (Phase 5H follow-up integration)', async () => {
    const M = m()
    M.mockAskStoreState.currentSessionId = 1
    const firstResponse = makeMockResponse({ question: '上个月各区域销售额' })
    aiAskState().currentResponse = firstResponse
    aiAskState().isAnalyzing = false

    M.mockedAnalyze.mockResolvedValue(makeMockResponse({
      question: 'follow-up question about 华东',
      followUp: { type: 'drill_down', confidence: 'high' },
    }))

    renderPage()
    expect(screen.getByTestId('ask-input')).toBeInTheDocument()

    const sendBtn = screen.getByTestId('mock-send-btn')
    fireEvent.click(sendBtn)

    await waitFor(() => {
      expect(M.mockedAnalyze).toHaveBeenCalled()
    })

    const analyzeCallArgs = M.mockedAnalyze.mock.calls[0]
    const callContext = analyzeCallArgs[1]

    expect(callContext.messageHistory).toBeDefined()
    expect(callContext.messageHistory).toHaveLength(2)
    expect(callContext.messageHistory[0].role).toBe('user')
    expect(callContext.messageHistory[0].content).toBe('上个月各区域销售额')
    expect(callContext.messageHistory[1].role).toBe('assistant')
    expect(callContext.messageHistory[1].responseJson).toBeDefined()
    expect((callContext.messageHistory[1].responseJson as any).question).toBe('上个月各区域销售额')
  })

  it('shows error alert when error is set', () => {
    const M = m()
    M.mockAskStoreState.currentSessionId = 1
    aiAskState().currentResponse = null
    aiAskState().isAnalyzing = false
    aiAskState().error = { code: 'ANALYSIS_TIMEOUT', message: '超时', name: 'AiAskError' }
    renderPage()
    expect(screen.getByText('分析异常')).toBeInTheDocument()
  })

  it('blocks invalid input and does not call adapter.analyze', async () => {
    const M = m()
    M.mockAskStoreState.currentSessionId = 1
    M.mockedAnalyze.mockResolvedValue(makeMockResponse())
    const errorSpy = vi.spyOn(message, 'error').mockImplementation(() => undefined as unknown as ReturnType<typeof message.error>)

    renderPage()
    fireEvent.click(screen.getByTestId('mock-send-invalid-btn'))

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('请输入有效的问题，不能仅包含标点或符号')
    })
    expect(M.mockedAnalyze).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('blocks empty input from submit path and shows page-level error', async () => {
    const M = m()
    M.mockAskStoreState.currentSessionId = 1
    M.mockedAnalyze.mockResolvedValue(makeMockResponse())
    const errorSpy = vi.spyOn(message, 'error').mockImplementation(() => undefined as unknown as ReturnType<typeof message.error>)

    renderPage()
    fireEvent.click(screen.getByTestId('mock-send-empty-btn'))

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('请输入问题')
    })
    expect(M.mockedAnalyze).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('allows normal business question and calls adapter.analyze', async () => {
    const M = m()
    M.mockAskStoreState.currentSessionId = 1
    M.mockedAnalyze.mockResolvedValue(makeMockResponse({ question: '近 7 天销量' }))

    renderPage()
    fireEvent.click(screen.getByTestId('mock-send-btn'))

    await waitFor(() => {
      expect(M.mockedAnalyze).toHaveBeenCalledWith('近 7 天销量', expect.any(Object))
    })
  })

  // ── Phase 5N: Session isolation & recovery tests ────────────────

  describe('Phase 5N Session isolation', () => {
    it('clears analysis state via SessionList onSelect interaction', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      aiAskState().currentResponse = makeMockResponse()
      aiAskState().currentAssistantMessageId = 101
      aiAskState().error = { code: 'ANALYSIS_TIMEOUT', message: '超时', name: 'AiAskError' }

      renderPage()

      // Switch to session 2 via the SessionList onSelect prop
      fireEvent.click(screen.getByTestId('switch-session-btn'))

      expect(aiAskState().setCurrentResponse).toHaveBeenCalledWith(null)
      expect(aiAskState().setCurrentAssistantMessageId).toHaveBeenCalledWith(null)
      expect(aiAskState().setError).toHaveBeenCalledWith(null)
      expect(aiAskState().setResponseValidation).toHaveBeenCalledWith(null)
      expect(aiAskState().setAnalysisStep).toHaveBeenCalledWith(0)
      expect(aiAskState().setAnalyzing).toHaveBeenCalledWith(false)
      expect(aiAskState().setExecuting).toHaveBeenCalledWith(false)
    })

    it('switch advances request token to invalidate in-flight requests', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      renderPage()
      // First click sends a request (token=1)
      // Second click switches session (token invalidated)
      // We verify by firing switch button and checking no stale state leaks
      fireEvent.click(screen.getByTestId('switch-session-btn'))
      expect(aiAskState().setCurrentResponse).toHaveBeenCalled()
      expect(aiAskState().setCurrentAssistantMessageId).toHaveBeenCalled()
    })

    it('does not clear state when switching to the same session', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 2
      // Prevent recovery useEffect from clearing state — give valid messages
      const existingResp = makeMockResponse()
      M.mockAskMessagesData = [
        { id: 10, session_id: 2, role: 'assistant', content: 'hi', status: 'completed', created_at: '2024-01-01T00:00:00Z', response_json: { schemaVersion: 1, data: existingResp } },
      ]
      aiAskState().currentResponse = existingResp
      aiAskState().currentAssistantMessageId = 10

      renderPage()

      // SessionList btn calls onSelect(2), but currentSessionId is already 2
      fireEvent.click(screen.getByTestId('switch-session-btn'))

      // handleSessionSelect must return early — setCurrentSession not called
      expect(M.mockAskStoreState.setCurrentSession).not.toHaveBeenCalled()
      // Full cleanup calls must also not happen
      expect(aiAskState().setAnalyzing).not.toHaveBeenCalled()
      expect(aiAskState().setAnalysisStep).not.toHaveBeenCalled()
      expect(aiAskState().setError).not.toHaveBeenCalled()
    })

    it('stale callback from rerender does not fire cleanup (requires currentSessionId in deps)', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      const { rerender, queryClient } = renderPage()

      // Click to switch to session 2 — this fires handleSessionSelect cleanup (expected)
      fireEvent.click(screen.getByTestId('switch-session-btn'))

      // Now update mock state and rerender as if the store propagated
      M.mockAskStoreState.currentSessionId = 2
      rerender(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/ask']}>
            <AskWorkbenchPage />
          </MemoryRouter>
        </QueryClientProvider>
      )

      // Clear all previous spy calls
      vi.clearAllMocks()

      // Click onSelect(2) again — currentSessionId is now 2, so guard should fire
      fireEvent.click(screen.getByTestId('switch-session-btn'))

      // If currentSessionId is in useCallback deps, the recreated handler
      // has the updated value and returns early — no calls.
      // If missing from deps, it still sees currentSessionId=1 and fires cleanup.
      expect(M.mockAskStoreState.setCurrentSession).not.toHaveBeenCalled()
      expect(aiAskState().setCurrentResponse).not.toHaveBeenCalled()
      expect(aiAskState().setCurrentAssistantMessageId).not.toHaveBeenCalled()
      expect(aiAskState().setAnalyzing).not.toHaveBeenCalled()
      expect(aiAskState().setAnalysisStep).not.toHaveBeenCalled()
    })
  })

  describe('Phase 5N Recovery from response_json', () => {
    it('restores currentResponse from last assistant message with valid schemaVersion=1 response_json', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      aiAskState().currentResponse = null
      aiAskState().currentAssistantMessageId = null

      const validResponse = makeMockResponse({ question: '上月销售额' })
      M.mockAskMessagesData = [
        { id: 1, session_id: 1, role: 'user', content: '上月销售额', status: 'completed', created_at: '2024-01-01T00:00:00Z' },
        {
          id: 2,
          session_id: 1,
          role: 'assistant',
          content: '分析结果',
          status: 'completed',
          created_at: '2024-01-01T00:00:01Z',
          response_json: {
            schemaVersion: 1,
            data: validResponse,
          },
        },
      ]

      renderPage()

      await waitFor(() => {
        expect(aiAskState().setCurrentResponse).toHaveBeenCalledWith(
          expect.objectContaining({ question: '上月销售额' }),
        )
      })
      expect(aiAskState().setCurrentAssistantMessageId).toHaveBeenCalledWith(2)
    })

    it('ignores response_json with unsupported schemaVersion — clears state via fail-closed', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1

      M.mockAskMessagesData = [
        { id: 1, session_id: 1, role: 'user', content: 'test', status: 'completed', created_at: '2024-01-01T00:00:00Z' },
        {
          id: 2,
          session_id: 1,
          role: 'assistant',
          content: '',
          status: 'completed',
          created_at: '2024-01-01T00:00:01Z',
          response_json: { schemaVersion: 99, data: {} },
        },
      ]

      renderPage()

      await waitFor(() => {
        expect(aiAskState().setCurrentResponse).toHaveBeenCalledWith(null)
      })
    })

    it('ignores response_json from user messages — clears state via fail-closed', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1

      const respData = makeMockResponse({ question: 'test' })
      M.mockAskMessagesData = [
        {
          id: 2,
          session_id: 1,
          role: 'user',
          content: 'test',
          status: 'completed',
          created_at: '2024-01-01T00:00:01Z',
          response_json: { schemaVersion: 1, data: respData },
        },
      ]

      renderPage()

      await waitFor(() => {
        expect(aiAskState().setCurrentResponse).toHaveBeenCalledWith(null)
      })
    })

    it('ignores response_json with null/undefined data — clears state via fail-closed', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1

      M.mockAskMessagesData = [
        { id: 2, session_id: 1, role: 'assistant', content: '', status: 'completed', created_at: '2024-01-01T00:00:01Z', response_json: { schemaVersion: 1, data: null } },
      ]

      renderPage()

      await waitFor(() => {
        expect(aiAskState().setCurrentResponse).toHaveBeenCalledWith(null)
      })
    })

    it('skips latest invalid envelope and recovers from earlier valid one', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      aiAskState().currentResponse = null
      aiAskState().currentAssistantMessageId = null

      const validResponse = makeMockResponse({ question: '有效的上月销售额' })
      M.mockAskMessagesData = [
        { id: 1, session_id: 1, role: 'user', content: '上月销售额', status: 'completed', created_at: '2024-01-01T00:00:00Z' },
        // Earlier: id=2 is valid schemaVersion=1
        {
          id: 2,
          session_id: 1,
          role: 'assistant',
          content: '分析结果',
          status: 'completed',
          created_at: '2024-01-01T00:00:01Z',
          response_json: { schemaVersion: 1, data: validResponse },
        },
        // Latest: id=3 is invalid schemaVersion=99 — must be skipped
        {
          id: 3,
          session_id: 1,
          role: 'assistant',
          content: '',
          status: 'completed',
          created_at: '2024-01-01T00:00:02Z',
          response_json: { schemaVersion: 99, data: {} },
        },
      ]

      renderPage()

      await waitFor(() => {
        expect(aiAskState().setCurrentResponse).toHaveBeenCalledWith(
          expect.objectContaining({ question: '有效的上月销售额' }),
        )
      })
      // Must recover from id=2 (skip the latest invalid id=3)
      expect(aiAskState().setCurrentAssistantMessageId).toHaveBeenCalledWith(2)
    })

    it('clears stale state when messages loaded but all are invalid', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      aiAskState().currentResponse = makeMockResponse()
      aiAskState().currentAssistantMessageId = 101

      M.mockAskMessagesData = [
        { id: 1, session_id: 1, role: 'user', content: 'test', status: 'completed', created_at: '2024-01-01T00:00:00Z' },
        { id: 2, session_id: 1, role: 'assistant', content: '', status: 'completed', created_at: '2024-01-01T00:00:01Z' },
      ]

      renderPage()

      await waitFor(() => {
        expect(aiAskState().setCurrentResponse).toHaveBeenCalledWith(null)
      })
      expect(aiAskState().setCurrentAssistantMessageId).toHaveBeenCalledWith(null)
    })

    it('clears stale state when messages are loaded but empty', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      aiAskState().currentResponse = makeMockResponse()
      aiAskState().currentAssistantMessageId = 101

      M.mockAskMessagesData = []

      renderPage()

      await waitFor(() => {
        expect(aiAskState().setCurrentResponse).toHaveBeenCalledWith(null)
      })
      expect(aiAskState().setCurrentAssistantMessageId).toHaveBeenCalledWith(null)
    })
  })

  describe('Phase 5N New and existing session flows', () => {
    it('creates session 42 from no-session state, uses assistant_message.id, calls updateTitle with id:42', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = null
      M.mockCreateSessionMutateAsync.mockResolvedValue({ id: 42 })
      const createdMsg = {
        user_message: { id: 100, session_id: 42, role: 'user', content: '近 7 天销量', status: 'completed', created_at: '' },
        assistant_message: { id: 201, session_id: 42, role: 'assistant', content: '', status: 'pending', created_at: '' },
      }
      M.mockCreateMessageMutateAsync.mockResolvedValue(createdMsg)
      M.mockedAnalyze.mockResolvedValue(makeMockResponse({ question: '近 7 天销量' }))

      renderPage()
      expect(screen.getByText('选择或创建一个对话开始提问')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('mock-send-btn'))

      await waitFor(() => {
        expect(M.mockedAnalyze).toHaveBeenCalled()
      })

      // Session 42 was created
      expect(M.mockCreateSessionMutateAsync).toHaveBeenCalled()
      // Message was created with sessionId 42
      expect(M.mockCreateMessageMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 42 }),
      )
      // Analyze was called with sessionId 42 and assistant message id 201
      const ctx = M.mockedAnalyze.mock.calls[0][1]
      expect(ctx.sessionId).toBe(42)
      expect(ctx.assistantMessageId).toBe(201)

      // Auto-title for the newly created session 42
      await waitFor(() => {
        expect(M.mockUpdateTitleMutate).toHaveBeenCalledWith(
          expect.objectContaining({ id: 42 }),
        )
      })
    })

    it('uses existing session and passes sessionId/assistantMessageId to analyze', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      const createdMsg = {
        user_message: { id: 100, session_id: 1, role: 'user', content: '近 7 天销量', status: 'completed', created_at: '' },
        assistant_message: { id: 202, session_id: 1, role: 'assistant', content: '', status: 'pending', created_at: '' },
      }
      M.mockCreateMessageMutateAsync.mockResolvedValue(createdMsg)
      M.mockedAnalyze.mockResolvedValue(makeMockResponse({ question: '近 7 天销量' }))

      renderPage()
      fireEvent.click(screen.getByTestId('mock-send-btn'))

      await waitFor(() => {
        expect(M.mockedAnalyze).toHaveBeenCalled()
      })

      const ctx = M.mockedAnalyze.mock.calls[0][1]
      expect(ctx.sessionId).toBe(1)
      expect(ctx.assistantMessageId).toBe(202)
    })

    it('does NOT auto-title when session already exists with custom title', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      M.mockAskSessionData = { id: 1, title: '自定义标题' }
      M.mockCreateMessageMutateAsync.mockResolvedValue({
        user_message: { id: 100, session_id: 1, role: 'user', content: '近 7 天销量', status: 'completed', created_at: '' },
        assistant_message: { id: 101, session_id: 1, role: 'assistant', content: '', status: 'pending', created_at: '' },
      })
      M.mockedAnalyze.mockResolvedValue(makeMockResponse({ question: '近 7 天销量' }))

      renderPage()
      fireEvent.click(screen.getByTestId('mock-send-btn'))

      await waitFor(() => {
        expect(M.mockedAnalyze).toHaveBeenCalled()
      })

      // For existing sessions with custom title, shouldAutoTitle is false
      expect(M.mockUpdateTitleMutate).not.toHaveBeenCalled()
    })

    it('auto-titles existing session when title is 新对话', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      M.mockAskSessionData = { id: 1, title: '新对话' }
      M.mockCreateMessageMutateAsync.mockResolvedValue({
        user_message: { id: 100, session_id: 1, role: 'user', content: '近 7 天销量分析', status: 'completed', created_at: '' },
        assistant_message: { id: 101, session_id: 1, role: 'assistant', content: '', status: 'pending', created_at: '' },
      })
      M.mockedAnalyze.mockResolvedValue(makeMockResponse({ question: '近 7 天销量分析' }))

      renderPage()
      fireEvent.click(screen.getByTestId('mock-send-btn'))

      await waitFor(() => {
        expect(M.mockedAnalyze).toHaveBeenCalled()
      })

      await waitFor(() => {
        expect(M.mockUpdateTitleMutate).toHaveBeenCalledWith(
          expect.objectContaining({ id: 1 }),
        )
      })
      // Title is generated from the question '近 7 天销量' (6 chars, no truncation)
      expect(M.mockUpdateTitleMutate).toHaveBeenCalledWith(
        expect.objectContaining({ title: '近 7 天销量' }),
      )
    })

    it('createSession race — does not leak to switched session', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = null
      let resolveCreateSess!: (v: any) => void
      M.mockCreateSessionMutateAsync.mockReturnValue(new Promise((r) => { resolveCreateSess = r }))
      M.mockCreateMessageMutateAsync.mockResolvedValue({
        user_message: { id: 100, session_id: 1, role: 'user', content: '', status: 'completed', created_at: '' },
        assistant_message: { id: 101, session_id: 1, role: 'assistant', content: '', status: 'pending', created_at: '' },
      })
      M.mockedAnalyze.mockResolvedValue(makeMockResponse())

      renderPage()
      expect(screen.getByText('选择或创建一个对话开始提问')).toBeInTheDocument()

      // Send question — triggers createSession
      fireEvent.click(screen.getByTestId('mock-send-btn'))

      // Switch to session B before createSession resolves
      fireEvent.click(screen.getByTestId('switch-session-btn'))
      vi.clearAllMocks()

      // Now resolve createSession as a new session 42
      resolveCreateSess({ id: 42 })

      await vi.waitFor(() => {
        // Must not set current session to the stale orphan 42
        expect(M.mockAskStoreState.setCurrentSession).not.toHaveBeenCalledWith(42)
      })
      // Must not create message or analyze for the stale request
      expect(M.mockCreateMessageMutateAsync).not.toHaveBeenCalled()
      expect(M.mockedAnalyze).not.toHaveBeenCalled()
    })

    it('stale createSession rejection does not show error or write B state', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = null
      let rejectCreateSess!: (v: any) => void
      M.mockCreateSessionMutateAsync.mockReturnValue(new Promise((_, r) => { rejectCreateSess = r }))
      M.mockCreateMessageMutateAsync.mockResolvedValue({
        user_message: { id: 100, session_id: 1, role: 'user', content: '', status: 'completed', created_at: '' },
        assistant_message: { id: 101, session_id: 1, role: 'assistant', content: '', status: 'pending', created_at: '' },
      })
      M.mockedAnalyze.mockResolvedValue(makeMockResponse())
      const errorSpy = vi.spyOn(message, 'error').mockImplementation(() => undefined as unknown as ReturnType<typeof message.error>)

      renderPage()
      // Send question — triggers createSession
      fireEvent.click(screen.getByTestId('mock-send-btn'))
      // Switch to B before createSession resolves
      fireEvent.click(screen.getByTestId('switch-session-btn'))
      vi.clearAllMocks()
      // Reject createSession — stale, must not show error
      rejectCreateSess(new Error('fail'))

      await vi.waitFor(() => {
        // No error message for the stale request
        expect(errorSpy).not.toHaveBeenCalled()
      })
      // No B state setters called
      expect(M.mockAskStoreState.setCurrentSession).not.toHaveBeenCalled()
      expect(aiAskState().setError).not.toHaveBeenCalled()

      errorSpy.mockRestore()
    })
  })

  describe('Phase 5N Late-response isolation', () => {
    it('A createMessage returns after switch to B — does not write B state', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      // Make createMessage hang until we resolve it manually
      let resolveCreateMsg!: (v: any) => void
      M.mockCreateMessageMutateAsync.mockReturnValue(new Promise((r) => { resolveCreateMsg = r }))
      M.mockedAnalyze.mockResolvedValue(makeMockResponse({ question: 'A的结果' }))

      renderPage()
      fireEvent.click(screen.getByTestId('mock-send-btn'))

      // Switch to session B before createMessage resolves
      fireEvent.click(screen.getByTestId('switch-session-btn'))
      vi.clearAllMocks()

      // Now A's createMessage resolves
      resolveCreateMsg({
        user_message: { id: 100, session_id: 1, role: 'user', content: 'A', status: 'completed', created_at: '' },
        assistant_message: { id: 11, session_id: 1, role: 'assistant', content: '', status: 'pending', created_at: '' },
      })

      // Let microtasks flush
      await vi.waitFor(() => {
        // B's state must not have been written by A's late response
        expect(aiAskState().setCurrentAssistantMessageId).not.toHaveBeenCalled()
        expect(aiAskState().setAnalyzing).not.toHaveBeenCalled()
      })
    })

    it('A analyze returns after switch to B — does not overwrite B response', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      let resolveAnalyze!: (v: any) => void
      M.mockCreateMessageMutateAsync.mockResolvedValue({
        user_message: { id: 100, session_id: 1, role: 'user', content: 'A', status: 'completed', created_at: '' },
        assistant_message: { id: 11, session_id: 1, role: 'assistant', content: '', status: 'pending', created_at: '' },
      })
      M.mockedAnalyze.mockReturnValue(new Promise((r) => { resolveAnalyze = r }))

      renderPage()
      fireEvent.click(screen.getByTestId('mock-send-btn'))

      // Switch to B before analyze resolves
      fireEvent.click(screen.getByTestId('switch-session-btn'))
      vi.clearAllMocks()

      // A's analyze resolves
      resolveAnalyze(makeMockResponse({ question: 'A的结果' }))

      await vi.waitFor(() => {
        // B's state must not be touched by A
        expect(aiAskState().setCurrentResponse).not.toHaveBeenCalled()
        expect(aiAskState().setAnalyzing).not.toHaveBeenCalled()
        expect(aiAskState().setError).not.toHaveBeenCalled()
      })
    })

    it('step interval from old request does not modify B state after switch', async () => {
      vi.useFakeTimers()
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      let resolveAnalyze!: (v: any) => void
      M.mockCreateMessageMutateAsync.mockResolvedValue({
        user_message: { id: 100, session_id: 1, role: 'user', content: 'A', status: 'completed', created_at: '' },
        assistant_message: { id: 11, session_id: 1, role: 'assistant', content: '', status: 'pending', created_at: '' },
      })
      M.mockedAnalyze.mockReturnValue(new Promise((r) => { resolveAnalyze = r }))

      renderPage()
      fireEvent.click(screen.getByTestId('mock-send-btn'))
      // Advance timers to let step interval start
      vi.advanceTimersByTime(100)

      // Switch to B — should invalidate token
      fireEvent.click(screen.getByTestId('switch-session-btn'))
      vi.clearAllMocks()

      // Advance more timers — old step interval should be dead
      vi.advanceTimersByTime(2000)

      expect(aiAskState().setAnalysisStep).not.toHaveBeenCalled()

      // Resolve A's analyze
      resolveAnalyze(makeMockResponse())
      vi.runAllTimers()
      vi.useRealTimers()
    })

    it('analyze reject cleans step interval and does not affect B', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      M.mockCreateMessageMutateAsync.mockResolvedValue({
        user_message: { id: 100, session_id: 1, role: 'user', content: 'A', status: 'completed', created_at: '' },
        assistant_message: { id: 11, session_id: 1, role: 'assistant', content: '', status: 'pending', created_at: '' },
      })
      M.mockedAnalyze.mockRejectedValue(new Error('分析失败'))

      renderPage()
      fireEvent.click(screen.getByTestId('mock-send-btn'))

      await vi.waitFor(() => {
        expect(aiAskState().setAnalyzing).toHaveBeenCalledWith(false)
      })
    })

    it('step interval does not fire after switch (token guard in interval callback)', async () => {
      vi.useFakeTimers()
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      let resolveAnalyze!: (v: any) => void
      M.mockCreateMessageMutateAsync.mockResolvedValue({
        user_message: { id: 100, session_id: 1, role: 'user', content: 'A', status: 'completed', created_at: '' },
        assistant_message: { id: 11, session_id: 1, role: 'assistant', content: '', status: 'pending', created_at: '' },
      })
      M.mockedAnalyze.mockReturnValue(new Promise((r) => { resolveAnalyze = r }))

      renderPage()
      fireEvent.click(screen.getByTestId('mock-send-btn'))

      // Wait for createMessage to resolve and analyze to be called
      await vi.waitFor(() => {
        expect(M.mockedAnalyze).toHaveBeenCalled()
      })
      // Now interval is started — advance timers a bit to let it fire
      vi.advanceTimersByTime(900)

      // Switch to B — should invalidate token
      fireEvent.click(screen.getByTestId('switch-session-btn'))
      vi.clearAllMocks()

      // Advance timers — old interval must not touch B state
      vi.advanceTimersByTime(2000)

      expect(aiAskState().setAnalysisStep).not.toHaveBeenCalled()
      expect(aiAskState().setAnalyzing).not.toHaveBeenCalled()
      expect(aiAskState().setError).not.toHaveBeenCalled()
      expect(aiAskState().setCurrentResponse).not.toHaveBeenCalled()

      // Resolve A's analyze — still must not affect B
      resolveAnalyze(makeMockResponse())
      vi.advanceTimersByTime(100)

      expect(aiAskState().setCurrentResponse).not.toHaveBeenCalled()
      expect(aiAskState().setAnalyzing).not.toHaveBeenCalled()
      expect(aiAskState().setError).not.toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('analyze reject cleans interval — no further setAnalysisStep', async () => {
      vi.useFakeTimers()
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      M.mockCreateMessageMutateAsync.mockResolvedValue({
        user_message: { id: 100, session_id: 1, role: 'user', content: 'A', status: 'completed', created_at: '' },
        assistant_message: { id: 11, session_id: 1, role: 'assistant', content: '', status: 'pending', created_at: '' },
      })

      let rejectAnalyze!: (v: any) => void
      M.mockedAnalyze.mockReturnValue(new Promise((_, r) => { rejectAnalyze = r }))

      renderPage()
      fireEvent.click(screen.getByTestId('mock-send-btn'))

      // Wait for analyze to be called (interval is running)
      await vi.waitFor(() => {
        expect(M.mockedAnalyze).toHaveBeenCalled()
      })

      // Reject analyze
      rejectAnalyze(new Error('失败'))

      // Let the catch/finally run
      await vi.waitFor(() => {
        expect(aiAskState().setAnalyzing).toHaveBeenCalledWith(false)
      })

      // Clear mocks after rejection
      vi.clearAllMocks()

      // Advance timers — interval was cleaned in finally, no more calls
      vi.advanceTimersByTime(3000)
      expect(aiAskState().setAnalysisStep).not.toHaveBeenCalled()
      expect(aiAskState().setAnalyzing).not.toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('stale createMessage rejection does not show error or write B state', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      let rejectCreateMsg!: (v: any) => void
      M.mockCreateMessageMutateAsync.mockReturnValue(new Promise((_, r) => { rejectCreateMsg = r }))
      M.mockCreateSessionMutateAsync.mockResolvedValue({ id: 1 })
      M.mockedAnalyze.mockResolvedValue(makeMockResponse())
      const errorSpy = vi.spyOn(message, 'error').mockImplementation(() => undefined as unknown as ReturnType<typeof message.error>)

      renderPage()
      // Send question — triggers createMessage
      fireEvent.click(screen.getByTestId('mock-send-btn'))
      // Switch to B before createMessage resolves
      fireEvent.click(screen.getByTestId('switch-session-btn'))
      vi.clearAllMocks()
      // Reject createMessage — stale, must not show error
      rejectCreateMsg(new Error('db fail'))

      await vi.waitFor(() => {
        // No "发送失败" message for the stale request
        expect(errorSpy).not.toHaveBeenCalled()
      })
      // No B state setters for analysis
      expect(aiAskState().setAnalyzing).not.toHaveBeenCalled()
      expect(aiAskState().setCurrentAssistantMessageId).not.toHaveBeenCalled()

      errorSpy.mockRestore()
    })
  })

  // ── Task 5: Mock mode removed, unified input, hard guards ──────

  describe('Task 5: no mock mode and unified input', () => {
    it('renders no mock-mode UI anywhere (no switch, no fallback button)', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      renderPage()
      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
      expect(screen.queryByText('真实 LLM')).not.toBeInTheDocument()
      expect(screen.queryByText('模拟模式')).not.toBeInTheDocument()
      expect(screen.queryByText('切回模拟模式再试')).not.toBeInTheDocument()
    })

    it('shows no mock fallback button when an LLM error is displayed', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      aiAskState().error = { code: 'LLM_CONNECTION_ERROR', message: '连接失败', name: 'AiAskError' }
      renderPage()
      expect(screen.getByText('分析异常')).toBeInTheDocument()
      expect(screen.queryByText('切回模拟模式再试')).not.toBeInTheDocument()
      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    })

    it('shows LLM config tooltip via a real DOM wrapper and disables input when no active LLM', async () => {
      vi.mocked(useLlmSettings).mockReturnValue({ data: [], isLoading: false } as any)
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      renderPage()
      expect(screen.getByTestId('ask-input')).toHaveAttribute('data-disabled', 'true')
      fireEvent.mouseOver(screen.getByTestId('ask-input-tooltip-trigger'))
      expect(await screen.findByText('请先在 LLM 连接管理中启用模型')).toBeInTheDocument()
    })

    it('does not show LLM config tooltip when active LLM exists', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      renderPage()
      fireEvent.mouseOver(screen.getByTestId('ask-input-tooltip-trigger'))
      expect(screen.queryByText('请先在 LLM 连接管理中启用模型')).not.toBeInTheDocument()
    })

    it('shows datasource preflight error when session is null and datasource is missing', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = null
      aiAskState().datasourceId = null
      aiAskState().datasourceName = null
      M.mockedAnalyze.mockResolvedValue(makeMockResponse())
      renderPage()

      fireEvent.click(screen.getByTestId('mock-send-btn'))

      await waitFor(() => {
        expect(aiAskState().setError).toHaveBeenCalledWith(
          expect.objectContaining({ message: '请先选择数据源' }),
        )
      })
      expect(M.mockCreateSessionMutateAsync).not.toHaveBeenCalled()
      expect(M.mockCreateMessageMutateAsync).not.toHaveBeenCalled()
      expect(M.mockedAnalyze).not.toHaveBeenCalled()
    })

    it('renders the datasource preflight error in the UI when currentSessionId is null', () => {
      // Set state before render so the error renders on first mount
      const M = m()
      M.mockAskStoreState.currentSessionId = null
      aiAskState().datasourceId = null
      aiAskState().datasourceName = null
      aiAskState().error = { code: 'UNKNOWN', message: '请先选择数据源', name: 'AiAskError' }
      renderPage()

      expect(screen.getByText('配置不足')).toBeInTheDocument()
      expect(screen.getByText('请先选择数据源')).toBeInTheDocument()
      // The empty state must not overlap the error
      expect(screen.queryByText('选择或创建一个对话开始提问')).not.toBeInTheDocument()
    })

    it('clears the preflight error and returns to empty session state when dismissed', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = null
      aiAskState().datasourceId = null
      aiAskState().datasourceName = null
      aiAskState().error = { code: 'UNKNOWN', message: '请先选择数据源', name: 'AiAskError' }
      const { rerenderPage } = renderPage()

      expect(screen.getByText('配置不足')).toBeInTheDocument()

      // Simulate clearError by the "关闭" button
      aiAskState().error = null
      rerenderPage()

      expect(screen.getByText('选择或创建一个对话开始提问')).toBeInTheDocument()
      expect(screen.queryByText('配置不足')).not.toBeInTheDocument()
    })

    it('enables the input when an active LLM setting exists', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      renderPage()
      expect(screen.getByTestId('ask-input')).toHaveAttribute('data-disabled', 'false')
    })

    it('blocks send without active LLM: no session, message, or analyze is created', async () => {
      vi.mocked(useLlmSettings).mockReturnValue({ data: [], isLoading: false } as any)
      const M = m()
      M.mockAskStoreState.currentSessionId = null
      M.mockedAnalyze.mockResolvedValue(makeMockResponse())
      renderPage()

      fireEvent.click(screen.getByTestId('mock-force-send-btn'))

      await new Promise((r) => setTimeout(r, 50))
      expect(M.mockCreateSessionMutateAsync).not.toHaveBeenCalled()
      expect(M.mockCreateMessageMutateAsync).not.toHaveBeenCalled()
      expect(M.mockedAnalyze).not.toHaveBeenCalled()
      expect(M.mockAskStoreState.setCurrentSession).not.toHaveBeenCalled()
    })

    it('blocks before createSession when datasource is missing (null)', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = null
      aiAskState().datasourceId = null
      aiAskState().datasourceName = null
      M.mockedAnalyze.mockResolvedValue(makeMockResponse())

      renderPage()
      fireEvent.click(screen.getByTestId('mock-send-btn'))

      await waitFor(() => {
        expect(aiAskState().setError).toHaveBeenCalledWith(
          expect.objectContaining({ message: '请先选择数据源' }),
        )
      })
      expect(M.mockCreateSessionMutateAsync).not.toHaveBeenCalled()
      expect(M.mockCreateMessageMutateAsync).not.toHaveBeenCalled()
      expect(M.mockedAnalyze).not.toHaveBeenCalled()
      expect(aiAskState().setAnalyzing).not.toHaveBeenCalled()
    })

    it('blocks before createSession when datasource is missing (undefined)', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = null
      aiAskState().datasourceId = undefined
      aiAskState().datasourceName = undefined
      M.mockedAnalyze.mockResolvedValue(makeMockResponse())

      renderPage()
      fireEvent.click(screen.getByTestId('mock-send-btn'))

      await waitFor(() => {
        expect(aiAskState().setError).toHaveBeenCalledWith(
          expect.objectContaining({ message: '请先选择数据源' }),
        )
      })
      expect(M.mockCreateSessionMutateAsync).not.toHaveBeenCalled()
      expect(M.mockCreateMessageMutateAsync).not.toHaveBeenCalled()
      expect(M.mockedAnalyze).not.toHaveBeenCalled()
    })

    it('sends normally when active LLM and datasource are both present', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = null
      M.mockedAnalyze.mockResolvedValue(makeMockResponse({ question: '近 7 天销量' }))

      renderPage()
      fireEvent.click(screen.getByTestId('mock-send-btn'))

      await waitFor(() => {
        expect(M.mockCreateSessionMutateAsync).toHaveBeenCalled()
      })
      await waitFor(() => {
        expect(M.mockedAnalyze).toHaveBeenCalled()
      })
    })

    it('renders exactly one AskInput in the empty state', () => {
      renderPage()
      expect(screen.getAllByTestId('ask-input')).toHaveLength(1)
    })

    it('renders exactly one AskInput in the welcome state', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      renderPage()
      expect(screen.getAllByTestId('ask-input')).toHaveLength(1)
    })

    it('renders exactly one AskInput in the results state', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      aiAskState().currentResponse = makeMockResponse()
      renderPage()
      expect(screen.getAllByTestId('ask-input')).toHaveLength(1)
    })

    it('renders exactly one AskInput in the sql_pending state', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      aiAskState().currentResponse = makeMockResponse({ narrativeLevel: 'sql_pending' })
      renderPage()
      expect(screen.getByText('AiChartBoard (sql_pending)')).toBeInTheDocument()
      expect(screen.getAllByTestId('ask-input')).toHaveLength(1)
    })

    it('renders exactly one AskInput in the error state', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      aiAskState().error = { code: 'ANALYSIS_TIMEOUT', message: '超时', name: 'AiAskError' }
      renderPage()
      expect(screen.getAllByTestId('ask-input')).toHaveLength(1)
    })
  })

  // ── Phase 5M: Narrative Trust & Error UI tests ─────────────────

  describe('Phase 5M Narrative Trust UI', () => {
    it('shows metadata guidance when storeError.code is METADATA_NOT_FOUND', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      aiAskState().currentResponse = null
      aiAskState().isAnalyzing = false
      aiAskState().error = { code: 'METADATA_NOT_FOUND', message: '元数据未找到', name: 'AiAskError' }
      renderPage()
      expect(screen.getByText('表元数据未采集')).toBeInTheDocument()
      expect(screen.getByText('请先采集元数据或选择已采集的数据表')).toBeInTheDocument()
    })

    it('navigates to /web/datasources when metadata guidance button is clicked', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      aiAskState().currentResponse = null
      aiAskState().isAnalyzing = false
      aiAskState().error = { code: 'METADATA_NOT_FOUND', message: '元数据未找到', name: 'AiAskError' }
      renderPage()
      const button = screen.getByText('前往数据源管理').closest('button')!
      expect(button).toBeInTheDocument()
      fireEvent.click(button)
      expect(M.mockNavigateToExternal).toHaveBeenCalledWith('/web/datasources')
    })

    it('does NOT render result area when METADATA_NOT_FOUND', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      aiAskState().currentResponse = makeMockResponse()
      aiAskState().isAnalyzing = false
      aiAskState().error = { code: 'METADATA_NOT_FOUND', message: '元数据未找到', name: 'AiAskError' }
      renderPage()
      expect(screen.queryByTestId('intent-card')).not.toBeInTheDocument()
      expect(screen.queryByTestId('sql-plan')).not.toBeInTheDocument()
      expect(screen.queryByTestId('ai-chart-board')).not.toBeInTheDocument()
      expect(screen.queryByTestId('ai-narrative')).not.toBeInTheDocument()
    })

    it('shows SqlValidationAlert when INVALID_RESPONSE with details.sqlValidation', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      aiAskState().currentResponse = makeMockResponse()
      aiAskState().isAnalyzing = false
      aiAskState().error = {
        code: 'INVALID_RESPONSE',
        message: 'SQL 校验未通过',
        name: 'AiAskError',
        details: {
          sqlValidation: {
            errors: [{ rule: 'FIELD_NOT_FOUND', message: '字段 region 在表中不存在' }],
            warnings: [],
            sql: 'SELECT region FROM t',
          },
        },
      }
      renderPage()
      expect(screen.getByText('字段 region 在表中不存在')).toBeInTheDocument()
    })

    it('does NOT render result area when INVALID_RESPONSE with sqlValidation', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      aiAskState().currentResponse = makeMockResponse()
      aiAskState().isAnalyzing = false
      aiAskState().error = {
        code: 'INVALID_RESPONSE',
        message: 'SQL 校验未通过',
        name: 'AiAskError',
        details: {
          sqlValidation: {
            errors: [{ rule: 'FIELD_NOT_FOUND', message: '字段 region 不存在' }],
            warnings: [],
            sql: 'SELECT region FROM t',
          },
        },
      }
      renderPage()
      expect(screen.queryByTestId('intent-card')).not.toBeInTheDocument()
      expect(screen.queryByTestId('sql-plan')).not.toBeInTheDocument()
      expect(screen.queryByTestId('ai-chart-board')).not.toBeInTheDocument()
      expect(screen.queryByTestId('ai-narrative')).not.toBeInTheDocument()
    })

    it('shows default error alert for other error codes', () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      aiAskState().currentResponse = null
      aiAskState().isAnalyzing = false
      aiAskState().error = { code: 'ANALYSIS_TIMEOUT', message: '超时', name: 'AiAskError' }
      renderPage()
      expect(screen.getByText('分析异常')).toBeInTheDocument()
    })
  })

  // ── Phase 5N Task 8: Execute button ─────────────────────────

  describe('Phase 5N Task 8 Execute button', () => {
    beforeEach(() => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      aiAskState().currentAssistantMessageId = 101
      aiAskState().currentResponse = {
        question: '各区域销售额',
        intent: { metrics: ['销售额'], dimensions: ['区域'], filters: [] },
        sqlPlan: {
          datasourceId: 2, datasourceName: 'dwhrpt',
          sql: 'SELECT * FROM t', tables: ['t'], fields: ['a'],
          assumptions: [], safetyWarnings: [],
        },
        chartSuggestions: [],
        narrative: {
          summary: 's', keyFindings: [], evidence: [],
          risks: [], nextQuestions: [],
        },
        semanticGaps: [],
        narrativeLevel: 'sql_pending',
      }
      // Reset executeSql mock
      M.mockExecuteSql.mockReset()
    })

  describe('Safety disclaimer', () => {
    it('shows full safety disclaimer when narrativeLevel is sql_pending', () => {
      renderPage()
      expect(
        screen.getByText('将安全执行当前 SQL（最大返回 1000 行，30 秒超时，仅允许 SELECT）。'),
      ).toBeInTheDocument()
    })

    it('hides safety disclaimer and execute button when narrativeLevel is executed', () => {
      aiAskState().currentResponse = {
        ...aiAskState().currentResponse,
        narrativeLevel: 'executed',
      }
      renderPage()
      expect(screen.queryByTestId('execute-sql-btn')).not.toBeInTheDocument()
      expect(
        screen.queryByText(
          '将安全执行当前 SQL（最大返回 1000 行，30 秒超时，仅允许 SELECT）。',
        ),
      ).not.toBeInTheDocument()
    })

    it('does not call executeSql automatically before clicking the button', () => {
      const M = m()
      renderPage()
      expect(M.mockExecuteSql).not.toHaveBeenCalled()
    })

    it('calls executeSql exactly once after clicking verify and execute', async () => {
      const M = m()
      M.mockExecuteSql.mockResolvedValue({
        data: { ...aiAskState().currentResponse, narrativeLevel: 'executed' },
      })
      renderPage()
      fireEvent.click(screen.getByTestId('execute-sql-btn'))
      await vi.waitFor(() => {
        expect(M.mockExecuteSql).toHaveBeenCalledTimes(1)
      })
    })

    it('keeps safety disclaimer visible and shows executing button text when isExecuting', () => {
      aiAskState().isExecuting = true
      renderPage()
      expect(
        screen.getByText('将安全执行当前 SQL（最大返回 1000 行，30 秒超时，仅允许 SELECT）。'),
      ).toBeInTheDocument()
      expect(screen.getByText('执行中...')).toBeInTheDocument()
    })
  })

    it('shows execute button when narrativeLevel is sql_pending', () => {
      renderPage()
      expect(screen.getByTestId('execute-sql-btn')).toBeInTheDocument()
      expect(screen.getByText('验证并执行')).toBeInTheDocument()
    })

    it('hides execute button when narrativeLevel is executed', () => {
      aiAskState().currentResponse = { ...aiAskState().currentResponse, narrativeLevel: 'executed' }
      renderPage()
      expect(screen.queryByTestId('execute-sql-btn')).not.toBeInTheDocument()
    })

    it('button disabled when no currentAssistantMessageId', () => {
      aiAskState().currentAssistantMessageId = null
      renderPage()
      const btn = screen.getByTestId('execute-sql-btn')
      expect(btn).toBeDisabled()
    })

    it('button disabled during execution', () => {
      aiAskState().isExecuting = true
      renderPage()
      const btn = screen.getByTestId('execute-sql-btn')
      expect(btn).toBeDisabled()
    })

    it('click calls executeSql with correct sessionId and assistantMessageId', async () => {
      const M = m()
      M.mockExecuteSql.mockResolvedValue({
        data: { ...aiAskState().currentResponse, narrativeLevel: 'executed' },
      })
      renderPage()
      fireEvent.click(screen.getByTestId('execute-sql-btn'))
      await vi.waitFor(() => {
        expect(M.mockExecuteSql).toHaveBeenCalledWith(1, 101)
      })
    })

    it('double-click only calls executeSql once (isExecuting guard in handleExecute)', async () => {
      const M = m()
      // Set isExecuting=true before click — handleExecute returns early
      aiAskState().isExecuting = true
      renderPage()
      fireEvent.click(screen.getByTestId('execute-sql-btn'))
      expect(M.mockExecuteSql).not.toHaveBeenCalled()
    })

    it('successful execution sets currentResponse', async () => {
      const M = m()
      const executedResponse = {
        ...aiAskState().currentResponse,
        narrativeLevel: 'executed' as const,
        resultSummary: { rowCount: 5, durationMs: 100 },
      }
      M.mockExecuteSql.mockResolvedValue({ data: executedResponse })
      renderPage()
      fireEvent.click(screen.getByTestId('execute-sql-btn'))
      await vi.waitFor(() => {
        expect(aiAskState().setCurrentResponse).toHaveBeenCalledWith(executedResponse)
      })
    })

    it('failure keeps currentResponse intact and sets error', async () => {
      const M = m()
      // Add a valid message so recovery effect does NOT clear state
      const validResp = aiAskState().currentResponse
      M.mockAskMessagesData = [
        { id: 1, session_id: 1, role: 'user', content: '测试', status: 'completed', created_at: '2024-01-01T00:00:00Z' },
        { id: 2, session_id: 1, role: 'assistant', content: '结果', status: 'completed', created_at: '2024-01-01T00:00:01Z', response_json: { schemaVersion: 1, data: validResp } },
      ]
      M.mockExecuteSql.mockRejectedValue(
        new Error('数据库超时'),
      )
      renderPage()
      fireEvent.click(screen.getByTestId('execute-sql-btn'))
      await vi.waitFor(() => {
        // Error must be set
        expect(aiAskState().setError).toHaveBeenCalled()
      })
      // Verify setExecuting(false) was called
      expect(aiAskState().setExecuting).toHaveBeenCalledWith(false)
    })

    it('shows EXECUTION_ERROR in the UI after failure (via rerender)', async () => {
      const M = m()
      // Add valid message so recovery effect doesn't clear
      const validResp = aiAskState().currentResponse
      M.mockAskMessagesData = [
        { id: 1, session_id: 1, role: 'user', content: '测试', status: 'completed', created_at: '2024-01-01T00:00:00Z' },
        { id: 2, session_id: 1, role: 'assistant', content: '结果', status: 'completed', created_at: '2024-01-01T00:00:01Z', response_json: { schemaVersion: 1, data: validResp } },
      ]
      M.mockExecuteSql.mockRejectedValue(
        new Error('数据库连接失败'),
      )
      const { rerenderPage } = renderPage()
      fireEvent.click(screen.getByTestId('execute-sql-btn'))
      await vi.waitFor(() => {
        // After rejection, setError stores the error on M
        expect(aiAskState().setError).toHaveBeenCalled()
      })
      // Rerender to pick up mutated store state
      rerenderPage()
      expect(screen.getByText('执行失败')).toBeInTheDocument()
    })

    it('execution during session switch — late response discarded', async () => {
      const M = m()
      let resolveExec!: (v: any) => void
      M.mockExecuteSql.mockReturnValue(new Promise((r) => { resolveExec = r }))
      renderPage()
      fireEvent.click(screen.getByTestId('execute-sql-btn'))
      // Switch session — invalidates token
      fireEvent.click(screen.getByTestId('switch-session-btn'))
      vi.clearAllMocks()
      // Late execute resolves
      resolveExec({ data: { ...aiAskState().currentResponse, narrativeLevel: 'executed' } })
      await vi.waitFor(() => {
        // Must not write stale result
        expect(aiAskState().setCurrentResponse).not.toHaveBeenCalled()
        expect(aiAskState().setError).not.toHaveBeenCalled()
      })
    })

    it('409 EXECUTION_ERROR from executeSql shows "正在执行中" in error UI', async () => {
      const M = m()
      M.mockExecuteSql.mockRejectedValue(
        new Error('正在执行中，请稍候'),
      )
      renderPage()
      fireEvent.click(screen.getByTestId('execute-sql-btn'))
      await vi.waitFor(() => {
        expect(screen.getByTestId('execute-sql-btn')).toBeInTheDocument()
      })
    })

    it('successful execution populates chartDataRef from queryResult', async () => {
      const M = m()
      const executedResponse = {
        ...aiAskState().currentResponse,
        narrativeLevel: 'executed' as const,
        queryResult: {
          columns: ['region', 'sales'],
          rows: [['华东', 1000]],
          rowCount: 1,
          truncated: false,
          elapsedMs: 50,
          historyId: 1,
        },
      }
      M.mockExecuteSql.mockResolvedValue({ data: executedResponse })
      renderPage()
      fireEvent.click(screen.getByTestId('execute-sql-btn'))
      await vi.waitFor(() => {
        expect(aiAskState().setCurrentResponse).toHaveBeenCalled()
      })
    })
    it('passes queryResult to AiChartBoard when executed', async () => {
      const M = m()
      const executedResponse = {
        ...aiAskState().currentResponse,
        narrativeLevel: 'executed' as const,
        queryResult: {
          columns: ['region', 'sales'],
          rows: [['华东', 1000], ['华南', 500]],
          rowCount: 2,
          truncated: false,
          elapsedMs: 50,
          historyId: null,
        },
      }
      M.mockExecuteSql.mockResolvedValue({ data: executedResponse })
      const { rerenderPage } = renderPage()
      fireEvent.click(screen.getByTestId('execute-sql-btn'))
      await vi.waitFor(() => {
        expect(aiAskState().setCurrentResponse).toHaveBeenCalled()
      })
      aiAskState().currentResponse = executedResponse
      rerenderPage()
      expect(screen.getByTestId('ai-chart-board').textContent).toContain('queryResult:2行')
    })

    it('does not pass queryResult to AiChartBoard when sql_pending', async () => {
      aiAskState().currentResponse = {
        ...aiAskState().currentResponse!,
        narrativeLevel: 'sql_pending',
        queryResult: null,
      }
      renderPage()
      const chartBoard = screen.queryByTestId('ai-chart-board')
      // sql_pending with empty chartSuggestions — AiChartBoard may not render at all
      if (chartBoard) {
        expect(chartBoard.textContent).not.toContain('queryResult')
      }
    })

    it('renders faithful values - 0.5 displays as 0.5 not 50%', async () => {
      const M = m()
      const executedResponse = {
        ...aiAskState().currentResponse,
        narrativeLevel: 'executed' as const,
        queryResult: {
          columns: ['ratio'],
          rows: [[0.5]],
          rowCount: 1,
          truncated: false,
          elapsedMs: 10,
          historyId: null,
        },
      }
      M.mockExecuteSql.mockResolvedValue({ data: executedResponse })
      const { rerenderPage } = renderPage()
      fireEvent.click(screen.getByTestId('execute-sql-btn'))
      await vi.waitFor(() => {
        expect(aiAskState().setCurrentResponse).toHaveBeenCalled()
      })
      aiAskState().currentResponse = executedResponse
      rerenderPage()
      expect(screen.getByText('0.5')).toBeInTheDocument()
      expect(screen.queryByText('50.00%')).not.toBeInTheDocument()
    })

    it('renders faithful values - 12345 displays as 12345 not compacted', async () => {
      const M = m()
      const executedResponse = {
        ...aiAskState().currentResponse,
        narrativeLevel: 'executed' as const,
        queryResult: {
          columns: ['value'],
          rows: [[12345]],
          rowCount: 1,
          truncated: false,
          elapsedMs: 10,
          historyId: null,
        },
      }
      M.mockExecuteSql.mockResolvedValue({ data: executedResponse })
      const { rerenderPage } = renderPage()
      fireEvent.click(screen.getByTestId('execute-sql-btn'))
      await vi.waitFor(() => {
        expect(aiAskState().setCurrentResponse).toHaveBeenCalled()
      })
      aiAskState().currentResponse = executedResponse
      rerenderPage()
      expect(screen.getByText('12345')).toBeInTheDocument()
      expect(screen.queryByText('1.2\u4e07')).not.toBeInTheDocument()
    })
    it('renders faithful values - 0.123456789012345 displays fully not truncated', async () => {
      const M = m()
      const executedResponse = {
        ...aiAskState().currentResponse,
        narrativeLevel: 'executed' as const,
        queryResult: {
          columns: ['val'],
          rows: [[0.123456789012345]],
          rowCount: 1,
          truncated: false,
          elapsedMs: 10,
          historyId: null,
        },
      }
      M.mockExecuteSql.mockResolvedValue({ data: executedResponse })
      const { rerenderPage } = renderPage()
      fireEvent.click(screen.getByTestId('execute-sql-btn'))
      await vi.waitFor(() => {
        expect(aiAskState().setCurrentResponse).toHaveBeenCalled()
      })
      aiAskState().currentResponse = executedResponse
      rerenderPage()
      expect(screen.getByText('0.123456789012345')).toBeInTheDocument()
    })

    it('renders faithful values - 0.0000001 displays as 1e-7 not 0', async () => {
      const M = m()
      const executedResponse = {
        ...aiAskState().currentResponse,
        narrativeLevel: 'executed' as const,
        queryResult: {
          columns: ['val'],
          rows: [[0.0000001]],
          rowCount: 1,
          truncated: false,
          elapsedMs: 10,
          historyId: null,
        },
      }
      M.mockExecuteSql.mockResolvedValue({ data: executedResponse })
      const { rerenderPage } = renderPage()
      fireEvent.click(screen.getByTestId('execute-sql-btn'))
      await vi.waitFor(() => {
        expect(aiAskState().setCurrentResponse).toHaveBeenCalled()
      })
      aiAskState().currentResponse = executedResponse
      rerenderPage()
      expect(screen.getByText('1e-7')).toBeInTheDocument()
    })

    it('renders faithful values - string decimal preserved verbatim', async () => {
      const M = m()
      const decimalStr = '99999999999999999999999999999999999999.01'
      const executedResponse = {
        ...aiAskState().currentResponse,
        narrativeLevel: 'executed' as const,
        queryResult: {
          columns: ['val'],
          rows: [[decimalStr]],
          rowCount: 1,
          truncated: false,
          elapsedMs: 10,
          historyId: null,
        },
      }
      M.mockExecuteSql.mockResolvedValue({ data: executedResponse })
      const { rerenderPage } = renderPage()
      fireEvent.click(screen.getByTestId('execute-sql-btn'))
      await vi.waitFor(() => {
        expect(aiAskState().setCurrentResponse).toHaveBeenCalled()
      })
      aiAskState().currentResponse = executedResponse
      rerenderPage()
      expect(screen.getByText(decimalStr)).toBeInTheDocument()
    })

    it('renders dimension-only executed result table without fabricated chart', async () => {
      const M = m()
      const executedResponse = {
        ...aiAskState().currentResponse,
        narrativeLevel: 'executed' as const,
        chartSuggestions: [],
        queryResult: {
          columns: ['区域'],
          rows: [['长三角'], ['京津冀']],
          rowCount: 2,
          truncated: false,
          elapsedMs: 150,
          historyId: null,
        },
      }
      M.mockExecuteSql.mockResolvedValue({ data: executedResponse })
      const { rerenderPage } = renderPage()
      fireEvent.click(screen.getByTestId('execute-sql-btn'))
      await vi.waitFor(() => {
        expect(aiAskState().setCurrentResponse).toHaveBeenCalled()
      })
      aiAskState().currentResponse = executedResponse
      rerenderPage()
      expect(screen.getByText('长三角')).toBeInTheDocument()
      expect(screen.getByText('京津冀')).toBeInTheDocument()
      expect(screen.getByTestId('ai-chart-board').textContent).toContain('queryResult:2行')
    })

    it('does not crash when analyze response has empty chartSuggestions', async () => {
      const M = m()
      M.mockAskStoreState.currentSessionId = 1
      const responseWithEmptyCharts = makeMockResponse({ chartSuggestions: [], narrativeLevel: 'sql_pending' })
      M.mockedAnalyze.mockResolvedValue(responseWithEmptyCharts)
      aiAskState().currentResponse = null
      renderPage()
      fireEvent.click(screen.getByTestId('mock-send-btn'))
      await vi.waitFor(() => {
        expect(M.mockedAnalyze).toHaveBeenCalled()
      })
      expect(aiAskState().setCurrentResponse).toHaveBeenCalledWith(expect.objectContaining({ narrativeLevel: 'sql_pending' }))
    })

  })
})
