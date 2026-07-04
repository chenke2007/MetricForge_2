import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PromptCards from './PromptCards'

describe('PromptCards', () => {
  it('renders all 6 business prompts', () => {
    render(<PromptCards onSelect={() => {}} />)
    expect(screen.getByText('本月各区域收入排名')).toBeInTheDocument()
    expect(screen.getByText('近 7 天核心指标趋势')).toBeInTheDocument()
    expect(screen.getByText('上季度毛利率 Top 5 产品线')).toBeInTheDocument()
    expect(screen.getByText('逾期订单风险预警')).toBeInTheDocument()
    expect(screen.getByText('月度经营分析简报')).toBeInTheDocument()
    expect(screen.getByText('客户分层与复购分析')).toBeInTheDocument()
  })

  it('renders description text for each prompt', () => {
    render(<PromptCards onSelect={() => {}} />)
    expect(screen.getByText('查看当月各区域的营收表现和排名变化')).toBeInTheDocument()
    expect(screen.getByText('销售额、订单量、客单价日环比变化')).toBeInTheDocument()
  })

  it('renders "试试这样问" header', () => {
    render(<PromptCards onSelect={() => {}} />)
    expect(screen.getByText('试试这样问')).toBeInTheDocument()
  })

  it('calls onSelect with prompt title when card clicked', () => {
    const onSelect = vi.fn()
    render(<PromptCards onSelect={onSelect} />)
    fireEvent.click(screen.getByText('逾期订单风险预警'))
    expect(onSelect).toHaveBeenCalledWith('逾期订单风险预警')
  })

  it('returns null when activeSession is true', () => {
    const { container } = render(<PromptCards onSelect={() => {}} activeSession />)
    expect(container.innerHTML).toBe('')
  })
})
