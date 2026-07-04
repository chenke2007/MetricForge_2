import React from 'react'
import { Typography, Collapse, Tag, Button, Space } from 'antd'
import { CodeOutlined, CopyOutlined, ExportOutlined, WarningOutlined } from '@ant-design/icons'
import type { AiAskResponse } from '../types/aiAsk'

const { Text } = Typography

interface SqlPlanProps {
  sqlPlan: AiAskResponse['sqlPlan']
  onOpenInWorkbench?: (sql: string, dsId: number) => void
}

const SqlPlan: React.FC<SqlPlanProps> = ({ sqlPlan, onOpenInWorkbench }) => {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sqlPlan.sql)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard not available
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <Collapse
        size="small"
        style={{
          borderRadius: 8,
          background: '#fff',
          border: '1px solid #f0f0f0',
        }}
        items={[
          {
            key: 'sql',
            label: (
              <Space>
                <CodeOutlined style={{ color: '#4E7BF5' }} />
                <Text style={{ fontSize: 13, fontWeight: 500 }}>SQL 和查询计划</Text>
                <Tag style={{ fontSize: 10, lineHeight: '18px', borderRadius: 4 }}>
                  {sqlPlan.datasourceName}
                </Tag>
                {sqlPlan.tables.length > 0 && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    涉及 {sqlPlan.tables.join(', ')}
                  </Text>
                )}
              </Space>
            ),
            children: (
              <div>
                {/* 查询信息概要 */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 16,
                    marginBottom: 12,
                    padding: '8px 12px',
                    background: '#fafafa',
                    borderRadius: 6,
                  }}
                >
                  <div>
                    <Text type="secondary" style={{ fontSize: 11 }}>数据源</Text>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{sqlPlan.datasourceName}</div>
                  </div>
                  <div>
                    <Text type="secondary" style={{ fontSize: 11 }}>涉及表</Text>
                    <div>
                      {sqlPlan.tables.map((t) => (
                        <Tag key={t} style={{ fontSize: 11, borderRadius: 4, marginTop: 2 }}>
                          {t}
                        </Tag>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Text type="secondary" style={{ fontSize: 11 }}>查询字段</Text>
                    <div>
                      {sqlPlan.fields.map((f) => (
                        <Tag key={f} color="default" style={{ fontSize: 11, borderRadius: 4, marginTop: 2 }}>
                          {f}
                        </Tag>
                      ))}
                    </div>
                  </div>
                </div>

                {/* SQL 代码块 */}
                <div
                  style={{
                    borderRadius: 6,
                    overflow: 'hidden',
                    border: '1px solid #e8e8e8',
                    background: '#f6f8fa',
                  }}
                >
                  <pre
                    style={{
                      margin: 0,
                      padding: '12px 14px',
                      fontSize: 12,
                      lineHeight: 1.6,
                      fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
                      color: '#24292e',
                      overflow: 'auto',
                      maxHeight: 240,
                      whiteSpace: 'pre',
                    }}
                  >
                    {sqlPlan.sql}
                  </pre>
                </div>

                {/* 操作按钮 */}
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <Button size="small" icon={<CopyOutlined />} onClick={handleCopy}>
                    {copied ? '已复制' : '复制 SQL'}
                  </Button>
                  {onOpenInWorkbench && (
                    <Button
                      size="small"
                      icon={<ExportOutlined />}
                      onClick={() => onOpenInWorkbench(sqlPlan.sql, sqlPlan.datasourceId)}
                    >
                      在 SQL Workbench 中打开
                    </Button>
                  )}
                </div>

                {/* 假设信息 */}
                {sqlPlan.assumptions.length > 0 && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '8px 12px',
                      background: '#fffbe6',
                      borderRadius: 6,
                      border: '1px solid #ffe58f',
                    }}
                  >
                    <Text style={{ fontSize: 12, color: '#ad8b00' }}>
                      AI 推断假设
                    </Text>
                    {sqlPlan.assumptions.map((a, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#8c6e00', marginTop: 2 }}>
                        • {a}
                      </div>
                    ))}
                  </div>
                )}

                {/* 安全警告 */}
                {sqlPlan.safetyWarnings.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {sqlPlan.safetyWarnings.map((w, i) => (
                      <Tag key={i} color="warning" icon={<WarningOutlined />} style={{ fontSize: 11, marginTop: 2 }}>
                        {w}
                      </Tag>
                    ))}
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  )
}

export default SqlPlan
