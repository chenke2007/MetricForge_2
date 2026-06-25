import React, { useState } from 'react'
import { Typography, Button, Spin, Alert, Empty, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import {
  useLlmSettings,
  useCreateLlmSetting,
  useUpdateLlmSetting,
  useDeleteLlmSetting,
  useTestConnection,
  useActivateLlmSetting,
} from '../api/llmSettings'
import type { LlmSetting, CreateLlmSettingData, UpdateLlmSettingData } from '../api/llmSettings'
import LlmSettingCard from '../components/LlmSettingCard'
import LlmSettingFormModal from '../components/LlmSettingFormModal'

const LlmSettingsPage: React.FC = () => {
  const { data: settings, isLoading, error } = useLlmSettings()
  const createMutation = useCreateLlmSetting()
  const updateMutation = useUpdateLlmSetting()
  const deleteMutation = useDeleteLlmSetting()
  const testMutation = useTestConnection()
  const activateMutation = useActivateLlmSetting()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingSetting, setEditingSetting] = useState<LlmSetting | null>(null)
  const [testingId, setTestingId] = useState<number | null>(null)

  const handleTest = async (id: number) => {
    setTestingId(id)
    try {
      const result = await testMutation.mutateAsync(id)
      if (result.ok) {
        message.success(`连接成功！模型: ${result.model} (${result.latency_ms}ms)`)
      } else {
        message.error(result.error || '连接测试失败')
      }
    } catch {
      message.error('连接测试异常')
    } finally {
      setTestingId(null)
    }
  }

  const handleActivate = async (id: number) => {
    try {
      await activateMutation.mutateAsync(id)
      message.success('已启用')
    } catch {
      message.error('启用失败')
    }
  }

  const handleAdd = () => {
    setEditingSetting(null)
    setModalOpen(true)
  }

  const handleEdit = (setting: LlmSetting) => {
    setEditingSetting(setting)
    setModalOpen(true)
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync(id)
      message.success('已删除')
    } catch {
      message.error('删除失败')
    }
  }

  const handleSubmit = async (values: CreateLlmSettingData | UpdateLlmSettingData) => {
    try {
      if (editingSetting) {
        await updateMutation.mutateAsync({ id: editingSetting.id, data: values })
        message.success('已更新')
      } else {
        await createMutation.mutateAsync(values as CreateLlmSettingData)
        message.success('已创建')
      }
      setModalOpen(false)
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : '操作失败'
      if (e && typeof e === 'object' && 'message' in e) {
        message.error(String((e as { message: unknown }).message))
      } else {
        message.error(errMsg)
      }
    }
  }

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />

  if (error) {
    return (
      <Alert message="加载失败" description="无法获取 LLM 配置列表" type="error" showIcon />
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>LLM 连接管理</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>添加配置</Button>
      </div>

      {!settings || settings.length === 0 ? (
        <Empty description="尚未配置 LLM 连接，点击上方按钮添加" />
      ) : (
        settings.map((s) => (
          <LlmSettingCard
            key={s.id}
            setting={s}
            onTest={handleTest}
            onActivate={handleActivate}
            onEdit={handleEdit}
            onDelete={handleDelete}
            testingId={testingId}
          />
        ))
      )}

      <LlmSettingFormModal
        open={modalOpen}
        editingSetting={editingSetting}
        onCancel={() => setModalOpen(false)}
        onSubmit={handleSubmit}
      />
    </div>
  )
}

export default LlmSettingsPage
