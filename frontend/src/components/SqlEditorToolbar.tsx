import React from 'react'
import { Button, Space, Tooltip } from 'antd'
import {
  CaretRightOutlined,
  SaveOutlined,
  ClearOutlined,
} from '@ant-design/icons'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'

interface SqlEditorToolbarProps {
  onExecute: () => void
  onSave: () => void
  onClear: () => void
}

const SqlEditorToolbar: React.FC<SqlEditorToolbarProps> = ({
  onExecute,
  onSave,
  onClear,
}) => {
  const isExecuting = useSqlWorkbenchStore((s) => s.isExecuting)
  const datasourceId = useSqlWorkbenchStore((s) => s.datasourceId)
  const sql = useSqlWorkbenchStore((s) => s.sql)

  const canExecute = !isExecuting && !!datasourceId && sql.trim().length > 0
  const canSave = !isExecuting && sql.trim().length > 0

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 0',
        marginBottom: 4,
      }}
    >
      <Space>
        <Tooltip title="执行 (Ctrl+Enter)">
          <Button
            type="primary"
            icon={<CaretRightOutlined />}
            loading={isExecuting}
            disabled={!canExecute}
            onClick={onExecute}
          >
            执行
          </Button>
        </Tooltip>
        <Tooltip title="保存草稿 (Ctrl+S)">
          <Button
            icon={<SaveOutlined />}
            disabled={!canSave}
            onClick={onSave}
          >
            保存
          </Button>
        </Tooltip>
      </Space>
      <Tooltip title="清空编辑器">
        <Button
          size="small"
          icon={<ClearOutlined />}
          disabled={isExecuting || !sql}
          onClick={onClear}
        />
      </Tooltip>
    </div>
  )
}

export default SqlEditorToolbar
