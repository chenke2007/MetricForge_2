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

// --- Phase 5J: mappingChain ---

describe('ProcessPanel mappingChain (Phase 5J)', () => {
  const processWithChain: ProcessInsight = {
    understoodMetrics: ['销售额'],
    understoodDimensions: ['区域'],
    understoodTimeRange: '近 30 天',
    understoodFilters: [],
    semanticGaps: [],
    analysisStrategy: '按区域分组汇总',
    mappingChain: [
      { step: 'intent', label: '识别意图：销售额×区域', detail: '用户查询各区域销售额', fields: ['region', 'total_revenue'] },
      { step: 'sql_plan', label: '生成查询计划', detail: 'FROM REVENUE GROUP BY region', fields: ['region', 'amount'] },
      { step: 'result', label: '查询结果', detail: '共 6 行数据', fields: [] },
      { step: 'conclusion', label: '生成结论', detail: '华东领先 ¥12.3M (29.4%)', fields: [] },
    ],
  }

  it('renders mapping chain section when expanded and mappingChain present', () => {
    render(<ProcessPanel process={processWithChain} />)
    fireEvent.click(screen.getByText(/AI 理解过程/))
    expect(screen.getByText(/分析链路/)).toBeInTheDocument()
  })

  it('shows all 4 mapping steps in order', () => {
    render(<ProcessPanel process={processWithChain} />)
    fireEvent.click(screen.getByText(/AI 理解过程/))
    expect(screen.getByText(/识别意图：销售额×区域/)).toBeInTheDocument()
    expect(screen.getByText(/生成查询计划/)).toBeInTheDocument()
    expect(screen.getByText(/共 6 行数据/)).toBeInTheDocument()
    expect(screen.getByText(/华东领先 ¥12.3M/)).toBeInTheDocument()
  })

  it('does not show mapping chain when absent (backward compat)', () => {
    const noChain: ProcessInsight = {
      understoodMetrics: ['销售额'], understoodDimensions: ['区域'],
      understoodTimeRange: '近 30 天', understoodFilters: [],
      semanticGaps: [],
    }
    render(<ProcessPanel process={noChain} />)
    fireEvent.click(screen.getByText(/AI 理解过程/))
    expect(screen.queryByText('分析链路')).not.toBeInTheDocument()
  })

  it('renders empty state for process with empty mappingChain', () => {
    const emptyChain: ProcessInsight = {
      understoodMetrics: [], understoodDimensions: [],
      understoodTimeRange: undefined, understoodFilters: [],
      semanticGaps: [], mappingChain: [],
    }
    render(<ProcessPanel process={emptyChain} />)
    fireEvent.click(screen.getByText(/AI 理解过程/))
    expect(screen.queryByText('分析链路')).not.toBeInTheDocument()
  })

  it('does not crash when mappingChain is undefined', () => {
    const noChain: ProcessInsight = {
      understoodMetrics: ['a'], understoodDimensions: [],
      understoodTimeRange: undefined, understoodFilters: [],
      semanticGaps: [],
    }
    render(<ProcessPanel process={noChain} />)
    fireEvent.click(screen.getByText(/AI 理解过程/))
    expect(screen.getByText(/指标：a/)).toBeInTheDocument()
  })
})
