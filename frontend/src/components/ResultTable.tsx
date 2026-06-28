import React from 'react'
import { Table, Empty, Alert } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'

const ResultTable: React.FC = () => {
  const result = useSqlWorkbenchStore((s) => s.result)
  const resultVisible = useSqlWorkbenchStore((s) => s.resultVisible)

  if (!resultVisible || !result) return null

  if (result.error) {
    return (
      <Alert
        type="error"
        message="查询执行错误"
        description={result.error}
        showIcon
        style={{ marginTop: 8 }}
      />
    )
  }

  if (result.columns.length === 0) {
    return <Empty description="查询结果为空" style={{ margin: 24 }} />
  }

  const columns: ColumnsType<any> = result.columns.map((col) => ({
    title: col,
    dataIndex: col,
    key: col,
    ellipsis: true,
    width: 150,
    render: (val: any) => (val === null ? <span style={{ color: '#ccc' }}>NULL</span> : String(val)),
  }))

  const dataSource = result.rows.map((row, idx) => {
    const record: Record<string, any> = { _key: idx }
    result.columns.forEach((col, ci) => {
      record[col] = row[ci]
    })
    return record
  })

  return (
    <div style={{ marginTop: 8 }}>
      <Table
        dataSource={dataSource}
        columns={columns}
        rowKey="_key"
        size="small"
        pagination={false}
        scroll={{ x: 'max-content', y: 400 }}
        bordered
      />
    </div>
  )
}

export default ResultTable
