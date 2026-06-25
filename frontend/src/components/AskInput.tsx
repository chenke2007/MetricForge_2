import React, { useState } from 'react'
import { Input, Button } from 'antd'
import { SendOutlined } from '@ant-design/icons'

const { TextArea } = Input

interface AskInputProps {
  onSend: (content: string) => void
  loading?: boolean
}

const AskInput: React.FC<AskInputProps> = ({ onSend, loading }) => {
  const [value, setValue] = useState('')

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed || loading) return
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
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <TextArea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入你的问题，例如：近30天新增客户数是多少？"
        autoSize={{ minRows: 2, maxRows: 6 }}
        style={{ flex: 1, resize: 'none' }}
      />
      <Button
        type="primary"
        icon={<SendOutlined />}
        onClick={handleSend}
        loading={loading}
        disabled={!value.trim() || loading}
        style={{ height: 40, minWidth: 80 }}
      >
        发送
      </Button>
    </div>
  )
}

export default AskInput
