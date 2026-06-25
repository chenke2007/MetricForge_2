import React, { useEffect } from 'react'
import { Modal, Form, Input } from 'antd'
import type { LlmSetting, CreateLlmSettingData, UpdateLlmSettingData } from '../api/llmSettings'

interface Props {
  open: boolean
  editingSetting: LlmSetting | null  // null = create mode
  onCancel: () => void
  onSubmit: (values: CreateLlmSettingData | UpdateLlmSettingData) => Promise<void>
}

const LlmSettingFormModal: React.FC<Props> = ({ open, editingSetting, onCancel, onSubmit }) => {
  const [form] = Form.useForm()
  const isEdit = !!editingSetting

  useEffect(() => {
    if (open) {
      if (editingSetting) {
        form.setFieldsValue({
          name: editingSetting.name,
          base_url: editingSetting.base_url,
          api_key: '',  // Never prefill, user must re-enter
          model_name: editingSetting.model_name,
        })
      } else {
        form.resetFields()
      }
    }
  }, [open, editingSetting, form])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      await onSubmit(values)
      form.resetFields()
    } catch {
      // validation failed
    }
  }

  return (
    <Modal
      title={isEdit ? '编辑 LLM 配置' : '添加 LLM 配置'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input placeholder="DeepSeek V4 生产" maxLength={50} />
        </Form.Item>
        <Form.Item name="base_url" label="Base URL" rules={[{ required: true, message: '请输入 API 地址' }]}>
          <Input placeholder="http://uat-unifyapi.utflc.com:8080" />
        </Form.Item>
        <Form.Item
          name="api_key"
          label="API Key"
          rules={isEdit ? [] : [{ required: true, message: '请输入 API Key' }]}
          extra={isEdit ? '留空则不修改已有 Key' : undefined}
        >
          <Input.Password placeholder={isEdit ? '留空则不修改' : 'sk-...'} />
        </Form.Item>
        <Form.Item name="model_name" label="模型名" rules={[{ required: true, message: '请输入模型名' }]}>
          <Input placeholder="DeepSeek-V4-Flash" />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default LlmSettingFormModal
