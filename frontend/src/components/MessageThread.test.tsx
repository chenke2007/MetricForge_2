import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MessageThread from './MessageThread'
import type { AskMessage } from '../api/askSessions'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('../stores/askStore', () => ({
  useAskStore: () => ({ streaming: null }),
}))

const createAssistantMessage = (content: string): AskMessage => ({
  id: 1,
  role: 'assistant',
  content,
  status: 'completed',
  session_id: 1,
  created_at: '2026-06-28T00:00:00Z',
  tokens_prompt: null,
  tokens_completion: null,
  error_message: null,
})

describe('MessageThread SQL code block integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders SQL code block with open-in-workbench button', () => {
    const content = '```sql\n-- datasource_id: 2\nSELECT * FROM DW_CONTRACT\n```'
    render(<MessageThread messages={[createAssistantMessage(content)]} />)
    expect(screen.getByTestId('open-in-workbench-btn')).toBeInTheDocument()
  })

  it('navigates to workbench with stripped SQL on button click', async () => {
    const content = '```sql\n-- datasource_id: 2\nSELECT * FROM DW_CONTRACT\n```'
    render(<MessageThread messages={[createAssistantMessage(content)]} />)
    fireEvent.click(screen.getByTestId('open-in-workbench-btn'))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled()
    })

    const url = mockNavigate.mock.calls[0][0]
    expect(url).toContain('datasource_id=2')
    expect(url).toContain('sql=SELECT+*+FROM+DW_CONTRACT')
    expect(url).not.toContain('datasource_id:')
  })

  it('does not render button for non-SQL code block', () => {
    const content = '```python\nprint("hello")\n```'
    render(<MessageThread messages={[createAssistantMessage(content)]} />)
    expect(screen.queryByTestId('open-in-workbench-btn')).not.toBeInTheDocument()
  })

  it('handles SQL code block without datasource_id comment', async () => {
    const content = '```sql\nSELECT * FROM DW_CONTRACT\n```'
    render(<MessageThread messages={[createAssistantMessage(content)]} />)
    fireEvent.click(screen.getByTestId('open-in-workbench-btn'))

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled()
    })

    const url = mockNavigate.mock.calls[0][0]
    expect(url).toContain('sql=SELECT+*+FROM+DW_CONTRACT')
    expect(url).not.toContain('datasource_id=')
  })
})

describe('MessageThread', () => {
  it('renders ToolCallIndicator for assistant messages with tool_calls', () => {
    const messages: AskMessage[] = [
      {
        id: 1,
        session_id: 1,
        role: 'assistant',
        content: '有 2 个数据源',
        status: 'completed',
        created_at: '',
        tool_calls: [
          { id: 1, message_id: 1, tool_name: 'datasource_stats', arguments: '{}', result: '{}', status: 'success', error_message: null, created_at: '' },
        ],
      },
    ]
    render(<MessageThread messages={messages} />)
    expect(screen.getByText('datasource_stats')).toBeInTheDocument()
  })
})
