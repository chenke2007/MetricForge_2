import React, { useState } from 'react'
import { Select, Typography, Tag, Spin, Empty, Collapse } from 'antd'
import {
  DatabaseOutlined,
  TableOutlined,
} from '@ant-design/icons'
import { useSqlDatasources, useSchemaTree } from '../api/sqlWorkbench'
import { useAiAskStore } from '../stores/aiAskStore'

const DataScopeSelector: React.FC = () => {
  const datasourceId = useAiAskStore((s) => s.datasourceId)
  const selectedTables = useAiAskStore((s) => s.selectedTables)
  const setDatasource = useAiAskStore((s) => s.setDatasource)
  const setSelectedTables = useAiAskStore((s) => s.setSelectedTables)

  const { data: datasources, isLoading: dsLoading } = useSqlDatasources()
  const { data: schemaTree, isLoading: schemaLoading } = useSchemaTree(datasourceId)

  const [treeOpen, setTreeOpen] = useState(false)

  const removeTable = (table: string) => {
    setSelectedTables(selectedTables.filter((t) => t !== table))
  }

  const toggleTable = (tableName: string) => {
    if (selectedTables.includes(tableName)) {
      removeTable(tableName)
    } else {
      setSelectedTables([...selectedTables, tableName])
    }
  }

  const allTableNames = schemaTree
    ? schemaTree.schemas.flatMap((s) => s.tables.map((t) => t.name))
    : []

  return (
    <div
      style={{
        padding: '12px 0',
        borderBottom: '1px solid #f0f0f0',
        marginBottom: 8,
      }}
    >
      {/* Section header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <Typography.Text strong style={{ fontSize: 13, color: '#262626' }}>
          <DatabaseOutlined style={{ marginRight: 6 }} />
          数据范围
        </Typography.Text>
      </div>

      {/* Datasource selector */}
      <Select
        style={{ width: '100%', marginBottom: 10 }}
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

      {/* Selected tables tags */}
      {selectedTables.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 12, display: 'block', marginBottom: 4 }}
          >
            已选表 ({selectedTables.length})
          </Typography.Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
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
                }}
              >
                <TableOutlined style={{ marginRight: 2 }} />
                {t}
              </Tag>
            ))}
          </div>
        </div>
      )}

      {/* Schema tree toggle */}
      {datasourceId && (
        <>
          {schemaLoading ? (
            <Spin size="small" style={{ display: 'block', margin: '8px auto' }} />
          ) : allTableNames.length > 0 ? (
            <Collapse
              ghost
              size="small"
              activeKey={treeOpen ? 'schema' : undefined}
              onChange={(keys) => setTreeOpen(keys.includes('schema'))}
              items={[
                {
                  key: 'schema',
                  label: (
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: 12 }}
                    >
                      表列表 ({allTableNames.length})
                    </Typography.Text>
                  ),
                  children: (
                    <div
                      style={{
                        maxHeight: 240,
                        overflowY: 'auto',
                        marginTop: -4,
                      }}
                    >
                      {allTableNames.map((name) => {
                        const isSelected = selectedTables.includes(name)
                        return (
                          <div
                            key={name}
                            onClick={() => toggleTable(name)}
                            style={{
                              padding: '4px 8px',
                              cursor: 'pointer',
                              borderRadius: 4,
                              fontSize: 12,
                              fontFamily:
                                'Consolas, "Courier New", monospace',
                              background: isSelected ? '#e6f4ff' : 'transparent',
                              color: isSelected ? '#1677ff' : '#595959',
                              marginBottom: 2,
                              transition: 'background 0.15s',
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected)
                                e.currentTarget.style.background = '#f5f5f5'
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected)
                                e.currentTarget.style.background = 'transparent'
                            }}
                          >
                            {name}
                          </div>
                        )
                      })}
                    </div>
                  ),
                },
              ]}
            />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Typography.Text style={{ fontSize: 12 }}>
                  该数据源尚未采集元数据
                </Typography.Text>
              }
              style={{ margin: '4px 0' }}
            />
          )}
        </>
      )}

      {!datasourceId && (
        <Typography.Text
          type="secondary"
          style={{ fontSize: 12, display: 'block', textAlign: 'center' }}
        >
          选择数据源以查看可用表
        </Typography.Text>
      )}
    </div>
  )
}

export default DataScopeSelector
