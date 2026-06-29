import React from 'react'
import { Form, Input, Button, Space, Descriptions, message } from 'antd'
import { useSaveSemantic } from '../hooks/useSaveSemantic'
import type { FieldContext, FieldSemanticData, SaveSemanticResponse } from '../api/governance'

interface SemanticEditFormProps {
  fieldContext: FieldContext
  existingSemantic: FieldSemanticData | null
  onSaved: (response: SaveSemanticResponse) => void
  onCancel: () => void
}

interface FormValues {
  business_alias: string
  meaning: string
  unit?: string
  enum_values?: string
  data_quality_note?: string
  governed_by?: string
}

const { TextArea } = Input

const SemanticEditForm: React.FC<SemanticEditFormProps> = ({
  fieldContext,
  existingSemantic,
  onSaved,
  onCancel,
}) => {
  const [form] = Form.useForm<FormValues>()
  const { mutateAsync: saveSemantic, isPending: saving } = useSaveSemantic()

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      const response = await saveSemantic({
        column_id: fieldContext.id,
        business_alias: values.business_alias,
        meaning: values.meaning,
        unit: values.unit || null,
        enum_values: values.enum_values || null,
        data_quality_note: values.data_quality_note || null,
        governed_by: values.governed_by || null,
      })
      onSaved(response)
    } catch (err) {
      // Form validation errors are displayed inline by Ant Design
      if (err && typeof err === 'object' && 'errorFields' in err) {
        return
      }
      // API errors
      const apiErr = err as { status?: number; message?: string }
      if (apiErr?.status || apiErr?.message) {
        message.error('保存失败，请重试')
      }
    }
  }

  const fullFieldName = `${fieldContext.schema_name}.${fieldContext.table_name}.${fieldContext.column_name}`

  return (
    <div>
      {/* Read-only field header */}
      <Descriptions size="small" column={1} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="字段">{fullFieldName}</Descriptions.Item>
        <Descriptions.Item label="类型">{fieldContext.column_type}</Descriptions.Item>
        <Descriptions.Item label="备注">{fieldContext.comment || '-'}</Descriptions.Item>
      </Descriptions>

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          business_alias: existingSemantic?.business_alias || '',
          meaning: existingSemantic?.meaning || '',
          unit: existingSemantic?.unit || '',
          enum_values: existingSemantic?.enum_values || '',
          data_quality_note: existingSemantic?.data_quality_note || '',
          governed_by: existingSemantic?.governed_by || '',
        }}
      >
        <Form.Item
          name="business_alias"
          label="业务别名 *"
          rules={[{ required: true, message: '请输入业务别名' }]}
        >
          <Input aria-label="业务别名 *" />
        </Form.Item>

        <Form.Item
          name="meaning"
          label="含义 *"
          rules={[{ required: true, message: '请输入字段含义' }]}
        >
          <TextArea rows={3} aria-label="含义 *" />
        </Form.Item>

        <Form.Item name="unit" label="单位">
          <Input />
        </Form.Item>

        <Form.Item name="enum_values" label="枚举值解释">
          <TextArea rows={3} />
        </Form.Item>

        <Form.Item name="data_quality_note" label="数据质量说明">
          <TextArea rows={3} />
        </Form.Item>

        <Form.Item name="governed_by" label="治理负责人">
          <Input />
        </Form.Item>
      </Form>

      <Space>
        <Button onClick={onCancel}>取消</Button>
        <Button type="primary" loading={saving} onClick={handleSave}>
          保存字段语义
        </Button>
      </Space>
    </div>
  )
}

export default SemanticEditForm
