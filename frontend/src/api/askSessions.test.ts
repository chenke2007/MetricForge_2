import { describe, it, expect } from 'vitest'
import type { AskMessage } from './askSessions'

describe('AskMessage type', () => {
  it('accepts tool_calls', () => {
    const msg: AskMessage = {
      id: 1,
      session_id: 1,
      role: 'assistant',
      content: 'hi',
      status: 'completed',
      created_at: '2024-01-01T00:00:00Z',
      tool_calls: [
        { id: 1, message_id: 1, tool_name: 'datasource_stats', arguments: '{}', result: '{}', status: 'success', error_message: null, created_at: '2024-01-01T00:00:00Z' },
      ],
    }
    expect(msg.tool_calls).toHaveLength(1)
  })
})
