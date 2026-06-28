import React from 'react'
import { List, Tag, Spin, Empty, Typography, Space } from 'antd'
import { ClockCircleOutlined, TableOutlined } from '@ant-design/icons'
import { useSqlHistory } from '../api/sqlWorkbench'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'

const HistoryList: React.FC = () => {
  const datasourceId = useSqlWorkbenchStore((s) => s.datasourceId)
  const setSql = useSqlWorkbenchStore((s) => s.setSql)
  const { data: history, isLoading } = useSqlHistory(datasourceId)

  if (isLoading) return <Spin style={{ display: 'block', margin: '24px auto' }} />
  if (!history || history.length === 0) return <Empty description="暂无执行历史" />

  return (
    <List
      size="small"
      dataSource={history}
      renderItem={(item) => (
        <List.Item
          style={{ cursor: 'pointer' }}
          onClick={() => setSql(item.sql_text)}
        >
          <List.Item.Meta
            title={
              <Typography.Text code ellipsis style={{ maxWidth: 400 }}>
                {item.sql_text}
              </Typography.Text>
            }
            description={
              <Space size="small">
                {item.datasource_name && (
                  <Tag>{item.datasource_name}</Tag>
                )}
                {item.elapsed_ms != null && (
                  <span>
                    <ClockCircleOutlined /> {item.elapsed_ms}ms
                  </span>
                )}
                {item.row_count != null && (
                  <span>
                    <TableOutlined /> {item.row_count} rows
                  </span>
                )}
                {item.status === 'error' && (
                  <Tag color="error">{item.error_message}</Tag>
                )}
              </Space>
            }
          />
        </List.Item>
      )}
    />
  )
}

export default HistoryList
