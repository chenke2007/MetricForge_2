import React from 'react'
import { Divider, Tabs } from 'antd'
import ResultToolbar from './ResultToolbar'
import ResultTable from './ResultTable'
import ChartPreview from './ChartPreview'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'

const ResultPanel: React.FC = () => {
  const resultVisible = useSqlWorkbenchStore((s) => s.resultVisible)
  const resultView = useSqlWorkbenchStore((s) => s.resultView)
  const setResultView = useSqlWorkbenchStore((s) => s.setResultView)

  if (!resultVisible) return null

  return (
    <div style={{ marginTop: 8 }}>
      <Divider style={{ margin: '8px 0' }} />
      <ResultToolbar />
      <Tabs
        activeKey={resultView}
        onChange={(key) => setResultView(key as 'table' | 'chart')}
        items={[
          { key: 'table', label: '表格', children: <ResultTable /> },
          { key: 'chart', label: '图表', children: <ChartPreview /> },
        ]}
      />
    </div>
  )
}

export default ResultPanel
