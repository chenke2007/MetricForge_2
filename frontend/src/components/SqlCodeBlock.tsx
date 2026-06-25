import React, { useState } from 'react'
import { Typography, Button, Tooltip } from 'antd'
import { CopyOutlined, CheckOutlined } from '@ant-design/icons'

const { Text } = Typography

interface SqlCodeBlockProps {
  code: string
  language?: string
}

const SqlCodeBlock: React.FC<SqlCodeBlockProps> = ({ code, language }) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback for insecure contexts
    }
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
        <Tooltip title={copied ? '已复制' : '复制代码'}>
          <Button
            type="text"
            size="small"
            icon={copied ? <CheckOutlined style={{ color: '#52c41a' }} /> : <CopyOutlined style={{ color: '#999' }} />}
            onClick={handleCopy}
          />
        </Tooltip>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '12px 16px',
          overflow: 'auto',
          maxHeight: 400,
        }}
      >
        <code
          style={{
            fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace",
            fontSize: 13,
            lineHeight: 1.6,
            color: '#d4d4d4',
            whiteSpace: 'pre',
          }}
        >
          {code}
        </code>
      </pre>
    </div>
  )
}

export default SqlCodeBlock
