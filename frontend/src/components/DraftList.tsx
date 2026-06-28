import React from 'react'
import { List, Button, Spin, Empty, Typography, Popconfirm } from 'antd'
import { DeleteOutlined, EditOutlined } from '@ant-design/icons'
import { useSqlDrafts, useDeleteDraft } from '../api/sqlWorkbench'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'
import DraftFormModal from './DraftFormModal'

const DraftList: React.FC = () => {
  const setSql = useSqlWorkbenchStore((s) => s.setSql)
  const [modalOpen, setModalOpen] = React.useState(false)
  const [editingDraft, setEditingDraft] = React.useState<any>(null)

  const { data: drafts, isLoading } = useSqlDrafts()
  const deleteMutation = useDeleteDraft()

  if (isLoading) return <Spin style={{ display: 'block', margin: '24px auto' }} />
  if (!drafts || drafts.length === 0) return <Empty description="暂无草稿" />

  return (
    <>
      <List
        size="small"
        dataSource={drafts}
        renderItem={(draft) => (
          <List.Item
            actions={[
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  setEditingDraft(draft)
                  setModalOpen(true)
                }}
              />,
              <Popconfirm
                title="确定删除此草稿？"
                onConfirm={() => deleteMutation.mutate(draft.id)}
              >
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              title={
                <Typography.Text
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSql(draft.sql_text)}
                >
                  {draft.title || '未命名查询'}
                </Typography.Text>
              }
              description={
                <Typography.Text code ellipsis style={{ maxWidth: 300 }}>
                  {draft.sql_text.substring(0, 100)}
                </Typography.Text>
              }
            />
          </List.Item>
        )}
      />
      <DraftFormModal
        open={modalOpen}
        draft={editingDraft}
        onClose={() => {
          setModalOpen(false)
          setEditingDraft(null)
        }}
      />
    </>
  )
}

export default DraftList
