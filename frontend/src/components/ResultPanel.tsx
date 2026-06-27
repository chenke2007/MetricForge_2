import React from 'react'
import { Divider } from 'antd'
import ResultToolbar from './ResultToolbar'
import ResultTable from './ResultTable'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'

const ResultPanel: React.FC = () => {
  const resultVisible = useSqlWorkbenchStore((s) => s.resultVisible)

  if (!resultVisible) return null

  return (
    <div style={{ marginTop: 8 }}>
      <Divider style={{ margin: '8px 0' }} />
      <ResultToolbar />
      <ResultTable />
    </div>
  )
}

export default ResultPanel
