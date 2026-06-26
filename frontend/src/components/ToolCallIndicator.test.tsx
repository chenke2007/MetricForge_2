import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ToolCallIndicator from './ToolCallIndicator'
import type { ToolCallRecord } from '../api/askSessions'

describe('ToolCallIndicator', () => {
  it('renders tool names', () => {
    const calls: ToolCallRecord[] = [
      { id: 1, message_id: 1, tool_name: 'datasource_stats', arguments: '{}', result: '{}', status: 'success', error_message: null, created_at: '' },
    ]
    render(<ToolCallIndicator tool_calls={calls} />)
    expect(screen.getByText('datasource_stats')).toBeInTheDocument()
  })
})
