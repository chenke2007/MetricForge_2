import React, { useState, useCallback } from 'react'
import { Tree, Input, Spin, Empty, Alert, Tooltip } from 'antd'
import type { DataNode } from 'antd/es/tree'
import { useSchemaTree, useSearchSchema, useTableColumns } from '../api/sqlWorkbench'
import type { ColumnDetail, SearchResult } from '../api/sqlWorkbench'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'

interface SchemaTreeProps {
  datasourceId: number | null
}

// ─── Non-visual column fetcher ───
const ColumnFetcher: React.FC<{
  tableId: number
  onLoaded: (id: number, cols: ColumnDetail[]) => void
  onError: (id: number, err: any) => void
}> = ({ tableId, onLoaded, onError }) => {
  const { data, error } = useTableColumns(tableId)

  React.useEffect(() => {
    if (data !== undefined) onLoaded(tableId, data)
  }, [tableId, data, onLoaded])
  React.useEffect(() => {
    if (error) onError(tableId, error)
  }, [tableId, error, onError])

  return null
}

const SchemaTree: React.FC<SchemaTreeProps> = ({ datasourceId }) => {
  const appendSql = useSqlWorkbenchStore((s) => s.appendSql)
  const [searchText, setSearchText] = useState('')

  const { data: schemaTree, isLoading, error } = useSchemaTree(datasourceId)
  const { data: searchResults } = useSearchSchema(
    searchText.length > 0 ? datasourceId : null,
    searchText,
  )
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>(() => {
    if (!searchText && schemaTree) {
      return schemaTree.schemas.map((s) => `schema-${s.schema_name}`)
    }
    return []
  })

  // ─── In search mode, auto-include tables that have column-level matches ───
  const columnMatchTableKeys: React.Key[] =
    searchText && searchResults
      ? [...new Set(
          searchResults
            .filter((r) => r.match_type === 'column')
            .flatMap((r) => [`table-${r.table_id}`, `table-search-${r.table_id}`])
        )]
      : []
  const effectiveExpandedKeys = [
    ...expandedKeys,
    ...columnMatchTableKeys.filter((k: React.Key) => !expandedKeys.includes(k)),
  ]

  // ─── Column loading state ───
  const [columnCache, setColumnCache] = useState<Record<number, ColumnDetail[]>>({})
  const [columnsError, setColumnsError] = useState<Record<number, any>>({})

  const handleColumnLoaded = useCallback((tableId: number, cols: ColumnDetail[]) => {
    setColumnCache((prev) => ({ ...prev, [tableId]: cols }))
    setColumnsError((prev) => {
      if (prev[tableId]) {
        const next = { ...prev }
        delete next[tableId]
        return next
      }
      return prev
    })
  }, [])

  const handleColumnError = useCallback((tableId: number, err: any) => {
    setColumnsError((prev) => ({ ...prev, [tableId]: err }))
  }, [])

  const handleExpand = useCallback((keys: React.Key[]) => {
    setExpandedKeys(keys)
  }, [])

  const handleDoubleClickTable = useCallback((tableName: string) => {
    appendSql(`SELECT * FROM ${tableName}`)
  }, [appendSql])

  // ─── Build column child nodes ───
  const buildColumnChildren = (tableId: number): DataNode[] => {
    const cols = columnCache[tableId]
    if (cols !== undefined) {
      if (cols.length === 0) {
        return [{ key: `empty-${tableId}`, title: '无字段', isLeaf: true, icon: '📭' }]
      }
      return cols.map((col) => ({
        key: `col-${col.id}`,
        title: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, lineHeight: 1.8 }}>
            {col.is_primary_key && <span style={{ fontSize: 11, color: '#d4a017' }}>🔑</span>}
            {col.is_foreign_key && !col.is_primary_key && (
              <span style={{ fontSize: 11, color: '#1890ff' }}>🔗</span>
            )}
            <span style={{ fontFamily: 'Consolas, "Courier New", monospace' }}>{col.name}</span>
            <span style={{ color: '#888', fontSize: 12 }}>{col.type}</span>
            {col.comment && (
              <Tooltip title={col.comment}>
                <span
                  style={{
                    color: '#aaa',
                    fontSize: 11,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 120,
                    display: 'inline-block',
                  }}
                >
                  — {col.comment}
                </span>
              </Tooltip>
            )}
          </div>
        ),
        isLeaf: true,
        icon: '📄',
      }))
    }

    if (columnsError[tableId]) {
      return [{ key: `error-${tableId}`, title: '加载字段失败', isLeaf: true, icon: '❌' }]
    }

    // Not yet loaded
    return [{ key: `loading-${tableId}`, title: '加载中...', isLeaf: true, icon: '⏳' }]
  }

  // ─── Build tree ───
  const buildTreeData = (): DataNode[] => {
    if (searchText && searchResults) {
      // Group search results by table_id
      const tableMap = new Map<
        number,
        { tableName: string; schemaName: string; comment: string | null; columns: SearchResult[] }
      >()
      for (const r of searchResults) {
        if (!tableMap.has(r.table_id)) {
          tableMap.set(r.table_id, {
            tableName: r.table_name,
            schemaName: r.schema_name,
            comment: r.table_comment,
            columns: [],
          })
        }
        if (r.match_type === 'column' && r.column_name) {
          tableMap.get(r.table_id)!.columns.push(r)
        }
      }

      const tableNodes: DataNode[] = []
      for (const [tableId, info] of tableMap) {
        const children: DataNode[] =
          info.columns.length > 0
            ? info.columns.map((col) => ({
                key: `col-search-${tableId}-${col.column_name}`,
                title: (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, lineHeight: 1.8 }}>
                    <span style={{ fontFamily: 'Consolas, "Courier New", monospace' }}>
                      {col.column_name}
                    </span>
                    <span style={{ color: '#AAA', fontSize: 11 }}>字段匹配</span>
                  </div>
                ),
                isLeaf: true,
                icon: '📄',
              }))
            : []

        tableNodes.push({
          key: `table-search-${tableId}`,
          title: (
            <span
              style={{ cursor: 'pointer' }}
              onDoubleClick={() => handleDoubleClickTable(info.tableName)}
            >
              <span style={{ fontFamily: 'Consolas, "Courier New", monospace', fontWeight: 600, fontSize: 13 }}>
                {info.tableName}
              </span>
              {info.comment && (
                <span style={{ color: '#888', fontSize: 12, marginLeft: 8 }}>— {info.comment}</span>
              )}
            </span>
          ),
          icon: '📋',
          isLeaf: children.length === 0,
          children: children.length > 0 ? children : undefined,
        })
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
          <div
            style={{ cursor: 'pointer', lineHeight: 1.6 }}
            onDoubleClick={() => handleDoubleClickTable(table.name)}
            title={table.name}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span
                style={{
                  fontFamily: 'Consolas, "Courier New", monospace',
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                {table.name}
              </span>
              <span style={{ fontSize: 11, color: '#999', whiteSpace: 'nowrap' }}>
                ({table.column_count} 列)
              </span>
            </div>
            {table.comment && (
              <div
                style={{
                  fontSize: 12,
                  color: '#888',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '100%',
                }}
                title={table.comment}
              >
                {table.comment}
              </div>
            )}
          </div>
        ),
        icon: '📋',
        isLeaf: false,
        children:
          expandedKeys.includes(`table-${table.id}`) ? buildColumnChildren(table.id) : undefined,
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
        expandedKeys={effectiveExpandedKeys}
        onExpand={handleExpand}
      />
      {/* Non-visual column fetchers for expanded tables not yet cached */}
      {expandedKeys
        .filter((k) => String(k).startsWith('table-'))
        .map((k) => parseInt(String(k).replace('table-', ''), 10))
        .filter((id) => !isNaN(id) && !(id in columnCache) && !columnsError[id])
        .map((id) => (
          <ColumnFetcher
            key={id}
            tableId={id}
            onLoaded={handleColumnLoaded}
            onError={handleColumnError}
          />
        ))}
    </div>
  )
}

export default SchemaTree
