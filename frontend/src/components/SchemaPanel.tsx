import React from 'react'
import { Select, Typography } from 'antd'
import { useSqlDatasources } from '../api/sqlWorkbench'
import { useSqlWorkbenchStore } from '../stores/sqlWorkbenchStore'
import SchemaTree from './SchemaTree'

const SchemaPanel: React.FC = () => {
  const { data: datasources, isLoading } = useSqlDatasources()
  const datasourceId = useSqlWorkbenchStore((s) => s.datasourceId)
  const setDatasource = useSqlWorkbenchStore((s) => s.setDatasource)

  return (
    <div style={{ padding: 12 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        元数据浏览器
      </Typography.Title>

      <Select
        style={{ width: '100%', marginBottom: 12 }}
        placeholder="选择数据源"
        loading={isLoading}
        value={datasourceId}
        onChange={(id) => {
          const ds = datasources?.find((d) => d.id === id)
          setDatasource(id, ds?.name || null)
        }}
        options={datasources?.map((ds) => ({
          value: ds.id,
          label: ds.name,
        }))}
        notFoundContent="暂无可用数据源"
      />

      <SchemaTree datasourceId={datasourceId} />
    </div>
  )
}

export default SchemaPanel
