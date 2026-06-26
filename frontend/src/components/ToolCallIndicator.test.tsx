import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ToolCallIndicator from './ToolCallIndicator'
import type { ToolCallRecord } from '../api/askSessions'

describe('ToolCallIndicator', () => {
  it('renders tool names for success status', () => {
    const calls: ToolCallRecord[] = [
      { id: 1, message_id: 1, tool_name: 'datasource_stats', arguments: '{}', result: '{}', status: 'success', error_message: null, created_at: '' },
    ]
    render(<ToolCallIndicator tool_calls={calls} />)
    expect(screen.getByText('datasource_stats')).toBeInTheDocument()
    // Success: green tag class
    const tag = screen.getByText('datasource_stats').closest('span')
    expect(tag?.className).toContain('ant-tag-green')
  })

  it('renders error status with red tag', () => {
    const calls: ToolCallRecord[] = [
      { id: 1, message_id: 1, tool_name: 'datasource_stats', arguments: '{}', result: null, status: 'error', error_message: 'Connection timeout', created_at: '' },
    ]
    render(<ToolCallIndicator tool_calls={calls} />)
    expect(screen.getByText('datasource_stats')).toBeInTheDocument()
    const tag = screen.getByText('datasource_stats').closest('span')
    expect(tag?.className).toContain('ant-tag-red')
  })

  it('renders error status with fallback when error_message is null', () => {
    const calls: ToolCallRecord[] = [
      { id: 1, message_id: 1, tool_name: 'datasource_stats', arguments: '{}', result: null, status: 'error', error_message: null, created_at: '' },
    ]
    render(<ToolCallIndicator tool_calls={calls} />)
    expect(screen.getByText('datasource_stats')).toBeInTheDocument()
    const tag = screen.getByText('datasource_stats').closest('span')
    expect(tag?.className).toContain('ant-tag-red')
  })

  it('returns null for empty tool_calls array', () => {
    const { container } = render(<ToolCallIndicator tool_calls={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('returns null for null tool_calls', () => {
    const { container } = render(<ToolCallIndicator tool_calls={null as unknown as ToolCallRecord[]} />)
    expect(container.firstChild).toBeNull()
  })
})
