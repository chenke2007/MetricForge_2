import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ProcessPanel from './ProcessPanel'
import type { ProcessInsight } from '../types/aiAsk'

describe('ProcessPanel', () => {
  const mockProcess: ProcessInsight = {
    understoodMetrics: ['销售额', '订单数'],
    understoodDimensions: ['区域'],
    understoodTimeRange: '近 30 天',
    understoodFilters: [],
    semanticGaps: [
      { field: '毛利率', candidates: ['GROSS_MARGIN_RATE'], severity: 'low' },
    ],
    analysisStrategy: '按区域分组汇总销售额，排序展示',
    contextChain: ['各区域销售额', '为什么华东最高'],
  }

  it('renders trigger button when collapsed', () => {
    render(<ProcessPanel process={mockProcess} />)
    expect(screen.getByText(/AI 理解过程/)).toBeInTheDocument()
    // Content should not be visible
    expect(screen.queryByText('销售额')).not.toBeInTheDocument()
  })

  it('expands to show process details when clicked', () => {
    render(<ProcessPanel process={mockProcess} />)
    fireEvent.click(screen.getByText(/AI 理解过程/))
    expect(screen.getByText(/指标：销售额、订单数/)).toBeInTheDocument()
    expect(screen.getByText(/维度：区域/)).toBeInTheDocument()
    expect(screen.getByText(/时间：近 30 天/)).toBeInTheDocument()
  })

  it('shows semantic gaps when expanded', () => {
    render(<ProcessPanel process={mockProcess} />)
    fireEvent.click(screen.getByText(/AI 理解过程/))
    expect(screen.getByText(/毛利率/)).toBeInTheDocument()
    expect(screen.getByText(/GROSS_MARGIN_RATE/)).toBeInTheDocument()
  })

  it('shows analysis strategy when expanded', () => {
    render(<ProcessPanel process={mockProcess} />)
    fireEvent.click(screen.getByText(/AI 理解过程/))
    expect(screen.getByText(/按区域分组汇总/)).toBeInTheDocument()
  })

  it('shows context chain when expanded', () => {
    render(<ProcessPanel process={mockProcess} />)
    fireEvent.click(screen.getByText(/AI 理解过程/))
    expect(screen.getByText(/对话链路/)).toBeInTheDocument()
    expect(screen.getByText(/各区域销售额/)).toBeInTheDocument()
    expect(screen.getByText(/为什么华东最高/)).toBeInTheDocument()
  })

  it('renders empty state for empty process', () => {
    const empty: ProcessInsight = {
      understoodMetrics: [], understoodDimensions: [],
      understoodTimeRange: undefined, understoodFilters: [],
      semanticGaps: [],
    }
    render(<ProcessPanel process={empty} />)
    fireEvent.click(screen.getByText(/AI 理解过程/))
    expect(screen.getByText(/暂无过程信息/)).toBeInTheDocument()
  })
})
