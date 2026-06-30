import React from 'react'
import { Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { GovernanceTicketItem } from '../api/governance'

interface GovernanceListProps {
  items: GovernanceTicketItem[]
  pagination: { page: number; total: number; total_pages: number }
  loading: boolean
  pageSize: number
  onPageChange: (page: number, pageSize: number) => void
  onSelect: (ticketId: number) => void
}

// Color/icon config per ticket type
const typeConfig: Record<string, { color: string }> = {
  missing_semantic: { color: 'orange' },
  metadata_table_deactivated: { color: 'red' },
  metadata_column_deactivated: { color: 'red' },
  metadata_column_type_changed: { color: 'blue' },
  metadata_column_comment_changed: { color: 'geekblue' },
}

const typeLabels: Record<string, string> = {
  missing_semantic: '缺失语义',
  metadata_table_deactivated: '表停用',
  metadata_column_deactivated: '字段停用',
  metadata_column_type_changed: '字段类型变更',
  metadata_column_comment_changed: '字段备注变更',
}

const statusLabels: Record<string, string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  closed: '已关闭',
}

const priorityColors: Record<string, string> = {
  high: 'red',
  medium: 'orange',
  low: 'green',
}

const columns: ColumnsType<GovernanceTicketItem> = [
  {
    title: 'ID',
    dataIndex: 'id',
    key: 'id',
    width: 60,
  },
  {
    title: '标题',
    dataIndex: 'title',
    key: 'title',
    ellipsis: true,
  },
  {
    title: '类型',
    dataIndex: 'ticket_type',
    key: 'ticket_type',
    width: 100,
    render: (type: string) => (
      <Tag color={typeConfig[type]?.color}>{typeLabels[type] || type}</Tag>
    ),
  },
  {
    title: '优先级',
    dataIndex: 'priority',
    key: 'priority',
    width: 80,
    render: (priority: string) => (
      <Tag color={priorityColors[priority]}>{priority}</Tag>
    ),
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 80,
    render: (status: string) => statusLabels[status] || status,
  },
  {
    title: '来源',
    dataIndex: 'source',
    key: 'source',
    width: 120,
    render: (source: string) => {
      const labels: Record<string, string> = {
        auto_detect: '自动检测',
        metadata_change_detected: '变更检测',
      }
      return labels[source] || source
    },
  },
  {
    title: '创建时间',
    dataIndex: 'created_at',
    key: 'created_at',
    width: 160,
    render: (date: string) => new Date(date).toLocaleString('zh-CN'),
  },
]

const GovernanceList: React.FC<GovernanceListProps> = ({
  items,
  pagination,
  loading,
  pageSize,
  onPageChange,
  onSelect,
}) => {
  return (
    <Table<GovernanceTicketItem>
      columns={columns}
      dataSource={items}
      rowKey="id"
      size="small"
      loading={loading}
      pagination={{
        current: pagination.page,
        pageSize,
        total: pagination.total,
        showTotal: (total) => `共 ${total} 条`,
        onChange: onPageChange,
      }}
      onRow={(record) => ({
        onClick: () => onSelect(record.id),
        style: { cursor: 'pointer' },
      })}
      locale={{ emptyText: '暂无数据' }}
    />
  )
}

export default GovernanceList
