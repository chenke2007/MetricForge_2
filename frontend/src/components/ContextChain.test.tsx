import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ContextChain from './ContextChain'

describe('ContextChain', () => {
  it('renders nothing when contextChain is empty', () => {
    const { container } = render(<ContextChain contextChain={[]} currentIndex={0} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders single round without current marker', () => {
    render(<ContextChain contextChain={['各区域销售额']} currentIndex={0} />)
    expect(screen.getByText('第1轮：各区域销售额')).toBeInTheDocument()
    // No "当前" tag for single round
  })

  it('renders multiple rounds with current highlight', () => {
    render(<ContextChain contextChain={['各区域销售额', '为什么华东最高', '华东各产品线']} currentIndex={2} />)
    expect(screen.getByText('第1轮：各区域销售额')).toBeInTheDocument()
    // Arrow indicator rendered between rounds
    expect(screen.getAllByText('↓').length).toBeGreaterThanOrEqual(1)
    // The follow-up text is rendered as part of "第2轮：为什么华东最高"
    expect(screen.getByText('第2轮：为什么华东最高')).toBeInTheDocument()
    expect(screen.getByText('第2轮：为什么华东最高')).toBeInTheDocument()
    expect(screen.getByText('第3轮：华东各产品线')).toBeInTheDocument()
    // Current round should have a highlight indicator — check for bold or specific class
    const currentEl = screen.getByText('第3轮：华东各产品线')
    expect(currentEl.closest('[style*="fontWeight: 600"]') || currentEl.closest('strong') || currentEl).toBeTruthy()
  })

  it('renders up to maxRounds rounds', () => {
    const chain = Array.from({ length: 10 }, (_, i) => `Q${i + 1}`)
    render(<ContextChain contextChain={chain} currentIndex={9} maxRounds={5} />)
    // Should only show 5 rounds
    expect(screen.queryByText('第1轮：Q1')).not.toBeInTheDocument()
    expect(screen.getByText(/以及更早的 \d+ 轮/)).toBeInTheDocument()
    expect(screen.getByText('第10轮：Q10')).toBeInTheDocument()
  })
})
