import React from 'react'
import { Tag, Space, Button, Tooltip, message } from 'antd'
import {
  ClockCircleOutlined,
  TableOutlined,
  WarningOutlined,
  CopyOutlined,
  DownloadOutlined,
} from '@ant-design/icons'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'
import { rowsToCsv, downloadCsv, copyCsv } from '../utils/csv'

const ResultToolbar: React.FC = () => {
  const result = useSqlWorkbenchStore((s) => s.result)

  if (!result) return null

  if (result.error) {
    return (
      <div style={{ padding: '4px 0' }}>
        <Tag color="error" icon={<WarningOutlined />}>
          {result.error}
        </Tag>
      </div>
    )
  }

  const hasData = result.row_count > 0

  const handleCopyCsv = async () => {
    const csv = rowsToCsv(result.columns, result.rows)
    const ok = await copyCsv(csv)
    if (ok) {
      message.success('已复制到剪贴板')
    } else {
      message.warning('当前浏览器不支持复制，请使用导出CSV')
    }
  }

  const handleExportCsv = () => {
    const csv = rowsToCsv(result.columns, result.rows)
    downloadCsv(csv)
  }

  return (
    <div style={{ padding: '4px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Space size="middle">
        <Tag icon={<TableOutlined />} color="blue">
          {result.row_count} 行
        </Tag>
        <Tag icon={<ClockCircleOutlined />}>
          {result.elapsed_ms}ms
        </Tag>
        {result.truncated && (
          <Tag color="warning" icon={<WarningOutlined />}>
            已截断（最大 1000 行）
          </Tag>
        )}
      </Space>
      <Space size="small">
        <Tooltip title={hasData ? '复制 CSV' : '无数据可导出'}>
          <Button
            icon={<CopyOutlined />}
            size="small"
            disabled={!hasData}
            onClick={handleCopyCsv}
          >
            复制 CSV
          </Button>
        </Tooltip>
        <Tooltip title={hasData ? '导出 CSV' : '无数据可导出'}>
          <Button
            icon={<DownloadOutlined />}
            size="small"
            disabled={!hasData}
            onClick={handleExportCsv}
          >
            导出 CSV
          </Button>
        </Tooltip>
      </Space>
    </div>
  )
}

export default ResultToolbar
