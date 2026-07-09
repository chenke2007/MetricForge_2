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

// --- Phase 5J: Evidence chain progressive disclosure ---

describe('AiNarrative evidence chain (Phase 5J)', () => {
  const evidenceNarrative = {
    summary: '测试摘要',
    keyFindings: ['发现 1'],
    evidence: [
      {
        claim: '华东领先',
        fields: ['region', 'total_revenue'],
        value: '¥12.3M',
        significance: '占比 29.4%',
        sourceFields: ['r.region', 'r.amount'],
        calculation: 'SUM(r.amount) GROUP BY region',
        confidence: 'high' as const,
        confidenceReason: '数据覆盖 30 天',
        displayValue: '¥12.3M (29.4%)',
      },
      {
        claim: '华东下降',
        fields: ['region', 'revenue'],
        value: '¥5.2M',
        significance: '环比下降 18.5%',
        sourceFields: ['r.region', 'r.amount'],
        calculation: 'SUM(r.amount) GROUP BY region',
        confidence: 'low' as const,
        confidenceReason: '数据窗口较窄',
        displayValue: '¥5.2M (-18.5%)',
      },
    ],
    risks: [],
    nextQuestions: [],
  }

  it('renders evidence summary when present', () => {
    const withSummary = { ...evidenceNarrative, evidenceSummary: '以下结论基于近 30 天 REVENUE 表数据。' }
    render(<AiNarrative narrative={withSummary} />)
    expect(screen.getByText(/以下结论基于近 30 天 REVENUE 表数据/)).toBeInTheDocument()
  })

  it('does not render evidence summary when absent (backward compat)', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    expect(screen.queryByText(/证据来源/)).not.toBeInTheDocument()
  })

  it('renders evidence with displayValue when present', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    // displayValue renders inside a span with " — " prefix, so use regex
    expect(screen.getByText(/¥12\.3M.*29\.4%/)).toBeInTheDocument()
  })

  it('shows "查看证据" button per evidence item', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    const buttons = screen.getAllByText('查看证据 ▼')
    expect(buttons).toHaveLength(2)
  })

  it('expands evidence detail on click', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    fireEvent.click(screen.getAllByText('查看证据 ▼')[0])
    // After clicking, detail content should be visible
    // The expanded panel shows "字段：r.region, r.amount（业务名：region, total_revenue）"
    expect(screen.getByText(/r\.region, r\.amount/)).toBeInTheDocument()
    expect(screen.getByText(/SUM\(r.amount\) GROUP BY region/)).toBeInTheDocument()
  })

  it('collapses evidence detail on second click', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    fireEvent.click(screen.getAllByText('查看证据 ▼')[0])
    expect(screen.getByText(/r\.region, r\.amount/)).toBeInTheDocument()
    // After expanding, the button text changes to "收起证据 ▲"
    fireEvent.click(screen.getByText('收起证据 ▲'))
    expect(screen.queryByText(/r\.region, r\.amount/)).not.toBeInTheDocument()
  })

  it('expands only the clicked evidence item', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    fireEvent.click(screen.getAllByText('查看证据 ▼')[0])
    // First evidence detail should be visible
    expect(screen.getByText(/r\.region, r\.amount/)).toBeInTheDocument()
    expect(screen.getByText(/SUM\(r.amount\) GROUP BY region/)).toBeInTheDocument()
    // Click second evidence's "查看证据" button (there's still one left)
    fireEvent.click(screen.getAllByText('查看证据 ▼')[0])
    // Both should be visible now (independent expand) — two calculation sections
    const calcTexts = screen.getAllByText(/SUM\(r\.amount\) GROUP BY region/)
    expect(calcTexts.length).toBe(2)
  })

  it('shows high confidence indicator in evidence row', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    // ✅ appears for high confidence evidence
    expect(screen.getAllByText(/✅/).length).toBeGreaterThanOrEqual(1)
  })

  it('renders old format evidence (no Phase 5J fields) without error', () => {
    const oldEvidenceNarrative = {
      summary: '旧格式',
      keyFindings: [],
      evidence: [
        { claim: '旧断言', fields: ['a'] },
      ],
      risks: [],
      nextQuestions: [],
    }
    render(<AiNarrative narrative={oldEvidenceNarrative} />)
    expect(screen.getByText('旧断言')).toBeInTheDocument()
    // No "查看证据" button for old format evidence without sourceFields
    expect(screen.queryByText('查看证据')).not.toBeInTheDocument()
  })

  it('does not crash with empty evidence array', () => {
    const emptyEvidence = { summary: 's', keyFindings: [], evidence: [], risks: [], nextQuestions: [] }
    render(<AiNarrative narrative={emptyEvidence} />)
    expect(screen.getByText(/s/)).toBeInTheDocument()
  })

  it('shows confidence reason in expanded detail', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    fireEvent.click(screen.getAllByText('查看证据 ▼')[0])
    expect(screen.getByText(/数据覆盖 30 天/)).toBeInTheDocument()
  })

  it('shows calculation in expanded detail', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    fireEvent.click(screen.getAllByText('查看证据 ▼')[0])
    expect(screen.getByText(/SUM\(r.amount\) GROUP BY region/)).toBeInTheDocument()
  })

  it('shows sourceFields in expanded detail', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    fireEvent.click(screen.getAllByText('查看证据 ▼')[0])
    expect(screen.getByText(/r.region, r.amount/)).toBeInTheDocument()
  })

  it('renders confidence icon based on confidence level', () => {
    render(<AiNarrative narrative={evidenceNarrative} />)
    // "高" for high confidence, "低" for low confidence should appear
    // The first evidence is high confidence, second is low
    // Both have display values so both show confidence indicators
    const highIndicators = screen.getAllByText(/✅/)
    expect(highIndicators.length).toBeGreaterThanOrEqual(1)
  })
})

