import React, { useCallback, useEffect, useState } from 'react'
import { Spin, Empty, Button, message, Drawer } from 'antd'
import { useSearchParams } from 'react-router-dom'
import { FileTextOutlined } from '@ant-design/icons'
import { useSqlDatasources, useExecuteSql } from '../api/sqlWorkbench'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'
import SchemaPanel from '../components/SchemaPanel'
import SqlEditor from '../components/SqlEditor'
import SqlEditorToolbar from '../components/SqlEditorToolbar'
import ResultPanel from '../components/ResultPanel'
import BottomPanel from '../components/BottomPanel'
import DraftFormModal from '../components/DraftFormModal'
import ChartDraftList from '../components/ChartDraftList'
import type { ChartDraft } from '../api/chartDrafts'

const SqlWorkbenchPage: React.FC = () => {
  const { data: datasources, isLoading: dsLoading } = useSqlDatasources()
  const executeMutation = useExecuteSql()
  const [searchParams, setSearchParams] = useSearchParams()

  const datasourceId = useSqlWorkbenchStore((s) => s.datasourceId)
  const sql = useSqlWorkbenchStore((s) => s.sql)
  const setExecuting = useSqlWorkbenchStore((s) => s.setExecuting)
  const setResult = useSqlWorkbenchStore((s) => s.setResult)
  const showResult = useSqlWorkbenchStore((s) => s.showResult)
  const setSql = useSqlWorkbenchStore((s) => s.setSql)
  const setDatasource = useSqlWorkbenchStore((s) => s.setDatasource)
  const setChartConfig = useSqlWorkbenchStore((s) => s.setChartConfig)
  const setResultView = useSqlWorkbenchStore((s) => s.setResultView)

  const [draftModalOpen, setDraftModalOpen] = React.useState(false)
  const [chartDraftDrawerOpen, setChartDraftDrawerOpen] = useState(false)
  const pendingDsIdRef = React.useRef<number | null>(null)

  // 从 URL 参数读取 sql 和 datasource_id，写入 store 后清除参数
  useEffect(() => {
    const sqlParam = searchParams.get('sql')
    const dsParam = searchParams.get('datasource_id')

    if (!sqlParam) return

    // useSearchParams 返回的值已由 React Router 解码，不要重复 decodeURIComponent
    setSql(sqlParam)

    if (dsParam) {
      const dsId = parseInt(dsParam, 10)
      if (!isNaN(dsId)) {
        // 如果数据源列表已加载，直接匹配名称；否则记录 pending id，等加载完成后再匹配
        if (datasources) {
          const matched = datasources.find((ds: any) => ds.id === dsId)
          setDatasource(dsId, matched ? matched.name : null)
        } else {
          pendingDsIdRef.current = dsId
          setDatasource(dsId, null)
        }
      }
    }

    // 清除 URL 参数，防止刷新后重复处理
    setSearchParams({}, { replace: true })
  }, []) // 仅在挂载时执行一次

  // 数据源列表异步加载完成后，补齐 datasource name
  useEffect(() => {
    if (!datasources || pendingDsIdRef.current === null) return

    const matched = datasources.find((ds: any) => ds.id === pendingDsIdRef.current)
    if (matched) {
      setDatasource(matched.id, matched.name)
    }
    pendingDsIdRef.current = null
  }, [datasources, setDatasource])

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

  const handleLoadChartDraft = useCallback((draft: ChartDraft) => {
    // 回填配置
    setSql(draft.sqlText)

    // 尝试补齐 datasource name
    if (datasources) {
      const matched = datasources.find((ds: any) => ds.id === draft.datasourceId)
      setDatasource(draft.datasourceId, matched ? matched.name : null)
    } else {
      setDatasource(draft.datasourceId, null)
    }

    setChartConfig(draft.chartConfig)
    setResultView('chart')

    // 关闭 Drawer
    setChartDraftDrawerOpen(false)

    // 提示用户手动执行
    message.info('图表草稿已加载，请点击「执行」按钮运行查询')
  }, [setSql, setDatasource, setChartConfig, setResultView, datasources])

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
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <Button
            size="small"
            icon={<FileTextOutlined />}
            onClick={() => setChartDraftDrawerOpen(true)}
          >
            图表草稿
          </Button>
        </div>
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

      {/* Chart Draft Drawer */}
      <Drawer
        title="图表草稿"
        placement="right"
        width={360}
        open={chartDraftDrawerOpen}
        onClose={() => setChartDraftDrawerOpen(false)}
      >
        <ChartDraftList onLoad={handleLoadChartDraft} />
      </Drawer>
    </div>
  )
}

export default SqlWorkbenchPage
