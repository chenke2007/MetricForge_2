import React from 'react'
import { Table, Empty, Alert } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'

const COLUMN_MIN_WIDTH = 80
const COLUMN_MAX_WIDTH = 400
const SAMPLE_ROW_LIMIT = 100
const INTERNAL_ROW_KEY = '__mf_rowKey__'

/** Estimate pixel width of a text string (Chinese chars ~16px, ASCII ~8px) */
function calculateTextWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    // CJK characters (including fullwidth punctuation) are roughly double width
    if (/[一-鿿　-〿＀-￯]/.test(ch)) {
      width += 16
    } else {
      width += 8
    }
  }
  return width
}

/** Estimate column width based on header label and sample values */
function estimateColumnWidth(
  sampleValues: any[],
  headerLabel: string,
): number {
  const headerWidth = calculateTextWidth(headerLabel)
  const sampleMaxWidth = sampleValues.reduce((max: number, val: any) => {
    if (val === null) return max
    const text = String(val)
    return Math.max(max, calculateTextWidth(text))
  }, 0)
  const estimated = Math.max(headerWidth, sampleMaxWidth) + 24 // plus padding
  return Math.max(COLUMN_MIN_WIDTH, Math.min(COLUMN_MAX_WIDTH, estimated))
}

/** Check if first non-null value is numeric */
function isNumericColumn(sampleValues: any[]): boolean {
  const first = sampleValues.find((v) => v !== null && v !== undefined && v !== '')
  if (first === undefined) return false
  const str = String(first)
  return !isNaN(Number(str))
}

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

  const dataSource = result.rows.map((row, idx) => {
    const record: Record<string, any> = {}
    result.columns.forEach((col, ci) => {
      record[col] = row[ci]
    })
    record[INTERNAL_ROW_KEY] = idx
    return record
  })

  const sampleRows = result.rows.slice(0, SAMPLE_ROW_LIMIT)

  const columns: ColumnsType<any> = result.columns.map((col, colIndex) => {
    const sampleValues = sampleRows.map((row) => row[colIndex])
    const numeric = isNumericColumn(sampleValues)

    return {
      title: col,
      dataIndex: col,
      key: col,
      ellipsis: true,
      width: estimateColumnWidth(sampleValues, col),
      align: numeric ? 'right' : 'left',
      sorter: (a: any, b: any) => {
        const va = a[col]
        const vb = b[col]
        if (typeof va === 'number' && typeof vb === 'number') return va - vb
        if (va === null && vb === null) return 0
        if (va === null) return -1
        if (vb === null) return 1
        return String(va).localeCompare(String(vb))
      },
      showSorterTooltip: false,
      render: (val: any) => (val == null
        ? <span style={{ color: '#ccc' }}>NULL</span>
        : String(val)),
    }
  })

  return (
    <div style={{ marginTop: 8 }}>
      <Table
        dataSource={dataSource}
        columns={columns}
        rowKey={INTERNAL_ROW_KEY}
        size="small"
        pagination={false}
        scroll={{ x: 'max-content', y: 400 }}
        bordered
        virtual
      />
    </div>
  )
}

export default ResultTable
