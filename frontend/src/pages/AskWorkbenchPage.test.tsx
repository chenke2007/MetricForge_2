import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AskWorkbenchPage from './AskWorkbenchPage'

const mockStore = {
  currentSessionId: null as number | null,
  setCurrentSession: vi.fn(),
  startStream: vi.fn(),
  appendToken: vi.fn(),
  stopStream: vi.fn(),
}

vi.mock('../stores/askStore', () => ({
  useAskStore: vi.fn((selector?: (s: typeof mockStore) => any) => {
    if (selector) {
      return selector(mockStore)
    }
    return mockStore
  }),
}))

vi.mock('../api/askSessions', () => ({
  useAskMessages: vi.fn(() => ({ data: [], isLoading: false })),
  useCreateMessage: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}))

vi.mock('../components/SessionList', () => ({
  default: () => <div data-testid="session-list">SessionList</div>,
}))

vi.mock('../components/MessageThread', () => ({
  default: () => <div data-testid="message-thread">MessageThread</div>,
}))

vi.mock('../components/AskInput', () => ({
  default: () => <div data-testid="ask-input">AskInput</div>,
}))

vi.mock('../components/ToolCallIndicator', () => ({
  default: () => <div data-testid="tool-call-indicator">ToolCallIndicator</div>,
}))

// Mock AgentNav to keep tests focused on page integration
vi.mock('../components/AgentNav', () => ({
  default: () => <div data-testid="agent-nav">AgentNav</div>,
  AGENTS: [
    { key: 'ask', label: 'AI 问数', enabled: true, badge: '可用' },
    { key: 'insight', label: 'AI 解读', enabled: false, badge: '规划中' },
    { key: 'report', label: 'AI 报告', enabled: false, badge: '规划中' },
    { key: 'build', label: 'AI 搭建', enabled: false, badge: '规划中' },
    { key: 'explore', label: 'AI 洞察', enabled: false, badge: '规划中' },
  ],
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('AskWorkbenchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.currentSessionId = null
  })

  it('renders without crashing and shows empty state when no session selected', () => {
    render(<AskWorkbenchPage />, { wrapper: createWrapper() })
    expect(screen.getByTestId('session-list')).toBeInTheDocument()
    expect(screen.getByText('选择或创建一个对话开始提问')).toBeInTheDocument()
  })

  it('renders AgentNav component for agent capabilities', () => {
    render(<AskWorkbenchPage />, { wrapper: createWrapper() })
    expect(screen.getByTestId('agent-nav')).toBeInTheDocument()
  })
})
