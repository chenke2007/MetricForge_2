import React from 'react'
import { Drawer, Descriptions, Tag, Button, Space, Spin, Result, Input, message, Typography } from 'antd'
import { useGovernanceTicket } from '../hooks/useGovernanceTicket'
import { useUpdateTicketStatus, useAssignTicket } from '../hooks/useUpdateTicketStatus'
import SemanticEditForm from './SemanticEditForm'
import type { SaveSemanticResponse, ApiErrorLike } from '../api/governance'

interface GovernanceDetailDrawerProps {
  open: boolean
  ticketId: number | null
  onClose: () => void
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

type DrawerMode = 'detail' | 'edit'

const GovernanceDetailDrawer: React.FC<GovernanceDetailDrawerProps> = ({ open, ticketId, onClose }) => {
  const { data, isLoading, isError, error, refetch } = useGovernanceTicket(ticketId)
  const { mutateAsync: updateStatus, isPending: isUpdatingStatus } = useUpdateTicketStatus()
  const { mutateAsync: assign, isPending: isAssigning } = useAssignTicket()

  const [mode, setMode] = React.useState<DrawerMode>('detail')
  const [assigneeInput, setAssigneeInput] = React.useState('')
  const [showAssignInput, setShowAssignInput] = React.useState(false)

  // Reset mode when ticket changes
  React.useEffect(() => {
    setMode('detail')
    setShowAssignInput(false)
    setAssigneeInput('')
  }, [ticketId])

  // 404 auto-close: close drawer after 3s when ticket not found
  React.useEffect(() => {
    if (isError && (error as ApiErrorLike)?.status === 404) {
      const timer = setTimeout(() => onClose(), 3000)
      return () => clearTimeout(timer)
    }
  }, [isError, error, onClose])

  const canEditSemantic = data?.ticket_type === 'missing_semantic'
    && (data?.status === 'open' || data?.status === 'in_progress')
    && data?.field_context != null

  const handleStatusChange = async (newStatus: string) => {
    if (!ticketId) return
    try {
      await updateStatus({ ticketId, status: newStatus })
      message.success(`状态已更新为 ${statusLabels[newStatus] || newStatus}`)
    } catch {
      message.error('操作失败')
    }
  }

  const handleAssign = async () => {
    if (!ticketId || !assigneeInput.trim()) return
    try {
      await assign({ ticketId, assignee: assigneeInput.trim() })
      message.success(`已分配给 ${assigneeInput.trim()}`)
      setShowAssignInput(false)
      setAssigneeInput('')
    } catch {
      message.error('分配失败')
    }
  }

  const handleSemanticSaved = (response: SaveSemanticResponse) => {
    const msg = response.closed_tickets > 0
      ? `字段语义已保存（关闭 ${response.closed_tickets} 个关联待办）`
      : '字段语义已保存'
    message.success(msg)
    setMode('detail')
    refetch()
  }

  const renderDetail = () => {
    if (!data) return null

    const fullFieldName = data.field_context
      ? `${data.field_context.schema_name}.${data.field_context.table_name}.${data.field_context.column_name}`
      : null

    return (
      <div>
        {/* Ticket info */}
        <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
          <Descriptions.Item label="标题">{data.title}</Descriptions.Item>
          <Descriptions.Item label="来源">
            {data.source === 'auto_detect' ? '自动检测' :
             data.source === 'metadata_change_detected' ? '变更检测' : data.source}
          </Descriptions.Item>
          <Descriptions.Item label="状态">{statusLabels[data.status] || data.status}</Descriptions.Item>
          <Descriptions.Item label="优先级">
            <Tag color={priorityColors[data.priority]}>{data.priority}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="负责人">{data.assignee || '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {new Date(data.created_at).toLocaleString('zh-CN')}
          </Descriptions.Item>
        </Descriptions>

        {/* Field context (only for column-related tickets) */}
        {data.field_context && (
          <>
            <Typography.Text strong>关联字段</Typography.Text>
            <Descriptions size="small" column={1} style={{ marginTop: 8, marginBottom: 16 }}>
              <Descriptions.Item label="字段名">{fullFieldName}</Descriptions.Item>
              <Descriptions.Item label="类型">{data.field_context.column_type}</Descriptions.Item>
              <Descriptions.Item label="备注">{data.field_context.comment || '-'}</Descriptions.Item>
            </Descriptions>
          </>
        )}

        {/* Field context null warning */}
        {!data.field_context && (
          <Typography.Text type="warning" style={{ display: 'block', marginBottom: 16 }}>
            关联字段可能已被删除
          </Typography.Text>
        )}

        {/* Edit semantic button */}
        {canEditSemantic && (
          <Button type="primary" onClick={() => setMode('edit')} style={{ marginBottom: 16 }}>
            编辑字段语义
          </Button>
        )}

        {/* Action buttons */}
        <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>操作</Typography.Text>
          <Space wrap>
            {data.status === 'open' && (
              <Button
                size="small"
                loading={isUpdatingStatus}
                onClick={() => handleStatusChange('in_progress')}
              >
                标记处理中
              </Button>
            )}
            {data.status === 'in_progress' && (
              <Button
                size="small"
                loading={isUpdatingStatus}
                onClick={() => handleStatusChange('open')}
              >
                重新开启
              </Button>
            )}
            {(data.status === 'open' || data.status === 'in_progress') && (
              <Button
                size="small"
                loading={isUpdatingStatus}
                onClick={() => handleStatusChange('closed')}
              >
                关闭
              </Button>
            )}
            {!showAssignInput ? (
              <Button size="small" onClick={() => setShowAssignInput(true)}>
                分配
              </Button>
            ) : (
              <Space>
                <Input
                  size="small"
                  placeholder="输入负责人"
                  value={assigneeInput}
                  onChange={(e) => setAssigneeInput(e.target.value)}
                  style={{ width: 150 }}
                />
                <Button size="small" type="primary" loading={isAssigning} onClick={handleAssign}>
                  确认
                </Button>
                <Button size="small" onClick={() => setShowAssignInput(false)}>
                  取消
                </Button>
              </Space>
            )}
          </Space>
        </div>
      </div>
    )
  }

  const renderEdit = () => {
    if (!data?.field_context) return null

    return (
      <div>
        <Button type="link" onClick={() => setMode('detail')} style={{ padding: 0, marginBottom: 16 }}>
          ← 返回详情
        </Button>
        <Typography.Title level={5}>编辑字段语义</Typography.Title>
        <SemanticEditForm
          fieldContext={data.field_context}
          existingSemantic={data.field_semantic}
          onSaved={handleSemanticSaved}
          onCancel={() => setMode('detail')}
        />
      </div>
    )
  }

  // Drawer title
  const title = data
    ? (mode === 'edit' ? `编辑语义 - #${data.id}` : `待办 #${data.id}`)
    : '待办详情'

  // Loading state
  if (isLoading) {
    return (
      <Drawer open={open} onClose={onClose} width={480} title={title}>
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin spinning={true} tip="加载中...">
            <div style={{ height: 200 }} />
          </Spin>
        </div>
      </Drawer>
    )
  }

  // Error state
  if (isError) {
    const is404 = (error as ApiErrorLike)?.status === 404
    return (
      <Drawer open={open} onClose={onClose} width={480} title={title}>
        <Result
          status={is404 ? '404' : 'error'}
          title={is404 ? '待办不存在' : '加载失败'}
          subTitle={is404 ? '该治理待办可能已被删除' : '无法加载待办详情，请重试'}
          extra={<Button onClick={() => refetch()}>重试</Button>}
        />
      </Drawer>
    )
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={480}
      title={title}
    >
      {mode === 'edit' ? renderEdit() : renderDetail()}
    </Drawer>
  )
}

export default GovernanceDetailDrawer
