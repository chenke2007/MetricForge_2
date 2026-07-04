import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import AskWorkbenchPage from './AskWorkbenchPage'
import { MOCK_ASK_RESPONSE } from '../api/aiAsk.mock'

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
  activeChartIndex: 0,
  responseHistory: {},
  setDatasource: vi.fn(),
  setSelectedTables: vi.fn(),
  setCurrentResponse: vi.fn(),
  setAnalyzing: vi.fn(),
  setActiveChart: vi.fn(),
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
      activeChartIndex: 0,
      responseHistory: {},
      setDatasource: vi.fn(),
      setSelectedTables: vi.fn(),
      setCurrentResponse: vi.fn(),
      setAnalyzing: vi.fn(),
      setActiveChart: vi.fn(),
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
    mockAiAskState.currentResponse = MOCK_ASK_RESPONSE
    mockAiAskState.isAnalyzing = false
    renderPage()
    expect(screen.getByTestId('intent-card')).toBeInTheDocument()
    expect(screen.getByTestId('sql-plan')).toBeInTheDocument()
    expect(screen.getByTestId('ai-chart-board')).toBeInTheDocument()
    expect(screen.getByTestId('ai-narrative')).toBeInTheDocument()
  })

  it('shows analyzing spinner when isAnalyzing is true', () => {
    mockAskStore.currentSessionId = 1
    mockAiAskState.currentResponse = null
    mockAiAskState.isAnalyzing = true
    renderPage()
    expect(screen.getByText('正在分析你的问题...')).toBeInTheDocument()
  })
})
