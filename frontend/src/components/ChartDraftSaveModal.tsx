import React, { useEffect } from 'react'
import { Modal, Form, Input, message } from 'antd'
import { useCreateChartDraft } from '../api/chartDrafts'
import type { ChartConfig } from '../stores/sqlWorkbenchStore'

interface ChartDraftSaveModalProps {
  open: boolean
  onClose: () => void
  sql: string
  datasourceId: number | null
  chartConfig: ChartConfig
}

const ChartDraftSaveModal: React.FC<ChartDraftSaveModalProps> = ({
  open,
  onClose,
  sql,
  datasourceId,
  chartConfig,
}) => {
  const [form] = Form.useForm()
  const createMutation = useCreateChartDraft()

  useEffect(() => {
    if (open) {
      form.resetFields()
    }
  }, [open, form])

  const handleOk = async () => {
    let values: { title?: string }
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    if (!sql.trim()) {
      message.error('SQL 为空，无法保存图表草稿')
      return
    }

    if (datasourceId === null) {
      message.error('未选择数据源，无法保存图表草稿')
      return
    }

    if (!chartConfig?.chartType) {
      message.error('图表配置不完整，无法保存图表草稿')
      return
    }

    try {
      await createMutation.mutateAsync({
        title: values.title,
        sqlText: sql,
        datasourceId,
        chartConfig,
      })
      message.success('图表草稿已保存')
      onClose()
    } catch (err) {
      message.error((err instanceof Error ? err.message : null) || '保存失败')
    }
  }

  return (
    <Modal
      title="保存图表草稿"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={createMutation.isPending}
      okText="保存"
      cancelText="取消"
    >
      <Form form={form} layout="vertical">
        <Form.Item name="title" label="标题" rules={[{ max: 200 }]}>
          <Input placeholder="留空将自动生成" />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default ChartDraftSaveModal
