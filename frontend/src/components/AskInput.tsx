// frontend/src/components/AskInput.tsx
import React, { useState, useEffect } from 'react'
import { Input, Button, Typography } from 'antd'
import { SendOutlined } from '@ant-design/icons'
import { validateAiAskInput } from '../api/aiAsk'

const { TextArea } = Input
const { Text } = Typography

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
  const [inputError, setInputError] = useState<string | null>(null)

  useEffect(() => {
    if (initialValue !== undefined) {
      setValue(initialValue)
    }
  }, [initialValue])

  const handleValueChange = (next: string) => {
    setValue(next)
    const trimmed = next.trim()
    if (trimmed.length === 0) {
      setInputError(null)
      return
    }
    const validation = validateAiAskInput(trimmed)
    setInputError(validation.valid ? null : validation.error!.message)
  }

  const handleSend = () => {
    if (loading || disabled) return
    const trimmed = value.trim()
    const validation = validateAiAskInput(trimmed)
    if (!validation.valid) {
      // Keep the input visible so the user can see and fix it. Real-time validation
      // already shows the error for non-empty invalid input; whitespace-only input
      // intentionally shows no error here (minor #2 unchanged).
      return
    }
    onSend(trimmed)
    setValue('')
    setInputError(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <TextArea
          value={value}
          onChange={(e) => handleValueChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoSize={{ minRows: 2, maxRows: 6 }}
          autoFocus={autoFocus}
          style={{
            flex: 1,
            resize: 'none',
            borderRadius: 10,
            border: `1px solid ${inputError ? '#ff4d4f' : '#e0e0e0'}`,
            padding: '10px 14px',
            fontSize: 14,
            lineHeight: 1.6,
            background: '#fff',
            transition: 'border-color 0.2s, box-shadow 0.2s',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = inputError ? '#ff4d4f' : '#4E7BF5'
            e.currentTarget.style.boxShadow = inputError
              ? '0 0 0 2px rgba(255, 77, 79, 0.08)'
              : '0 0 0 2px rgba(78, 123, 245, 0.08)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = inputError ? '#ff4d4f' : '#e0e0e0'
            e.currentTarget.style.boxShadow = 'none'
          }}
          disabled={disabled}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={loading}
          disabled={loading || disabled}
          style={{
            height: 44,
            minWidth: 96,
            borderRadius: 10,
            border: 'none',
            fontSize: 14,
            fontWeight: 500,
            background:
              loading || disabled
                ? undefined
                : 'linear-gradient(135deg, #4E7BF5, #58B9FF)',
          }}
          onMouseEnter={(e) => {
            if (!loading && !disabled) {
              e.currentTarget.style.background =
                'linear-gradient(135deg, #3A6BE0, #4AADF0)'
            }
          }}
          onMouseLeave={(e) => {
            if (!loading && !disabled) {
              e.currentTarget.style.background =
                'linear-gradient(135deg, #4E7BF5, #58B9FF)'
            }
          }}
        >
          问数
        </Button>
      </div>
      {inputError && (
        <Text
          type="danger"
          style={{ display: 'block', marginTop: 6, fontSize: 13 }}
        >
          {inputError}
        </Text>
      )}
    </div>
  )
}

export default AskInput
