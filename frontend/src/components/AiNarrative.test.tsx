import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AiNarrative from './AiNarrative'
import type { FollowUpType } from '../types/aiAsk'

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

// --- Phase 5H: Enhanced narrative rendering ---

describe('AiNarrative enhanced rendering', () => {
  const enhancedNarrative = {
    summary: '近 30 天各区域销售额呈增长趋势，华东区域以 12.3M 领跑',
    keyFindings: ['华东区域销售额 12.3M', '华北区域毛利率 35.1%'],
    evidence: [
      { claim: '华东领先', fields: ['region', 'total_revenue'], value: '12.3M', significance: '占比 29.4%' },
      { claim: '华北高毛利', fields: ['region', 'margin'], value: '35.1%', significance: '各区域最高' },
    ],
    risks: [
      { risk: '数据仅覆盖 30 天', impact: '季节波动可能被忽视', suggestion: '建议查看 6 个月数据' },
    ],
    nextQuestions: [
      { question: '为什么华东订单数下降？', followUpType: 'why_down' as FollowUpType, contextHint: '基于华东数据继续分析' },
      { question: '按产品线拆销售额', followUpType: 'drill_down' as FollowUpType },
    ],
    conclusion: '华东区域应作为重点深耕市场，贡献近 30% 收入但近期订单数下降 3.2%。',
  }

  it('renders conclusion section when present', () => {
    render(<AiNarrative narrative={enhancedNarrative} />)
    expect(screen.getByText('结论')).toBeInTheDocument()
    expect(screen.getByText(/华东区域应作为重点深耕市场/)).toBeInTheDocument()
  })

  it('renders evidence with value and significance', () => {
    render(<AiNarrative narrative={enhancedNarrative} />)
    // "12.3M" appears in summary + keyFindings + evidence, so use getAllByText
    expect(screen.getAllByText(/12.3M/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/占比 29.4%/)).toBeInTheDocument()
  })

  it('renders structured risks with impact and suggestion', () => {
    render(<AiNarrative narrative={enhancedNarrative} />)
    expect(screen.getByText(/季节波动可能被忽视/)).toBeInTheDocument()
    expect(screen.getByText(/建议查看 6 个月数据/)).toBeInTheDocument()
  })

  it('renders nextQuestions with followUpType label', () => {
    render(<AiNarrative narrative={enhancedNarrative} />)
    expect(screen.getByText('🔍 为什么华东订单数下降？')).toBeInTheDocument()
    expect(screen.getByText('🔽 按产品线拆销售额')).toBeInTheDocument()
  })

  it('does not render conclusion when absent (backward compat)', () => {
    const oldFormat = {
      summary: 'summary', keyFindings: [], evidence: [],
      risks: ['旧格式风险'], nextQuestions: ['为什么'],
    }
    render(<AiNarrative narrative={oldFormat} />)
    expect(screen.queryByText('结论')).not.toBeInTheDocument()
    // Old format risks still render (with bullet prefix)
    expect(screen.getByText(/旧格式风险/)).toBeInTheDocument()
    // Old format nextQuestions still render as plain text
    expect(screen.getByText('为什么')).toBeInTheDocument()
  })

  it('renders old format risks (string[])', () => {
    const oldFormat = {
      summary: 's', keyFindings: [], evidence: [],
      risks: ['仅覆盖 30 天'], nextQuestions: [],
    }
    render(<AiNarrative narrative={oldFormat} />)
    // Old format risks render as "• {risk}" — use regex matcher
    expect(screen.getByText(/仅覆盖 30 天/)).toBeInTheDocument()
  })

  it('renders old format nextQuestions (string[])', () => {
    const oldFormat = {
      summary: 's', keyFindings: [], evidence: [],
      risks: [], nextQuestions: ['随便问问'],
    }
    render(<AiNarrative narrative={oldFormat} />)
    expect(screen.getByText('随便问问')).toBeInTheDocument()
  })

  it('renders empty evidence section when evidence has no value/significance (old format)', () => {
    const oldEvidence = {
      summary: 's', keyFindings: [], evidence: [
        { claim: '基本断言', fields: ['a'] },
      ],
      risks: [], nextQuestions: [],
    }
    render(<AiNarrative narrative={oldEvidence} />)
    expect(screen.getByText('基本断言')).toBeInTheDocument()
  })

  it('calls onAskQuestion with exact question text from NextQuestion', () => {
    const onAsk = vi.fn()
    render(<AiNarrative narrative={enhancedNarrative} onAskQuestion={onAsk} />)
    fireEvent.click(screen.getByText('🔍 为什么华东订单数下降？'))
    expect(onAsk).toHaveBeenCalledWith('为什么华东订单数下降？')
  })
})
