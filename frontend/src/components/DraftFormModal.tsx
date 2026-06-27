import React, { useEffect } from 'react'
import { Modal, Form, Input } from 'antd'
import { useCreateDraft, useUpdateDraft, SqlDraft } from '../api/sqlWorkbench'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'

interface DraftFormModalProps {
  open: boolean
  draft?: SqlDraft | null
  onClose: () => void
}

const DraftFormModal: React.FC<DraftFormModalProps> = ({ open, draft, onClose }) => {
  const [form] = Form.useForm()
  const createMutation = useCreateDraft()
  const updateMutation = useUpdateDraft()
  const sql = useSqlWorkbenchStore((s) => s.sql)
  const datasourceId = useSqlWorkbenchStore((s) => s.datasourceId)

  useEffect(() => {
    if (open) {
      if (draft) {
        form.setFieldsValue({
          title: draft.title,
          description: draft.description,
        })
      } else {
        form.setFieldsValue({
          title: '',
          description: '',
        })
      }
    }
  }, [open, draft, form])

  const handleOk = async () => {
    const values = await form.validateFields()
    if (draft) {
      await updateMutation.mutateAsync({
        id: draft.id,
        ...values,
      })
    } else {
      await createMutation.mutateAsync({
        ...values,
        sql_text: sql,
        datasource_id: datasourceId,
      })
    }
    onClose()
  }

  return (
    <Modal
      title={draft ? '编辑草稿' : '保存草稿'}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={createMutation.isPending || updateMutation.isPending}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="title"
          label="标题"
          rules={[{ max: 200 }]}
        >
          <Input placeholder="留空将自动生成" />
        </Form.Item>
        <Form.Item
          name="description"
          label="描述"
        >
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default DraftFormModal
