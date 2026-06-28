import React, { useState, useCallback } from 'react'
import { Tree, Input, Spin, Empty, Alert } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { useSchemaTree, useSearchSchema } from '../api/sqlWorkbench'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'

interface SchemaTreeProps {
  datasourceId: number | null
}

const SchemaTree: React.FC<SchemaTreeProps> = ({ datasourceId }) => {
  const appendSql = useSqlWorkbenchStore((s) => s.appendSql)
  const [searchText, setSearchText] = useState('')

  const { data: schemaTree, isLoading, error } = useSchemaTree(datasourceId)
  const { data: searchResults } = useSearchSchema(
    searchText.length > 0 ? datasourceId : null,
    searchText,
  )
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([])

  const handleDoubleClickTable = useCallback((tableName: string) => {
    appendSql(`SELECT * FROM ${tableName}`)
  }, [appendSql])

  const buildTreeData = (): DataNode[] => {
    if (searchText && searchResults) {
      const tableNodes: DataNode[] = []
      const seen = new Set<number>()
      for (const r of searchResults) {
        if (!seen.has(r.table_id)) {
          seen.add(r.table_id)
          tableNodes.push({
            key: `table-${r.table_id}`,
            title: (
              <span
                style={{ cursor: 'pointer' }}
                onDoubleClick={() => handleDoubleClickTable(r.table_name)}
              >
                {r.table_name}
              </span>
            ),
            icon: '📋',
          })
        }
      }
      return tableNodes
    }

    if (!schemaTree) return []

    return schemaTree.schemas.map((schema) => ({
      key: `schema-${schema.schema_name}`,
      title: schema.schema_name,
      selectable: false,
      children: schema.tables.map((table) => ({
        key: `table-${table.id}`,
        title: (
          <span
            style={{ cursor: 'pointer' }}
            onDoubleClick={() => handleDoubleClickTable(table.name)}
          >
            {table.name}
            {table.comment && <span style={{ color: '#888', marginLeft: 8 }}>({table.comment})</span>}
          </span>
        ),
        icon: '📋',
        isLeaf: false,
      })),
    }))
  }

  const treeData = buildTreeData()

  if (!datasourceId) {
    return <div style={{ padding: 16, color: '#888' }}>请先选择数据源</div>
  }

  if (isLoading) return <Spin style={{ display: 'block', margin: '24px auto' }} />
  if (error) return <Alert type="error" message="加载 Schema 失败" showIcon />

  if (treeData.length === 0) {
    return <Empty description="该数据源尚未采集元数据" />
  }

  return (
    <div>
      <Input.Search
        placeholder="搜索表名/字段名"
        allowClear
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <Tree
        treeData={treeData}
        showIcon
        defaultExpandAll
        expandedKeys={expandedKeys}
        onExpand={(keys) => setExpandedKeys(keys)}
      />
    </div>
  )
}

export default SchemaTree
