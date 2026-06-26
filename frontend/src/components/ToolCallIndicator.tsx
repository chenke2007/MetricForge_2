import React from 'react'
import { Space, Tag, Tooltip } from 'antd'
import type { ToolCallRecord } from '../api/askSessions'

interface ToolCallIndicatorProps {
  tool_calls: ToolCallRecord[]
}

const ToolCallIndicator: React.FC<ToolCallIndicatorProps> = ({ tool_calls }) => {
  if (!tool_calls || tool_calls.length === 0) return null

  return (
    <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>
      <Space size="small">
        <span>已调用工具：</span>
        {tool_calls.map((tc) => (
          <Tooltip key={tc.id} title={tc.status === 'error' ? tc.error_message || '执行失败' : '执行成功'}>
            <Tag color={tc.status === 'success' ? 'green' : 'red'}>
              {tc.tool_name}
            </Tag>
          </Tooltip>
        ))}
      </Space>
    </div>
  )
}

export default ToolCallIndicator
