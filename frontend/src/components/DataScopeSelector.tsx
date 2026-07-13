import React, { useState, useCallback } from 'react'
import { Typography, Tag, Spin, Empty, Collapse, Input, Divider } from 'antd'
import {
  TableOutlined,
  SearchOutlined,
  ColumnHeightOutlined,
} from '@ant-design/icons'
import { useSchemaTree, useSearchSchema } from '../api/sqlWorkbench'
import { useAiAskStore } from '../stores/aiAskStore'
import type { SearchResult } from '../api/sqlWorkbench'

const MATCHED_ON_LABELS: Record<string, string> = {
  table_name: '表名匹配',
  table_comment: '表注释匹配',
  column_name: '字段名匹配',
  column_comment: '字段注释匹配',
}

const DataScopeSelector: React.FC = () => {
  const datasourceId = useAiAskStore((s) => s.datasourceId)
  const selectedTables = useAiAskStore((s) => s.selectedTables)
  const setSelectedTables = useAiAskStore((s) => s.setSelectedTables)

  const { data: schemaTree, isLoading: schemaLoading } = useSchemaTree(datasourceId)

  const [treeOpen, setTreeOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const { data: searchResults, isLoading: searchLoading, isFetching: searchFetching } =
    useSearchSchema(datasourceId, searchQuery)

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

  const handleSearch = useCallback((value: string) => {
    setSearchQuery(value.trim())
  }, [])

  const allTableNames = schemaTree
    ? schemaTree.schemas.flatMap((s) => s.tables.map((t) => t.name))
    : []

  const groupedResults = React.useMemo(() => {
    if (!searchResults) return null
    const groups: Record<string, SearchResult[]> = {}
    for (const r of searchResults) {
      const key = r.matched_on
      if (!groups[key]) groups[key] = []
      groups[key].push(r)
    }
    return groups
  }, [searchResults])

  const isSearching = !!searchQuery && (searchLoading || searchFetching)
  const hasSearchResults = !!searchQuery && !!searchResults && searchResults.length > 0
  const noSearchResults = !!searchQuery && !!searchResults && searchResults.length === 0 && !isSearching

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
          <SearchOutlined style={{ marginRight: 6 }} />
          数据范围
        </Typography.Text>
      </div>

      {/* Search bar */}
      {datasourceId && (
        <div style={{ marginBottom: 10 }}>
          <Input.Search
            placeholder="搜索表名或字段名"
            allowClear
            size="small"
            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
            onSearch={handleSearch}
            onChange={(e) => {
              if (!e.target.value) {
                setSearchQuery('')
              }
            }}
            loading={isSearching}
          />
        </div>
      )}

      {/* Search results */}
      {isSearching && (
        <Spin size="small" style={{ display: 'block', margin: '12px auto' }} />
      )}

      {hasSearchResults && groupedResults && (
        <div style={{ marginBottom: 10, maxHeight: 280, overflowY: 'auto' }}>
          {Object.entries(groupedResults).map(([matchedOn, items]) => (
            <div key={matchedOn} style={{ marginBottom: 8 }}>
              <Typography.Text
                type="secondary"
                style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#bbb' }}
              >
                {MATCHED_ON_LABELS[matchedOn] || matchedOn} ({items.length})
              </Typography.Text>
              <div style={{ marginTop: 4 }}>
                {items.map((item) => (
                  <div
                    key={`${item.table_id}-${item.column_name ?? ''}-${matchedOn}`}
                    style={{
                      padding: '3px 6px',
                      cursor: 'pointer',
                      borderRadius: 4,
                      fontSize: 12,
                      fontFamily: 'Consolas, "Courier New", monospace',
                      background: selectedTables.includes(item.table_name) ? '#e6f4ff' : 'transparent',
                      color: selectedTables.includes(item.table_name) ? '#1677ff' : '#595959',
                      marginBottom: 2,
                      transition: 'background 0.15s',
                    }}
                    onClick={() => toggleTable(item.table_name)}
                    onMouseEnter={(e) => {
                      if (!selectedTables.includes(item.table_name))
                        e.currentTarget.style.background = '#f5f5f5'
                    }}
                    onMouseLeave={(e) => {
                      if (!selectedTables.includes(item.table_name))
                        e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <span>
                      {item.match_type === 'column' ? (
                        <ColumnHeightOutlined style={{ marginRight: 4, fontSize: 11 }} />
                      ) : (
                        <TableOutlined style={{ marginRight: 4, fontSize: 11 }} />
                      )}
                      <Typography.Text
                        style={{
                          fontSize: 12,
                          fontFamily: 'Consolas, "Courier New", monospace',
                          color: selectedTables.includes(item.table_name) ? '#1677ff' : '#595959',
                        }}
                      >
                        {item.schema_name}.{item.table_name}
                      </Typography.Text>
                      {item.column_name && (
                        <Typography.Text
                          type="secondary"
                          style={{
                            fontSize: 11,
                            fontFamily: 'Consolas, "Courier New", monospace',
                            marginLeft: 4,
                          }}
                        >
                          .{item.column_name}
                        </Typography.Text>
                      )}
                    </span>
                    <Tag
                      style={{
                        fontSize: 10,
                        lineHeight: '16px',
                        marginLeft: 6,
                        borderRadius: 3,
                        border: 'none',
                        verticalAlign: 'middle',
                      }}
                      color="default"
                    >
                      {MATCHED_ON_LABELS[matchedOn] || matchedOn}
                    </Tag>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {noSearchResults && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Typography.Text style={{ fontSize: 12 }}>
              未找到与 "{searchQuery}" 相关的表或字段
            </Typography.Text>
          }
          style={{ margin: '8px 0' }}
        />
      )}

      {/* Divider between search and tree */}
      {hasSearchResults && datasourceId && (
        <Divider style={{ margin: '8px 0' }} />
      )}

      {/* Schema tree toggle */}
      {datasourceId && !hasSearchResults && (
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
