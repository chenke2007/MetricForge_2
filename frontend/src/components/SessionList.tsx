import React from 'react'
import { List, Button, Popconfirm, Typography, Space } from 'antd'
import {
  DeleteOutlined,
  PlusOutlined,
  MessageOutlined,
} from '@ant-design/icons'
import { useAskSessions, useCreateSession, useDeleteSession } from '../api/askSessions'
import type { AskSession } from '../api/askSessions'

interface SessionListProps {
  currentId: number | null
  onSelect: (id: number | null) => void
}

const SessionList: React.FC<SessionListProps> = ({ currentId, onSelect }) => {
  const { data: sessions, isLoading } = useAskSessions()
  const createSession = useCreateSession()
  const deleteSession = useDeleteSession()

  const handleCreate = () => {
    createSession.mutate(undefined, {
      onSuccess: (session) => {
        onSelect(session.id)
      },
    })
  }

  const handleDelete = (sessionId: number) => {
    deleteSession.mutate(sessionId, {
      onSuccess: () => {
        if (currentId === sessionId) {
          onSelect(null)
        }
      },
    })
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 12px 0' }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          block
          onClick={handleCreate}
          loading={createSession.isPending}
        >
          新建对话
        </Button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', marginTop: 8 }}>
        <List
          size="small"
          loading={isLoading}
          dataSource={sessions ?? []}
          locale={{ emptyText: '暂无对话' }}
          renderItem={(item: AskSession) => (
            <List.Item
              onClick={() => onSelect(item.id)}
              style={{
                cursor: 'pointer',
                padding: '10px 12px',
                background: currentId === item.id ? '#e6f4ff' : undefined,
                borderRadius: 4,
                margin: '2px 6px',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                if (currentId !== item.id) {
                  e.currentTarget.style.background = '#f5f5f5'
                }
              }}
              onMouseLeave={(e) => {
                if (currentId !== item.id) {
                  e.currentTarget.style.background = 'transparent'
                }
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <Space>
                  <MessageOutlined style={{ fontSize: 12, color: '#999' }} />
                  <Typography.Text
                    ellipsis
                    style={{ fontSize: 13, maxWidth: 140 }}
                  >
                    {item.title || '新对话'}
                  </Typography.Text>
                </Space>
                <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>
                  {new Date(item.created_at).toLocaleDateString('zh-CN')}
                </div>
              </div>
              <Popconfirm
                title="确定删除此对话？"
                onConfirm={() => handleDelete(item.id)}
                okText="确定"
                cancelText="取消"
              >
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  danger
                  onClick={(e) => e.stopPropagation()}
                />
              </Popconfirm>
            </List.Item>
          )}
        />
      </div>
    </div>
  )
}

export default SessionList
