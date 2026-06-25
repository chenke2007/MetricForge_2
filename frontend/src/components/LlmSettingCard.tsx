import React from 'react'
import { Card, Tag, Space, Button, Typography, Descriptions } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  PoweroffOutlined,
} from '@ant-design/icons'
import type { LlmSetting } from '../api/llmSettings'

const { Text } = Typography

interface Props {
  setting: LlmSetting
  onTest: (id: number) => void
  onActivate: (id: number) => void
  onEdit: (setting: LlmSetting) => void
  onDelete: (id: number) => void
  testingId?: number | null
}

const LlmSettingCard: React.FC<Props> = ({ setting, onTest, onActivate, onEdit, onDelete, testingId }) => {
  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      title={
        <Space>
          {setting.is_active ? (
            <Tag icon={<CheckCircleOutlined />} color="success">已启用</Tag>
          ) : (
            <Tag icon={<PoweroffOutlined />}>停用</Tag>
          )}
          <Text strong>{setting.name}</Text>
        </Space>
      }
      extra={
        <Space>
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            loading={testingId === setting.id}
            onClick={() => onTest(setting.id)}
          >
            测试
          </Button>
          {!setting.is_active && (
            <Button size="small" type="primary" onClick={() => onActivate(setting.id)}>
              启用
            </Button>
          )}
          <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(setting)} />
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(setting.id)} />
        </Space>
      }
    >
      <Descriptions size="small" column={1}>
        <Descriptions.Item label="Base URL">
          <Text code copyable>{setting.base_url}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="Model">
          <Text code>{setting.model_name}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="API Key">
          <Text code>{setting.api_key_masked}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="连接状态">
          {setting.last_tested_at ? (
            setting.last_tested_ok
              ? <Text type="success"><CheckCircleOutlined /> 上次测试成功</Text>
              : <Text type="danger"><CloseCircleOutlined /> 上次测试失败</Text>
          ) : (
            <Text type="warning">未测试</Text>
          )}
        </Descriptions.Item>
      </Descriptions>
    </Card>
  )
}

export default LlmSettingCard
