import React, { useState, useMemo } from 'react'
import { Typography, Button, Tooltip, message, Modal } from 'antd'
import { CopyOutlined, CheckOutlined, ExportOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

const { Text } = Typography

interface SqlCodeBlockProps {
  code: string
  language?: string
}

const SqlCodeBlock: React.FC<SqlCodeBlockProps> = ({ code, language }) => {
  const [copied, setCopied] = useState(false)
  const navigate = useNavigate()

  // 解析 datasource_id 首行注释
  const { datasourceId, cleanCode } = useMemo(() => {
    const match = code.match(/^--\s*datasource_id:\s*(\d+)\s*\n?/)
    if (match) {
      return {
        datasourceId: parseInt(match[1], 10),
        cleanCode: code.slice(match[0].length),
      }
    }
    return { datasourceId: null, cleanCode: code }
  }, [code])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(cleanCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback for insecure contexts
    }
  }

  const handleOpenInWorkbench = () => {
    const params = new URLSearchParams()
    params.set('sql', cleanCode)
    if (datasourceId) {
      params.set('datasource_id', String(datasourceId))
    }

    const url = `/sql-workbench?${params.toString()}`

    if (url.length > 1800) {
      Modal.warning({
        title: 'SQL 过长',
        content: '生成的 SQL 过长，无法通过 URL 跳转，请手动复制到 SQL 工作台。',
      })
      return
    }

    if (!datasourceId) {
      message.info('缺少数据源信息，请在 SQL 工作台中手动选择数据源')
    }

    navigate(url)
  }

  // 空代码时不显示操作栏
  if (!code) {
    return null
  }

  return (
    <div
      style={{
        background: '#1e1e1e',
        borderRadius: 6,
        margin: '8px 0',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 12px',
          background: '#2d2d2d',
          borderBottom: '1px solid #333',
        }}
      >
        <Text style={{ color: '#999', fontSize: 12 }}>
          {language?.toUpperCase() || 'SQL'}
        </Text>
        <div style={{ display: 'flex', gap: 4 }}>
          <Tooltip title="在 SQL 工作台打开">
            <Button
              type="text"
              size="small"
              data-testid="open-in-workbench-btn"
              icon={<ExportOutlined style={{ color: '#999' }} />}
              onClick={handleOpenInWorkbench}
            />
          </Tooltip>
          <Tooltip title={copied ? '已复制' : '复制代码'}>
            <Button
              type="text"
              size="small"
              icon={copied ? <CheckOutlined style={{ color: '#52c41a' }} /> : <CopyOutlined style={{ color: '#999' }} />}
              onClick={handleCopy}
            />
          </Tooltip>
        </div>
      </div>
      <SyntaxHighlighter
        language={language?.toLowerCase() || 'sql'}
        style={oneDark}
        customStyle={{ margin: 0, borderRadius: 0, fontSize: 13 }}
        showLineNumbers
      >
        {cleanCode}
      </SyntaxHighlighter>
    </div>
  )
}

export default SqlCodeBlock
