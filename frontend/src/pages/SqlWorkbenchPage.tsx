import React, { useCallback } from 'react'
import { Spin, Empty, Button, message } from 'antd'
import { useSqlDatasources, useExecuteSql } from '../api/sqlWorkbench'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'
import SchemaPanel from '../components/SchemaPanel'
import SqlEditor from '../components/SqlEditor'
import SqlEditorToolbar from '../components/SqlEditorToolbar'
import ResultPanel from '../components/ResultPanel'
import BottomPanel from '../components/BottomPanel'
import DraftFormModal from '../components/DraftFormModal'

const SqlWorkbenchPage: React.FC = () => {
  const { data: datasources, isLoading: dsLoading } = useSqlDatasources()
  const executeMutation = useExecuteSql()

  const datasourceId = useSqlWorkbenchStore((s) => s.datasourceId)
  const sql = useSqlWorkbenchStore((s) => s.sql)
  const setExecuting = useSqlWorkbenchStore((s) => s.setExecuting)
  const setResult = useSqlWorkbenchStore((s) => s.setResult)
  const showResult = useSqlWorkbenchStore((s) => s.showResult)
  const setSql = useSqlWorkbenchStore((s) => s.setSql)

  const [draftModalOpen, setDraftModalOpen] = React.useState(false)

  const handleExecute = useCallback(async () => {
    if (!datasourceId || !sql.trim()) return

    setExecuting(true)
    try {
      const result = await executeMutation.mutateAsync({
        datasource_id: datasourceId,
        sql: sql.trim(),
      })
      setResult(result)
      showResult()
    } catch (err: any) {
      if (err.status === 422) {
        message.error(err.message || 'SQL 校验失败')
      } else {
        message.error(err.message || '执行失败')
      }
    } finally {
      setExecuting(false)
    }
  }, [datasourceId, sql, executeMutation, setExecuting, setResult, showResult])

  const handleSave = useCallback(() => {
    setDraftModalOpen(true)
  }, [])

  const handleClear = useCallback(() => {
    setSql('')
  }, [setSql])

  if (dsLoading) {
    return <Spin style={{ display: 'block', margin: '64px auto' }} />
  }

  if (!datasources || datasources.length === 0) {
    return (
      <Empty description="暂无可用数据源，请先配置">
        <Button type="primary" onClick={() => window.location.href = '/web/datasources'}>
          去配置数据源
        </Button>
      </Empty>
    )
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)' }}>
      {/* Left: Schema Browser */}
      <div
        style={{
          width: 320,
          minWidth: 320,
          borderRight: '1px solid #f0f0f0',
          overflow: 'auto',
        }}
      >
        <SchemaPanel />
      </div>

      {/* Right: Editor + Results + History */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '0 12px', overflow: 'hidden' }}>
        <SqlEditorToolbar
          onExecute={handleExecute}
          onSave={handleSave}
          onClear={handleClear}
        />
        <SqlEditor onExecute={handleExecute} onSave={handleSave} />
        <ResultPanel />
        <div style={{ flex: 1, overflow: 'auto' }}>
          <BottomPanel />
        </div>
      </div>

      {/* Draft Save Modal */}
      <DraftFormModal
        open={draftModalOpen}
        draft={null}
        onClose={() => setDraftModalOpen(false)}
      />
    </div>
  )
}

export default SqlWorkbenchPage
