import React from 'react'
import { Tag, Space } from 'antd'
import {
  ClockCircleOutlined,
  TableOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'

const ResultToolbar: React.FC = () => {
  const result = useSqlWorkbenchStore((s) => s.result)

  if (!result) return null

  if (result.error) {
    return (
      <div style={{ padding: '4px 0' }}>
        <Tag color="error" icon={<WarningOutlined />}>
          {result.error}
        </Tag>
      </div>
    )
  }

  return (
    <div style={{ padding: '4px 0' }}>
      <Space size="middle">
        <Tag icon={<TableOutlined />} color="blue">
          {result.row_count} 行
        </Tag>
        <Tag icon={<ClockCircleOutlined />}>
          {result.elapsed_ms}ms
        </Tag>
        {result.truncated && (
          <Tag color="warning" icon={<WarningOutlined />}>
            已截断（最大 1000 行）
          </Tag>
        )}
      </Space>
    </div>
  )
}

export default ResultToolbar