// --- Phase 5M: Narrative Trust UI ---

describe('AiNarrative Phase 5M Narrative Trust', () => {
  const fullNarrative = {
    summary: '分析口径：按区域汇总近 30 天销售数据',
    keyFindings: ['华东区域销售额 12.3M'],
    evidence: [
      { claim: '华东领先', fields: ['region', 'total_revenue'], value: '12.3M' },
    ],
    risks: ['仅覆盖 30 天'],
    nextQuestions: ['为什么华东订单数下降？'],
    conclusion: '华东区域应作为重点市场。',
  }

  it('hides keyFindings when narrativeLevel is sql_pending (even if data exists)', () => {
    render(<AiNarrative narrative={fullNarrative} narrativeLevel="sql_pending" />)
    expect(screen.queryByText(/华东区域销售额 12\.3M/)).not.toBeInTheDocument()
  })

  it('hides evidence when narrativeLevel is sql_pending', () => {
    render(<AiNarrative narrative={fullNarrative} narrativeLevel="sql_pending" />)
    expect(screen.queryByText('证据')).not.toBeInTheDocument()
  })

  it('hides conclusion when narrativeLevel is sql_pending', () => {
    render(<AiNarrative narrative={fullNarrative} narrativeLevel="sql_pending" />)
    expect(screen.queryByText('结论')).not.toBeInTheDocument()
  })

  it('shows summary when narrativeLevel is sql_pending', () => {
    render(<AiNarrative narrative={fullNarrative} narrativeLevel="sql_pending" />)
    expect(screen.getByText(/分析口径/)).toBeInTheDocument()
  })

  it('shows risks when narrativeLevel is sql_pending', () => {
    render(<AiNarrative narrative={fullNarrative} narrativeLevel="sql_pending" />)
    expect(screen.getByText(/仅覆盖 30 天/)).toBeInTheDocument()
  })

  it('shows nextQuestions when narrativeLevel is sql_pending', () => {
    render(<AiNarrative narrative={fullNarrative} narrativeLevel="sql_pending" />)
    expect(screen.getByText('为什么华东订单数下降？')).toBeInTheDocument()
  })

  it('shows all content when narrativeLevel is executed', () => {
    render(<AiNarrative narrative={fullNarrative} narrativeLevel="executed" />)
    expect(screen.getByText(/华东区域销售额 12\.3M/)).toBeInTheDocument()
    expect(screen.getByText('证据')).toBeInTheDocument()
    expect(screen.getByText('结论')).toBeInTheDocument()
    expect(screen.getByText(/分析口径/)).toBeInTheDocument()
    expect(screen.getByText(/仅覆盖 30 天/)).toBeInTheDocument()
  })

  it('shows all content when narrativeLevel is undefined (backward compat)', () => {
    render(<AiNarrative narrative={fullNarrative} />)
    expect(screen.getByText(/华东区域销售额 12\.3M/)).toBeInTheDocument()
    expect(screen.getByText('证据')).toBeInTheDocument()
    expect(screen.getByText('结论')).toBeInTheDocument()
  })

  it('forces empty keyFindings even when backend sends spurious data in sql_pending', () => {
    // Simulate backend sending data despite sql_pending
    const spuriousNarrative = {
      summary: '口径说明',
      keyFindings: ['后端错误返回的发现'],
      evidence: [{ claim: '后端错误返回的证据', fields: ['x'] }],
      risks: ['风险说明'],
      nextQuestions: ['追问？'],
      conclusion: '后端错误返回的结论',
    }
    render(<AiNarrative narrative={spuriousNarrative} narrativeLevel="sql_pending" />)
    // Frontend must protect — hide all fact-claiming sections
    expect(screen.queryByText('后端错误返回的发现')).not.toBeInTheDocument()
    expect(screen.queryByText('证据')).not.toBeInTheDocument()
    expect(screen.queryByText('结论')).not.toBeInTheDocument()
    // Still show safe sections
    expect(screen.getByText(/口径说明/)).toBeInTheDocument()
    expect(screen.getByText(/风险说明/)).toBeInTheDocument()
    expect(screen.getByText('追问？')).toBeInTheDocument()
  })
})
