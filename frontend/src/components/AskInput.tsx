import React, { useState, useEffect } from 'react'
import { Input, Button } from 'antd'
import { SendOutlined } from '@ant-design/icons'

const { TextArea } = Input

interface AskInputProps {
  onSend: (content: string) => void
  loading?: boolean
  disabled?: boolean
  placeholder?: string
  initialValue?: string
  autoFocus?: boolean
}

const AskInput: React.FC<AskInputProps> = ({
  onSend,
  loading,
  disabled,
  placeholder = '用自然语言描述你的业务问题，例如：近 30 天各区域的销售额和同比增长',
  initialValue,
  autoFocus,
}) => {
  const [value, setValue] = useState(initialValue || '')

  useEffect(() => {
    if (initialValue !== undefined) {
      setValue(initialValue)
    }
  }, [initialValue])

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed || loading || disabled) return
    onSend(trimmed)
    setValue('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
      <TextArea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoSize={{ minRows: 2, maxRows: 6 }}
        autoFocus={autoFocus}
        style={{
          flex: 1,
          resize: 'none',
          borderRadius: 10,
          border: '1px solid #e0e0e0',
          padding: '10px 14px',
          fontSize: 14,
          lineHeight: 1.6,
          background: '#fff',
          transition: 'border-color 0.2s, box-shadow 0.2s',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = '#4E7BF5'
          e.currentTarget.style.boxShadow = '0 0 0 2px rgba(78, 123, 245, 0.08)'
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = '#e0e0e0'
          e.currentTarget.style.boxShadow = 'none'
        }}
        disabled={disabled}
      />
      <Button
        type="primary"
        icon={<SendOutlined />}
        onClick={handleSend}
        loading={loading}
        disabled={!value.trim() || loading || disabled}
        style={{
          height: 44,
          minWidth: 96,
          borderRadius: 10,
          border: 'none',
          fontSize: 14,
          fontWeight: 500,
          background:
            !value.trim() || loading || disabled
              ? undefined
              : 'linear-gradient(135deg, #4E7BF5, #58B9FF)',
        }}
        onMouseEnter={(e) => {
          if (value.trim() && !loading && !disabled) {
            e.currentTarget.style.background =
              'linear-gradient(135deg, #3A6BE0, #4AADF0)'
          }
        }}
        onMouseLeave={(e) => {
          if (value.trim() && !loading && !disabled) {
            e.currentTarget.style.background =
              'linear-gradient(135deg, #4E7BF5, #58B9FF)'
          }
        }}
      >
        问数
      </Button>
    </div>
  )
}

export default AskInput
