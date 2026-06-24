import React from 'react'
import { Table, Tag, Card, Statistic, Row, Col, Spin, Alert, Typography } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, SyncOutlined, ClockCircleOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useMetadataJobs } from '../api/metadataJobs'
import type { MetadataCollectionJob } from '../api/metadataJobs'

const statusConfig: Record<string, { color: string; icon: React.ReactNode }> = {
  success: { color: 'success', icon: <CheckCircleOutlined /> },
  failed: { color: 'error', icon: <CloseCircleOutlined /> },
  partial_success: { color: 'warning', icon: <ClockCircleOutlined /> },
  running: { color: 'processing', icon: <SyncOutlined /> },
}

const columns: ColumnsType<MetadataCollectionJob> = [
  {
    title: 'ID',
    dataIndex: 'id',
    key: 'id',
    width: 60,
    render: (id: number) => <Typography.Text code>#{id}</Typography.Text>,
  },
  {
    title: '数据源',
    dataIndex: 'datasource_name',
    key: 'datasource_name',
    render: (name: string | undefined, record: MetadataCollectionJob) =>
      name || `数据源 #${record.datasource_id}`,
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 130,
    render: (status: string) => {
      const cfg = statusConfig[status]
      return cfg ? (
        <Tag icon={cfg.icon} color={cfg.color}>
          {status}
        </Tag>
      ) : (
        <Tag>{status}</Tag>
      )
    },
  },
  {
    title: '触发',
    dataIndex: 'triggered_by',
    key: 'triggered_by',
    width: 100,
  },
  {
    title: '表/字段',
    key: 'tables_columns',
    width: 90,
    render: (_: unknown, record: MetadataCollectionJob) =>
      `${record.tables_count} / ${record.columns_count}`,
  },
  {
    title: '变更',
    key: 'changes',
    width: 80,
    render: (_: unknown, record: MetadataCollectionJob) =>
      (record.tables_added_count || 0) +
      (record.tables_deactivated_count || 0) +
      (record.columns_added_count || 0) +
      (record.columns_deactivated_count || 0) +
      (record.columns_type_changed_count || 0) +
      (record.columns_comment_changed_count || 0),
  },
  {
    title: '治理待办',
    dataIndex: 'governance_tickets_created_count',
    key: 'governance_tickets_created_count',
    width: 90,
    render: (count: number) => (count > 0 ? <Tag color="blue">{count}</Tag> : count),
  },
  {
    title: '错误',
    dataIndex: 'error_message',
    key: 'error_message',
    ellipsis: true,
  },
  {
    title: '开始时间',
    dataIndex: 'started_at',
    key: 'started_at',
    width: 160,
    render: (date: string | null) => (date ? new Date(date).toLocaleString('zh-CN') : '-'),
  },
]

const MetadataJobsPage: React.FC = () => {
  const { data: jobs, isLoading, error } = useMetadataJobs()

  if (isLoading) {
    return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />
  }

  if (error) {
    return (
      <Alert
        message="加载失败"
        description={(error as { message?: string })?.message || '无法获取采集任务列表'}
        type="error"
        showIcon
      />
    )
  }

  const successCount = jobs?.filter((j) => j.status === 'success').length ?? 0
  const failedCount = jobs?.filter((j) => j.status === 'failed' || j.status === 'partial_success').length ?? 0

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        元数据采集任务
      </Typography.Title>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="任务总数" value={jobs?.length ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="成功"
              value={successCount}
              valueStyle={{ color: '#52c41a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="失败/异常"
              value={failedCount}
              valueStyle={{ color: '#ff4d4f' }}
              prefix={<CloseCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="总治理待办" value={jobs?.reduce((s, j) => s + (j.governance_tickets_created_count || 0), 0) ?? 0} />
          </Card>
        </Col>
      </Row>

      <Table
        columns={columns}
        dataSource={jobs}
        rowKey="id"
        size="small"
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
      />
    </div>
  )
}

export default MetadataJobsPage
