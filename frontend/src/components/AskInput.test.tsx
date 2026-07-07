// frontend/src/components/AskInput.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AskInput from './AskInput'

describe('AskInput', () => {
  it('renders textarea and send button', () => {
    render(<AskInput onSend={() => {}} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述你的业务问题/)
    expect(textarea).toBeInTheDocument()
    expect(screen.getByText('问数')).toBeInTheDocument()
  })

  it('renders custom placeholder', () => {
    render(<AskInput onSend={() => {}} placeholder="自定义占位文本" />)
    expect(screen.getByPlaceholderText('自定义占位文本')).toBeInTheDocument()
  })

  it('shows initial value when provided', () => {
    render(<AskInput onSend={() => {}} initialValue="上季度收入" />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    expect((textarea as HTMLTextAreaElement).value).toBe('上季度收入')
  })

  it('calls onSend and clears input on valid send', () => {
    const onSend = vi.fn()
    render(<AskInput onSend={onSend} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: '近 7 天销量' } })
    fireEvent.click(screen.getByText('问数'))
    expect(onSend).toHaveBeenCalledWith('近 7 天销量')
    expect((textarea as HTMLTextAreaElement).value).toBe('')
  })

  it('sends on Enter without Shift', () => {
    const onSend = vi.fn()
    render(<AskInput onSend={onSend} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: '本月收入' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
    expect(onSend).toHaveBeenCalledWith('本月收入')
  })

  it('does not send when loading', () => {
    const onSend = vi.fn()
    render(<AskInput onSend={onSend} loading />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: 'test' } })
    fireEvent.click(screen.getByText('问数'))
    expect(onSend).not.toHaveBeenCalled()
  })

  it('does not disable send button based on input content', () => {
    render(<AskInput onSend={() => {}} />)
    const button = screen.getByText('问数').closest('button')
    expect(button).not.toBeDisabled()
  })

  it('does not call onSend and keeps input when validation fails', () => {
    const onSend = vi.fn()
    render(<AskInput onSend={onSend} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: '，，！' } })
    fireEvent.click(screen.getByText('问数'))
    expect(onSend).not.toHaveBeenCalled()
    expect((textarea as HTMLTextAreaElement).value).toBe('，，！')
  })

  it('does not send or clear whitespace-only input', () => {
    const onSend = vi.fn()
    render(<AskInput onSend={onSend} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: '   ' } })
    fireEvent.click(screen.getByText('问数'))
    expect(onSend).not.toHaveBeenCalled()
    expect((textarea as HTMLTextAreaElement).value).toBe('   ')
  })

  it('submits trimmed value when valid input is wrapped in whitespace', () => {
    const onSend = vi.fn()
    render(<AskInput onSend={onSend} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: '  近 7 天销量  ' } })
    fireEvent.click(screen.getByText('问数'))
    expect(onSend).toHaveBeenCalledWith('近 7 天销量')
    expect((textarea as HTMLTextAreaElement).value).toBe('')
  })

  it('does not treat leading/trailing whitespace as exceeding max length', () => {
    const onSend = vi.fn()
    render(<AskInput onSend={onSend} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    const base = 'a'.repeat(1000)
    fireEvent.change(textarea, { target: { value: `  ${base}  ` } })
    fireEvent.click(screen.getByText('问数'))
    expect(onSend).toHaveBeenCalledWith(base)
    expect(screen.queryByText(/缩短到 1000 字以内/)).not.toBeInTheDocument()
  })

  it('shows TOO_LONG when trimmed content exceeds max length', () => {
    render(<AskInput onSend={() => {}} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: `  ${'a'.repeat(1001)}  ` } })
    expect(screen.getByText(/缩短到 1000 字以内/)).toBeInTheDocument()
  })

  it('shows real-time error for punctuation-only input', () => {
    render(<AskInput onSend={() => {}} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: '，，！' } })
    expect(screen.getByText(/不能仅包含标点或符号/)).toBeInTheDocument()
  })

  it('shows real-time error for too-long input', () => {
    render(<AskInput onSend={() => {}} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: 'a'.repeat(1001) } })
    expect(screen.getByText(/缩短到 1000 字以内/)).toBeInTheDocument()
  })

  it('shows real-time error for input with invalid control characters', () => {
    render(<AskInput onSend={() => {}} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: 'test' } })
    expect(screen.getByText(/输入包含无效字符/)).toBeInTheDocument()
  })

  it('clears real-time error when input becomes valid', () => {
    render(<AskInput onSend={() => {}} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: '，，！' } })
    expect(screen.getByText(/不能仅包含标点或符号/)).toBeInTheDocument()
    fireEvent.change(textarea, { target: { value: '各区域销售额' } })
    expect(screen.queryByText(/不能仅包含标点或符号/)).not.toBeInTheDocument()
  })
})
