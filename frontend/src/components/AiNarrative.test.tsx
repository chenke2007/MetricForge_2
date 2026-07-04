import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AiNarrative from './AiNarrative'

const mockNarrative = {
  summary: '近 30 天各区域销售额呈增长趋势，华东区域以 12.3M 领跑',
  keyFindings: [
    '华东区域销售额 12.3M，领先第二名华南 25.5%',
    '华北区域毛利率 35.1%，为所有区域最高',
  ],
  evidence: [],
  risks: ['仅覆盖 30 天数据，不反映长期趋势'],
  nextQuestions: ['为什么华东区域订单数下降？', '近 6 个月各区域毛利率趋势如何？'],
}

describe('AiNarrative', () => {
  it('renders title', () => {
    render(<AiNarrative narrative={mockNarrative} />)
    expect(screen.getByText('AI 解读')).toBeInTheDocument()
  })

  it('renders summary text', () => {
    render(<AiNarrative narrative={mockNarrative} />)
    expect(screen.getByText(/近 30 天各区域销售额呈增长趋势/)).toBeInTheDocument()
  })

  it('renders key findings', () => {
    render(<AiNarrative narrative={mockNarrative} />)
    expect(screen.getByText(/华东区域销售额 12.3M/)).toBeInTheDocument()
    expect(screen.getByText(/华北区域毛利率 35.1%/)).toBeInTheDocument()
  })

  it('renders risk section', () => {
    render(<AiNarrative narrative={mockNarrative} />)
    expect(screen.getByText('⚠ 数据说明')).toBeInTheDocument()
    expect(screen.getByText(/仅覆盖 30 天数据/)).toBeInTheDocument()
  })

  it('renders next questions', () => {
    render(<AiNarrative narrative={mockNarrative} />)
    expect(screen.getByText('后续可以追问')).toBeInTheDocument()
    expect(screen.getByText('为什么华东区域订单数下降？')).toBeInTheDocument()
    expect(screen.getByText('近 6 个月各区域毛利率趋势如何？')).toBeInTheDocument()
  })

  it('calls onAskQuestion when next question clicked', () => {
    const onAsk = vi.fn()
    render(<AiNarrative narrative={mockNarrative} onAskQuestion={onAsk} />)
    fireEvent.click(screen.getByText('为什么华东区域订单数下降？'))
    expect(onAsk).toHaveBeenCalledWith('为什么华东区域订单数下降？')
  })

  it('shows empty state when no narrative content', () => {
    const empty = { summary: '', keyFindings: [], evidence: [], risks: [], nextQuestions: [] }
    render(<AiNarrative narrative={empty} />)
    expect(screen.getByText('暂无解读内容')).toBeInTheDocument()
  })
})
