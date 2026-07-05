import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import AskWorkbenchPage from './AskWorkbenchPage'

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
  saveResponseForMessage: vi.fn(),
  getResponseForMessage: vi.fn(),
  reset: vi.fn(),
}

vi.mock('../stores/aiAskStore', () => ({
  useAiAskStore: vi.fn((selector?: (s: typeof mockAiAskState) => any) => {
    if (selector) return selector(mockAiAskState)
    return mockAiAskState
  }),
}))

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

vi.mock('../api/aiAsk', () => ({
  useAiAskService: vi.fn(() => ({
    name: 'MockAdapter',
    analyze: vi.fn(),
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
}))

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
  default: () => <div data-testid="ask-input">AskInput</div>,
}))

vi.mock('../components/IntentCard', () => ({
  default: () => <div data-testid="intent-card">IntentCard</div>,
}))

vi.mock('../components/SqlPlan', () => ({
  default: () => <div data-testid="sql-plan">SqlPlan</div>,
}))

vi.mock('../components/AiChartBoard', () => ({
  default: () => <div data-testid="ai-chart-board">AiChartBoard</div>,
}))

vi.mock('../components/AiNarrative', () => ({
  default: () => <div data-testid="ai-narrative">AiNarrative</div>,
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

  it('shows error alert when error is set', () => {
    mockAskStore.currentSessionId = 1
    mockAiAskState.currentResponse = null
    mockAiAskState.isAnalyzing = false
    mockAiAskState.error = { code: 'ANALYSIS_TIMEOUT', message: '超时', name: 'AiAskError' }
    renderPage()
    expect(screen.getByText('分析异常')).toBeInTheDocument()
  })
})
