import React, { useEffect, useMemo, useState } from 'react'
import { Button, Drawer, Empty, Input, Select, Spin, Tag, Typography } from 'antd'
import {
  CheckOutlined,
  DatabaseOutlined,
  SearchOutlined,
  TableOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { useSchemaTree, useSearchSchema, useSqlDatasources } from '../api/sqlWorkbench'
import type { SearchResult } from '../api/sqlWorkbench'
import { useAiAskStore } from '../stores/aiAskStore'

const MATCHED_ON_LABELS: Record<string, string> = {
  table_name: '表名匹配',
  table_comment: '表注释匹配',
  column_name: '字段名匹配',
  column_comment: '字段注释匹配',
}

interface GroupedResult {
  fullName: string
  columnName: string | null
  matchedOn: string[]
}

/** 搜索结果按完整表名去重，matched_on 聚合展示 */
function groupSearchResults(results: SearchResult[]): GroupedResult[] {
  const map = new Map<string, GroupedResult>()
  for (const r of results) {
    const fullName = `${r.schema_name}.${r.table_name}`
    const existing = map.get(fullName)
    if (existing) {
      if (!existing.matchedOn.includes(r.matched_on)) existing.matchedOn.push(r.matched_on)
      if (!existing.columnName && r.column_name) existing.columnName = r.column_name
    } else {
      map.set(fullName, {
        fullName,
        columnName: r.column_name,
        matchedOn: [r.matched_on],
      })
    }
  }
  return [...map.values()]
}

const DataScopeBar: React.FC = () => {
  const datasourceId = useAiAskStore((s) => s.datasourceId)
  const selectedTables = useAiAskStore((s) => s.selectedTables)
  const setDatasource = useAiAskStore((s) => s.setDatasource)
  const setSelectedTables = useAiAskStore((s) => s.setSelectedTables)

  const { data: datasources, isLoading: dsLoading } = useSqlDatasources()

  const [inputQuery, setInputQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [browseOpen, setBrowseOpen] = useState(false)

  // 300ms debounce：inputQuery → debouncedQuery
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(inputQuery.trim()), 300)
    return () => clearTimeout(timer)
  }, [inputQuery])

  // 切换或清空数据源时，清空本地搜索与浏览状态
  useEffect(() => {
    setInputQuery('')
    setDebouncedQuery('')
    setBrowseOpen(false)
  }, [datasourceId])

  const { data: searchResults, isLoading: searchLoading, isFetching: searchFetching } =
    useSearchSchema(datasourceId, debouncedQuery)

  // 仅 Drawer 打开后才加载全量 schema tree
  const { data: schemaTree, isLoading: treeLoading } = useSchemaTree(
    browseOpen ? datasourceId : null,
  )

  const groupedResults = useMemo(
    () => (searchResults ? groupSearchResults(searchResults) : []),
    [searchResults],
  )

  const isSearching = !!debouncedQuery && (searchLoading || searchFetching)
  const showPanel = debouncedQuery.length > 0

  const addTable = (fullName: string) => {
    if (!selectedTables.includes(fullName)) {
      setSelectedTables([...selectedTables, fullName])
    }
  }

  const removeTable = (table: string) => {
    setSelectedTables(selectedTables.filter((t) => t !== table))
  }

  const treeTotal = schemaTree
    ? schemaTree.schemas.reduce((sum, s) => sum + s.tables.length, 0)
    : 0

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 24px',
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
      }}
    >
      <Typography.Text
        strong
        style={{ fontSize: 13, color: '#262626', whiteSpace: 'nowrap' }}
      >
        数据范围
      </Typography.Text>

      <DatabaseOutlined style={{ color: '#8c8c8c', fontSize: 14 }} />
      <Select
        style={{ width: 200 }}
        placeholder="选择数据源"
        loading={dsLoading}
        value={datasourceId}
        onChange={(id) => {
          if (id == null) {
            setDatasource(null, null)
            setSelectedTables([])
            return
          }
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

      {datasourceId && (
        <div style={{ position: 'relative', width: 260 }}>
          <Input
            placeholder="搜索表名或字段名"
            allowClear
            size="small"
            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
          />

          {showPanel && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                width: 360,
                maxHeight: 320,
                overflowY: 'auto',
                background: '#fff',
                border: '1px solid #f0f0f0',
                borderRadius: 8,
                boxShadow: '0 6px 16px rgba(0, 0, 0, 0.08)',
                zIndex: 1000,
                padding: '4px 0',
              }}
            >
              {isSearching ? (
                <Spin size="small" style={{ display: 'block', margin: '16px auto' }} />
              ) : groupedResults.length > 0 ? (
                groupedResults.map((item) => {
                  const isSelected = selectedTables.includes(item.fullName)
                  return (
                    <div
                      key={item.fullName}
                      role="button"
                      aria-pressed={isSelected}
                      onClick={() => addTable(item.fullName)}
                      style={{
                        padding: '5px 12px',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontFamily: 'Consolas, "Courier New", monospace',
                        background: isSelected ? '#e6f4ff' : 'transparent',
                        color: isSelected ? '#1677ff' : '#595959',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.background = '#f5f5f5'
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <TableOutlined style={{ marginRight: 6, fontSize: 11 }} />
                      {item.fullName}
                      {item.columnName && (
                        <Typography.Text
                          type="secondary"
                          style={{
                            fontSize: 11,
                            fontFamily: 'Consolas, "Courier New", monospace',
                            marginLeft: 4,
                          }}
                        >
                          .{item.columnName}
                        </Typography.Text>
                      )}
                      {item.matchedOn.map((m) => (
                        <Tag
                          key={m}
                          style={{
                            fontSize: 10,
                            lineHeight: '16px',
                            marginLeft: 6,
                            borderRadius: 3,
                            border: 'none',
                          }}
                          color="default"
                        >
                          {MATCHED_ON_LABELS[m] || m}
                        </Tag>
                      ))}
                    </div>
                  )
                })
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <Typography.Text style={{ fontSize: 12 }}>
                      未找到与 "{debouncedQuery}" 相关的表或字段
                    </Typography.Text>
                  }
                  style={{ margin: '12px 0' }}
                />
              )}
            </div>
          )}
        </div>
      )}

      {datasourceId && (
        <Button
          type="text"
          size="small"
          icon={<UnorderedListOutlined />}
          onClick={() => setBrowseOpen(true)}
          style={{ color: '#595959' }}
        >
          浏览全部
        </Button>
      )}

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

      <Drawer
        title="浏览全部数据对象"
        placement="right"
        width={420}
        open={browseOpen}
        onClose={() => setBrowseOpen(false)}
        destroyOnHidden
      >
        {treeLoading ? (
          <Spin style={{ display: 'block', margin: '24px auto' }} />
        ) : !schemaTree || treeTotal === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Typography.Text style={{ fontSize: 12 }}>
                该数据源尚未采集元数据
              </Typography.Text>
            }
            style={{ margin: '24px 0' }}
          />
        ) : (
          <div>
            {schemaTree.schemas.map((schema) => (
              <div key={schema.schema_name} style={{ marginBottom: 16 }}>
                <Typography.Text
                  strong
                  style={{ fontSize: 12, color: '#262626', marginBottom: 6, display: 'inline-block' }}
                >
                  {schema.schema_name}
                </Typography.Text>
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 11, marginLeft: 6, marginBottom: 6, display: 'inline-block' }}
                >
                  ({schema.tables.length})
                </Typography.Text>
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  {schema.tables.map((t) => {
                    const fullName = `${schema.schema_name}.${t.name}`
                    const isSelected = selectedTables.includes(fullName)
                    return (
                      <div
                        key={t.id}
                        role="button"
                        aria-pressed={isSelected}
                        onClick={() => addTable(fullName)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '4px 8px',
                          cursor: 'pointer',
                          borderRadius: 4,
                          fontSize: 12,
                          fontFamily: 'Consolas, "Courier New", monospace',
                          background: isSelected ? '#e6f4ff' : 'transparent',
                          color: isSelected ? '#1677ff' : '#595959',
                          marginBottom: 2,
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) e.currentTarget.style.background = '#f5f5f5'
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) e.currentTarget.style.background = 'transparent'
                        }}
                      >
                        <span>{t.name}</span>
                        {isSelected && <CheckOutlined style={{ fontSize: 11 }} />}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  )
}

export default DataScopeBar
