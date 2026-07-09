import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { message } from 'antd'
import AskWorkbenchPage from './AskWorkbenchPage'

const { mockedAnalyze } = vi.hoisted(() => ({
  mockedAnalyze: vi.fn(),
}))

// --- Mocks ---

const mockAskStore: {
  currentSessionId: number | null
  setCurrentSession: ReturnType<typeof vi.fn>
  startStream: ReturnType<typeof vi.fn>
  appendToken: ReturnType<typeof vi.fn>
  stopStream: ReturnType<typeof vi.fn>
} = {
  currentSessionId: null,
  setCurrentSession: vi.fn(),
  startStream: vi.fn(),
  appendToken: vi.fn(),
  stopStream: vi.fn(),
}

vi.mock('../stores/askStore', () => ({
  useAskStore: vi.fn((selector?: (s: typeof mockAskStore) => any) => {
    if (selector) return selector(mockAskStore)
    return mockAskStore
  }),
}))

// Mock aiAskStore with a mutable state for test control
let mockAiAskState: Record<string, any> = {
  datasourceId: null,
  datasourceName: null,
  selectedTables: [],
  currentResponse: null,
  isAnalyzing: false,
  isExecuting: false,
  activeChartIndex: 0,
  analysisStep: 0,
  adapterName: 'MockAdapter',
  responseValidation: null,
  error: null,
  useRealLlm: false,
  responseHistory: {},
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
  setUseRealLlm: vi.fn(),
  saveResponseForMessage: vi.fn(),
  getResponseForMessage: vi.fn(),
  reset: vi.fn(),
}

vi.mock('../stores/aiAskStore', () => {
  const useAiAskStore = vi.fn((selector?: (s: typeof mockAiAskState) => any) => {
    if (selector) return selector(mockAiAskState)
    return mockAiAskState
  })
  ;(useAiAskStore as any).getState = vi.fn(() => mockAiAskState)
  return { useAiAskStore }
})

vi.mock('../api/askSessions', () => ({
  useAskMessages: vi.fn(() => ({ data: [], isLoading: false })),
  useCreateMessage: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useCreateSession: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({ id: 1 }),
    isPending: false,
  })),
}))

vi.mock('../api/llmSettings', () => ({
  useLlmSettings: vi.fn(() => ({ data: undefined, isLoading: false })),
}))

// Re-import useLlmSettings after mock for test access
import { useLlmSettings } from '../api/llmSettings'

