import React from 'react'
import { Select, Button, Space } from 'antd'
import type { GovernanceFilters } from '../api/governance'

interface GovernanceFilterBarProps {
  values: { status?: string; ticket_type?: string; source?: string }
  onChange: (values: GovernanceFilters) => void
  onReset: () => void
}

const statusOptions = [
  { value: 'open', label: '待处理' },
  { value: 'in_progress', label: '处理中' },
  { value: 'resolved', label: '已解决' },
  { value: 'closed', label: '已关闭' },
]

const typeOptions = [
  { value: 'missing_semantic', label: '缺失语义' },
  { value: 'metadata_table_deactivated', label: '表停用' },
  { value: 'metadata_column_deactivated', label: '字段停用' },
  { value: 'metadata_column_type_changed', label: '字段类型变更' },
  { value: 'metadata_column_comment_changed', label: '字段备注变更' },
]

const sourceOptions = [
  { value: 'auto_detect', label: '自动检测' },
  { value: 'metadata_change_detected', label: '变更检测' },
]

const GovernanceFilterBar: React.FC<GovernanceFilterBarProps> = ({ values, onChange, onReset }) => {
  const handleChange = (key: keyof GovernanceFilters) => (value: string | undefined) => {
    onChange({ ...values, [key]: value || undefined })
  }

  return (
    <Space wrap style={{ marginBottom: 16 }}>
      <Select
        allowClear
        placeholder="状态"
        aria-label="状态"
        style={{ width: 120 }}
        value={values.status}
        options={statusOptions}
        onChange={handleChange('status')}
      />
      <Select
        allowClear
        placeholder="来源"
        aria-label="来源"
        style={{ width: 140 }}
        value={values.source}
        options={sourceOptions}
        onChange={handleChange('source')}
      />
      <Select
        allowClear
        placeholder="类型"
        aria-label="类型"
        style={{ width: 140 }}
        value={values.ticket_type}
        options={typeOptions}
        onChange={handleChange('ticket_type')}
      />
      <Button onClick={onReset}>重置筛选</Button>
    </Space>
  )
}

export default GovernanceFilterBar
