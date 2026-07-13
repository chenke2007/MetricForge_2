import React from 'react'
import { Select, Tag, Button, Typography } from 'antd'
import {
  DatabaseOutlined,
  TableOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons'
import { useSqlDatasources } from '../api/sqlWorkbench'
import { useAiAskStore } from '../stores/aiAskStore'

interface DataScopeBarProps {
  siderCollapsed: boolean
  onToggleCollapse: () => void
}

const DataScopeBar: React.FC<DataScopeBarProps> = ({ siderCollapsed, onToggleCollapse }) => {
  const datasourceId = useAiAskStore((s) => s.datasourceId)
  const selectedTables = useAiAskStore((s) => s.selectedTables)
  const setDatasource = useAiAskStore((s) => s.setDatasource)
  const setSelectedTables = useAiAskStore((s) => s.setSelectedTables)

  const { data: datasources, isLoading: dsLoading } = useSqlDatasources()

  const removeTable = (table: string) => {
    setSelectedTables(selectedTables.filter((t) => t !== table))
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 24px',
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
      }}
    >
      <Button
        type="text"
        icon={siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
        onClick={onToggleCollapse}
        style={{ fontSize: 14, color: '#8c8c8c' }}
      >
        <span style={{ marginLeft: 4 }}>数据范围</span>
      </Button>

      <DatabaseOutlined style={{ color: '#8c8c8c', fontSize: 14 }} />
      <Select
        style={{ width: 200 }}
        placeholder="选择数据源"
        loading={dsLoading}
        value={datasourceId}
        onChange={(id) => {
          const ds = datasources?.find((d) => d.id === id)
          setDatasource(id, ds?.name || null)
          setSelectedTables([])
        }}
        options={datasources?.map((ds) => ({
          value: ds.id,
          label: ds.name,
        }))}
        notFoundContent="暂无可用数据源"
        size="small"
        allowClear
        onClear={() => {
          setDatasource(null, null)
          setSelectedTables([])
        }}
      />

      {selectedTables.length > 0 && (
        <>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, whiteSpace: 'nowrap', color: '#8c8c8c' }}
          >
            已选 ({selectedTables.length})
          </Typography.Text>
          <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 4, overflow: 'hidden' }}>
            {selectedTables.map((t) => (
              <Tag
                key={t}
                closable
                onClose={() => removeTable(t)}
                style={{
                  fontSize: 11,
                  lineHeight: '20px',
                  margin: 0,
                  borderRadius: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                <TableOutlined style={{ marginRight: 2 }} />
                {t}
              </Tag>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default DataScopeBar
