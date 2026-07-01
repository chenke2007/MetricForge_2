import React from 'react'
import { List, Spin, Empty, Tag, Typography, Alert } from 'antd'
import { WarningOutlined } from '@ant-design/icons'
import { useChartDrafts } from '../api/chartDrafts'
import type { ChartDraft } from '../api/chartDrafts'

interface ChartDraftListProps {
  onLoad: (draft: ChartDraft) => void
}

const formatTime = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const ChartDraftList: React.FC<ChartDraftListProps> = ({ onLoad }) => {
  const { data: drafts, isLoading, error } = useChartDrafts()

  if (isLoading) {
    return <Spin data-testid="chart-draft-list-spin" style={{ display: 'block', margin: '24px auto' }} />
  }

  if (error) {
    return <Alert type="error" message="加载图表草稿失败" showIcon style={{ margin: 12 }} />
  }

  if (!drafts || drafts.length === 0) {
    return <Empty description="暂无图表草稿" style={{ margin: '24px 0' }} />
  }

  return (
    <List
      size="small"
      dataSource={drafts}
      renderItem={(draft) => (
        <List.Item
          style={{ cursor: 'pointer' }}
          onClick={() => onLoad(draft)}
        >
          <List.Item.Meta
            title={
              <span>
                {draft.title || '未命名图表'}
                {!draft.datasourceAvailable && (
                  <Tag
                    color="warning"
                    icon={<WarningOutlined />}
                    style={{ marginLeft: 8 }}
                  >
                    数据源不可用
                  </Tag>
                )}
              </span>
            }
            description={
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {formatTime(draft.updatedAt)}
                </Typography.Text>
                <br />
                <Typography.Text code style={{ fontSize: 12, maxWidth: 280 }} ellipsis>
                  {draft.sqlText.substring(0, 120)}
                </Typography.Text>
              </div>
            }
          />
        </List.Item>
      )}
    />
  )
}

export default ChartDraftList
