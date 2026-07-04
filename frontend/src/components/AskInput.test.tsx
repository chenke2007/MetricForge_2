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

  it('calls onSend and clears input on send', () => {
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

  it('disables send button when input is empty', () => {
    render(<AskInput onSend={() => {}} />)
    const button = screen.getByText('问数').closest('button')
    expect(button).toBeDisabled()
  })

  it('enables send button when input has text', () => {
    render(<AskInput onSend={() => {}} />)
    const textarea = screen.getByPlaceholderText(/用自然语言描述/)
    fireEvent.change(textarea, { target: { value: 'something' } })
    const button = screen.getByText('问数').closest('button')
    expect(button).not.toBeDisabled()
  })
})
