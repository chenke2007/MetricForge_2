import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import IntentCard from './IntentCard'

describe('IntentCard', () => {
  const defaultIntent = {
    metrics: ['销售额', '毛利率'],
    dimensions: ['区域'],
    filters: [],
    timeRange: '近 30 天',
  }

  it('renders intent title', () => {
    render(<IntentCard intent={defaultIntent} semanticGaps={[]} />)
    expect(screen.getByText('AI 理解到的分析意图')).toBeInTheDocument()
  })

  it('renders metrics tags', () => {
    render(<IntentCard intent={defaultIntent} semanticGaps={[]} />)
    expect(screen.getByText('销售额')).toBeInTheDocument()
    expect(screen.getByText('毛利率')).toBeInTheDocument()
  })

  it('renders dimensions tags', () => {
    render(<IntentCard intent={defaultIntent} semanticGaps={[]} />)
    expect(screen.getByText('区域')).toBeInTheDocument()
  })

  it('renders time range tag', () => {
    render(<IntentCard intent={defaultIntent} semanticGaps={[]} />)
    expect(screen.getByText('近 30 天')).toBeInTheDocument()
  })

  it('renders filter tags when present', () => {
    const intentWithFilters = {
      ...defaultIntent,
      filters: ['收入 > 10000', '区域=华东'],
    }
    render(<IntentCard intent={intentWithFilters} semanticGaps={[]} />)
    expect(screen.getByText('收入 > 10000')).toBeInTheDocument()
    expect(screen.getByText('区域=华东')).toBeInTheDocument()
  })

  it('renders semantic gap warnings', () => {
    const gaps = [
      { field: '毛利率', reason: 'ambiguous' as const, candidates: ['GROSS_MARGIN_RATE'], suggestion: '如不准确请修正' },
    ]
    render(<IntentCard intent={defaultIntent} semanticGaps={gaps} />)
    // 毛利率 appears in both metric tag and gap section; use getAllByText
    const matches = screen.getAllByText(/毛利率/)
    expect(matches.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/GROSS_MARGIN_RATE/)).toBeInTheDocument()
  })

  it('shows empty state when no intent info', () => {
    const emptyIntent = { metrics: [], dimensions: [], filters: [], timeRange: undefined }
    render(<IntentCard intent={emptyIntent} semanticGaps={[]} />)
    expect(screen.getByText('暂无意图信息')).toBeInTheDocument()
  })
})