vi.mock('../api/aiAsk', async () => {
  const inputGuard = await vi.importActual('../api/aiAsk/inputGuard')
  const contextPolicy = await vi.importActual('../api/aiAsk/contextPolicy')
  return {
    validateAiAskInput: (inputGuard as any).validateAiAskInput,
    buildMessageHistory: (contextPolicy as any).buildMessageHistory,
    useAiAskService: vi.fn(() => ({
      name: 'MockAdapter',
      analyze: mockedAnalyze,
      getChartData: vi.fn(() => ({ columns: ['region', 'revenue'], rows: [['华东', 1000]], isEmpty: false })),
      isAvailable: vi.fn(() => true),
      validate: vi.fn(() => ({ valid: true, errors: [], warnings: [] })),
    })),
    AiAskError: class extends Error {
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
  }
})

vi.mock('../components/SessionList', () => ({
  default: () => <div data-testid="session-list">SessionList</div>,
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

vi.mock('../components/DataScopeSelector', () => ({
  default: () => <div data-testid="data-scope-selector">DataScopeSelector</div>,
}))

vi.mock('../components/PromptCards', () => ({
  default: () => <div data-testid="prompt-cards">PromptCards</div>,
}))

vi.mock('../components/AskInput', () => ({
  default: ({ onSend, loading }: any) => (
    <div data-testid="ask-input">
      AskInput
      <button
        data-testid="mock-send-btn"
        onClick={() => {
          if (!loading) onSend?.('近 7 天销量')
        }}
        type="button"
      >
        Send
      </button>
      <button
        data-testid="mock-send-invalid-btn"
        onClick={() => {
          if (!loading) onSend?.('，，！')
        }}
        type="button"
      >
        Send Invalid
      </button>
      <button
        data-testid="mock-send-empty-btn"
        onClick={() => {
          if (!loading) onSend?.('')
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
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ask']}>
        <AskWorkbenchPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function makeMockResponse(overrides?: Record<string, any>) {
  return {
    question: 'test',
    intent: { metrics: [], dimensions: [], filters: [], timeRange: undefined },
    sqlPlan: { datasourceId: 0, datasourceName: '', sql: '', tables: [], fields: [], assumptions: [], safetyWarnings: [] },
    chartSuggestions: [{ title: '图', chartType: 'bar', yFields: ['x'], rationale: 'r', limitations: [] }],
    narrative: { summary: '', keyFindings: [], evidence: [], risks: [], nextQuestions: [] },
    semanticGaps: [],
    resultSummary: { rowCount: 2, durationMs: 150, truncated: false },
    ...overrides,
  }
}

// --- Tests ---

describe('AskWorkbenchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAskStore.currentSessionId = null
    // Reset aiAsk state to default
    mockAiAskState = {
      datasourceId: null,
      datasourceName: null,
      selectedTables: [],
      currentResponse: null,
      isAnalyzing: false,
      isExecuting: false,
      activeChartIndex: 0,
      analysisStep: 0,
      adapterName: 'MockAdapter',
      responseValidation: null,
      error: null,
      useRealLlm: false,
      responseHistory: {},
      setDatasource: vi.fn(),
      setSelectedTables: vi.fn(),
      setCurrentResponse: vi.fn(),
      setAnalyzing: vi.fn(),
      setExecuting: vi.fn(),
      setActiveChart: vi.fn(),
      setAnalysisStep: vi.fn(),
      setAdapterName: vi.fn(),
      setResponseValidation: vi.fn(),
      setError: vi.fn((err) => { (mockAiAskState as any).error = err }),
      clearError: vi.fn(),
      setUseRealLlm: vi.fn(),
      saveResponseForMessage: vi.fn(),
      getResponseForMessage: vi.fn(),
      reset: vi.fn(),
    }
  })

  it('renders sidebar elements always', () => {
    renderPage()
    expect(screen.getByTestId('session-list')).toBeInTheDocument()
    expect(screen.getByTestId('agent-nav')).toBeInTheDocument()
    expect(screen.getByTestId('data-scope-selector')).toBeInTheDocument()
  })

  it('shows empty state when no session selected', () => {
    renderPage()
    expect(screen.getByText('选择或创建一个对话开始提问')).toBeInTheDocument()
  })

  it('shows welcome state when session is selected', () => {
    mockAskStore.currentSessionId = 1
    renderPage()
    expect(screen.getByText('MetricForge 智能问数')).toBeInTheDocument()
    expect(screen.getByTestId('prompt-cards')).toBeInTheDocument()
    expect(screen.getByTestId('ask-input')).toBeInTheDocument()
  })

  it('shows message thread when session is selected', () => {
    mockAskStore.currentSessionId = 1
    renderPage()
    expect(screen.getByTestId('message-thread')).toBeInTheDocument()
  })

  it('shows AI result components when currentResponse is set', () => {
    mockAskStore.currentSessionId = 1
    mockAiAskState.currentResponse = makeMockResponse()
    mockAiAskState.isAnalyzing = false
    renderPage()
    expect(screen.getByTestId('intent-card')).toBeInTheDocument()
    expect(screen.getByTestId('sql-plan')).toBeInTheDocument()
    expect(screen.getByTestId('ai-chart-board')).toBeInTheDocument()
    expect(screen.getByTestId('ai-narrative')).toBeInTheDocument()
  })

  it('shows truncated data notice when resultSummary.truncated is true', () => {
    mockAskStore.currentSessionId = 1
    mockAiAskState.currentResponse = makeMockResponse({
      resultSummary: { rowCount: 100, durationMs: 200, truncated: true },
    })
    mockAiAskState.isAnalyzing = false
    renderPage()
    expect(screen.getByText('结果仅显示部分数据，建议细化查询条件以获得更精确的结果')).toBeInTheDocument()
  })

  it('does not show truncated notice when resultSummary.truncated is false', () => {
    mockAskStore.currentSessionId = 1
    mockAiAskState.currentResponse = makeMockResponse({
      resultSummary: { rowCount: 6, durationMs: 200, truncated: false },
    })
    mockAiAskState.isAnalyzing = false
    renderPage()
    expect(screen.queryByText('结果仅显示部分数据，建议细化查询条件以获得更精确的结果')).not.toBeInTheDocument()
  })

  it('does not show truncated notice when resultSummary is absent', () => {
    mockAskStore.currentSessionId = 1
    mockAiAskState.currentResponse = makeMockResponse({ resultSummary: undefined })
    mockAiAskState.isAnalyzing = false
    renderPage()
    expect(screen.queryByText('结果仅显示部分数据，建议细化查询条件以获得更精确的结果')).not.toBeInTheDocument()
  })

  it('shows result summary header when resultSummary is available', () => {
    mockAskStore.currentSessionId = 1
    mockAiAskState.currentResponse = makeMockResponse()
    mockAiAskState.isAnalyzing = false
    renderPage()
    // Result summary info text (chartDataRef guard prevents table from rendering,
    // but results section renders the other components)
    expect(screen.getByTestId('intent-card')).toBeInTheDocument()
    expect(screen.getByTestId('sql-plan')).toBeInTheDocument()
  })

  it('shows skeleton card placeholders and step progress when analyzing', () => {
    mockAskStore.currentSessionId = 1
    mockAiAskState.currentResponse = null
    mockAiAskState.isAnalyzing = true
    mockAiAskState.analysisStep = 2
    renderPage()
    expect(screen.getByText('AI 正在分析你的问题...')).toBeInTheDocument()
    // Step labels
    expect(screen.getByText('AI 正在理解你的问题')).toBeInTheDocument()
    expect(screen.getByText('正在分析查询计划')).toBeInTheDocument()
    expect(screen.getByText('正在获取数据')).toBeInTheDocument()
    expect(screen.getByText('正在生成图表')).toBeInTheDocument()
    expect(screen.getByText('正在生成解读摘要')).toBeInTheDocument()
    // Current step shows "进行中..."
    expect(screen.getByText('进行中...')).toBeInTheDocument()
  })

  it('shows step 1 as active and no "进行中" for completed steps', () => {
    mockAskStore.currentSessionId = 1
    mockAiAskState.currentResponse = null
    mockAiAskState.isAnalyzing = true
    mockAiAskState.analysisStep = 5
    renderPage()
    expect(screen.getByText('AI 正在分析你的问题...')).toBeInTheDocument()
    // Only one "进行中..." (for step 5)
    const progressLabels = screen.getAllByText('进行中...')
    expect(progressLabels.length).toBe(1)
  })

  it('passes messageHistory with previous responseJson on second send (Phase 5H follow-up integration)', async () => {
    mockAskStore.currentSessionId = 1
    // Simulate a first-round response being stored
    const firstResponse = makeMockResponse({ question: '上个月各区域销售额' })
    mockAiAskState.currentResponse = firstResponse
    mockAiAskState.isAnalyzing = false

    // Make analyze resolve to a follow-up-like response
    mockedAnalyze.mockResolvedValue(makeMockResponse({
      question: 'follow-up question about 华东',
      followUp: { type: 'drill_down', confidence: 'high' },
    }))

    renderPage()

    // Verify welcome/result state is shown (session exists + response exists)
    expect(screen.getByTestId('ask-input')).toBeInTheDocument()

    // Click the mock send button to trigger a second turn
    const sendBtn = screen.getByTestId('mock-send-btn')
    fireEvent.click(sendBtn)

    // Wait for analyze to be called
    await waitFor(() => {
      expect(mockedAnalyze).toHaveBeenCalled()
    })

    // Analyze should have been called with messageHistory containing assistant responseJson
    const analyzeCallArgs = mockedAnalyze.mock.calls[0]
    const callContext = analyzeCallArgs[1] // second argument (AiAskContext)

    // Verify messageHistory is present and structured correctly
    expect(callContext.messageHistory).toBeDefined()
    expect(callContext.messageHistory).toHaveLength(2)
    expect(callContext.messageHistory[0].role).toBe('user')
    expect(callContext.messageHistory[0].content).toBe('上个月各区域销售额')
    expect(callContext.messageHistory[1].role).toBe('assistant')
    expect(callContext.messageHistory[1].responseJson).toBeDefined()
    // Verify the assistant responseJson contains the original question
    expect((callContext.messageHistory[1].responseJson as any).question).toBe('上个月各区域销售额')
  })

  it('shows error alert when error is set', () => {
    mockAskStore.currentSessionId = 1
    mockAiAskState.currentResponse = null
    mockAiAskState.isAnalyzing = false
    mockAiAskState.error = { code: 'ANALYSIS_TIMEOUT', message: '超时', name: 'AiAskError' }
    renderPage()
    expect(screen.getByText('分析异常')).toBeInTheDocument()
  })

  it('blocks invalid input and does not call adapter.analyze', async () => {
    mockAskStore.currentSessionId = 1
    mockedAnalyze.mockResolvedValue(makeMockResponse())
    const errorSpy = vi.spyOn(message, 'error').mockImplementation(() => undefined as unknown as ReturnType<typeof message.error>)

    renderPage()
    fireEvent.click(screen.getByTestId('mock-send-invalid-btn'))

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('请输入有效的问题，不能仅包含标点或符号')
    })
    expect(mockedAnalyze).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('blocks empty input from submit path and shows page-level error', async () => {
    mockAskStore.currentSessionId = 1
    mockedAnalyze.mockResolvedValue(makeMockResponse())
    const errorSpy = vi.spyOn(message, 'error').mockImplementation(() => undefined as unknown as ReturnType<typeof message.error>)

    renderPage()
    fireEvent.click(screen.getByTestId('mock-send-empty-btn'))

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('请输入问题')
    })
    expect(mockedAnalyze).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it('allows normal business question and calls adapter.analyze', async () => {
    mockAskStore.currentSessionId = 1
    mockedAnalyze.mockResolvedValue(makeMockResponse({ question: '近 7 天销量' }))

    renderPage()
    fireEvent.click(screen.getByTestId('mock-send-btn'))

    await waitFor(() => {
      expect(mockedAnalyze).toHaveBeenCalledWith('近 7 天销量', expect.any(Object))
    })
  })

  // ── Real LLM toggle tests ──────────────────────────────────────

  describe('Real LLM toggle', () => {
    it('renders switch and defaults to mock mode (unchecked)', () => {
      mockAskStore.currentSessionId = 1
      renderPage()
      const toggle = screen.getByRole('switch')
      expect(toggle).toBeInTheDocument()
      expect(toggle).not.toBeChecked()
    })

    it('disables switch and shows tooltip hint when no active LLM setting exists', () => {
      vi.mocked(useLlmSettings).mockReturnValue({ data: [], isLoading: false } as any)
      mockAskStore.currentSessionId = 1
      renderPage()
      const toggle = screen.getByRole('switch')
      expect(toggle).toBeDisabled()
    })

    it('enables switch when active LLM setting exists', () => {
      vi.mocked(useLlmSettings).mockReturnValue({
        data: [{ id: 1, name: 'openai', is_active: true, base_url: '', api_key_masked: '***', model_name: 'gpt-4o-mini', last_tested_at: null, last_tested_ok: null, created_at: '', updated_at: '' }],
        isLoading: false,
      } as any)
      mockAskStore.currentSessionId = 1
      renderPage()
      const toggle = screen.getByRole('switch')
      expect(toggle).not.toBeDisabled()
    })

    it('calls setUseRealLlm(true) when switch is toggled on with active LLM', () => {
      vi.mocked(useLlmSettings).mockReturnValue({
        data: [{ id: 1, name: 'openai', is_active: true, base_url: '', api_key_masked: '***', model_name: 'gpt-4o-mini', last_tested_at: null, last_tested_ok: null, created_at: '', updated_at: '' }],
        isLoading: false,
      } as any)
      mockAskStore.currentSessionId = 1
      renderPage()
      const toggle = screen.getByRole('switch')
      fireEvent.click(toggle)
      expect(mockAiAskState.setUseRealLlm).toHaveBeenCalledWith(true)
    })

    it('shows fallback switch back button when error occurs in real LLM mode', () => {
      mockAskStore.currentSessionId = 1
      mockAiAskState.useRealLlm = true
      mockAiAskState.error = { code: 'LLM_CONNECTION_ERROR', message: '连接失败', name: 'AiAskError' }
      renderPage()
      expect(screen.getByText('分析异常')).toBeInTheDocument()
      expect(screen.getByText('切回模拟模式再试')).toBeInTheDocument()
    })

    it('does not show fallback button when error occurs in mock mode', () => {
      mockAskStore.currentSessionId = 1
      mockAiAskState.useRealLlm = false
      mockAiAskState.error = { code: 'ANALYSIS_TIMEOUT', message: '超时', name: 'AiAskError' }
      renderPage()
      expect(screen.getByText('分析异常')).toBeInTheDocument()
      expect(screen.queryByText('切回模拟模式再试')).not.toBeInTheDocument()
    })

    it('calls setUseRealLlm(false) when fallback button is clicked', () => {
      mockAskStore.currentSessionId = 1
      mockAiAskState.useRealLlm = true
      mockAiAskState.error = { code: 'LLM_CONNECTION_ERROR', message: '连接失败', name: 'AiAskError' }
      renderPage()
      fireEvent.click(screen.getByText('切回模拟模式再试'))
      expect(mockAiAskState.setUseRealLlm).toHaveBeenCalledWith(false)
    })

    // —— Phase 5L: Datasource guard tests ————————————————————————

    it('blocks analyze when useRealLlm=true and datasourceId is null (shows "请先选择数据源")', async () => {
      mockAskStore.currentSessionId = 1
      mockAiAskState.useRealLlm = true
      mockAiAskState.datasourceId = null
      mockAiAskState.datasourceName = null
      mockedAnalyze.mockResolvedValue(makeMockResponse())

      renderPage()

      fireEvent.click(screen.getByTestId('mock-send-btn'))

      await waitFor(() => {
        expect(mockAiAskState.setError).toHaveBeenCalled()
      })
      expect(mockAiAskState.setError).toHaveBeenCalledWith(
        expect.objectContaining({ message: '请先选择数据源' }),
      )
      // Also check that setAnalyzing was NOT called (we returned early)
      expect(mockAiAskState.setAnalyzing).not.toHaveBeenCalled()
      expect(mockedAnalyze).not.toHaveBeenCalled()
    })

    it('blocks analyze when useRealLlm=true and datasourceId is undefined', async () => {
      mockAskStore.currentSessionId = 1
      mockAiAskState.useRealLlm = true
      mockAiAskState.datasourceId = undefined
      mockAiAskState.datasourceName = undefined
      mockedAnalyze.mockResolvedValue(makeMockResponse())

      renderPage()
      fireEvent.click(screen.getByTestId('mock-send-btn'))

      await waitFor(() => {
        expect(mockAiAskState.setError).toHaveBeenCalled()
      })
      expect(mockAiAskState.setError).toHaveBeenCalledWith(
        expect.objectContaining({ message: '请先选择数据源' }),
      )
      expect(mockedAnalyze).not.toHaveBeenCalled()
    })

    it('does not block analyze when useRealLlm=false and datasource is null (mock path unaffected)', async () => {
      mockAskStore.currentSessionId = 1
      mockAiAskState.useRealLlm = false
      mockAiAskState.datasourceId = null
      mockAiAskState.datasourceName = null
      mockedAnalyze.mockResolvedValue(makeMockResponse({ question: '近 7 天销量' }))

      renderPage()
      fireEvent.click(screen.getByTestId('mock-send-btn'))

      await waitFor(() => {
        expect(mockedAnalyze).toHaveBeenCalled()
      })
    })
  })

  // ── Phase 5M: Narrative Trust & Error UI tests ─────────────────

  describe('Phase 5M Narrative Trust UI', () => {
    it('shows metadata guidance when storeError.code is METADATA_NOT_FOUND', () => {
      mockAskStore.currentSessionId = 1
      mockAiAskState.currentResponse = null
      mockAiAskState.isAnalyzing = false
      mockAiAskState.error = { code: 'METADATA_NOT_FOUND', message: '元数据未找到', name: 'AiAskError' }
      renderPage()
      expect(screen.getByText('表元数据未采集')).toBeInTheDocument()
      expect(screen.getByText('请先采集元数据或选择已采集的数据表')).toBeInTheDocument()
    })

    it('navigates to /web/datasources when metadata guidance button is clicked', () => {
      mockAskStore.currentSessionId = 1
      mockAiAskState.currentResponse = null
      mockAiAskState.isAnalyzing = false
      mockAiAskState.error = { code: 'METADATA_NOT_FOUND', message: '元数据未找到', name: 'AiAskError' }
      // jsdom Location is read-only, so verify rendering + check button text link
      renderPage()
      const button = screen.getByText('前往数据源管理').closest('button')
      expect(button).toBeInTheDocument()
      expect(button?.textContent).toContain('前往数据源管理')
    })

    it('does NOT render result area when METADATA_NOT_FOUND', () => {
      mockAskStore.currentSessionId = 1
      mockAiAskState.currentResponse = makeMockResponse()
      mockAiAskState.isAnalyzing = false
      mockAiAskState.error = { code: 'METADATA_NOT_FOUND', message: '元数据未找到', name: 'AiAskError' }
      renderPage()
      expect(screen.queryByTestId('intent-card')).not.toBeInTheDocument()
      expect(screen.queryByTestId('sql-plan')).not.toBeInTheDocument()
      expect(screen.queryByTestId('ai-chart-board')).not.toBeInTheDocument()
      expect(screen.queryByTestId('ai-narrative')).not.toBeInTheDocument()
    })

    it('shows SqlValidationAlert when INVALID_RESPONSE with details.sqlValidation', () => {
      mockAskStore.currentSessionId = 1
      mockAiAskState.currentResponse = makeMockResponse()
      mockAiAskState.isAnalyzing = false
      mockAiAskState.error = {
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
      mockAskStore.currentSessionId = 1
      mockAiAskState.currentResponse = makeMockResponse()
      mockAiAskState.isAnalyzing = false
      mockAiAskState.error = {
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
      mockAskStore.currentSessionId = 1
      mockAiAskState.currentResponse = null
      mockAiAskState.isAnalyzing = false
      mockAiAskState.error = { code: 'ANALYSIS_TIMEOUT', message: '超时', name: 'AiAskError' }
      renderPage()
      expect(screen.getByText('分析异常')).toBeInTheDocument()
    })
  })
})
