import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import MessageThread from './MessageThread'
import type { AskMessage } from '../api/askSessions'

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
