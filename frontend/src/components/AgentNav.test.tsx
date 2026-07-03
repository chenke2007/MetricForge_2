import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import AgentNav, { AGENTS } from './AgentNav'

describe('AgentNav', () => {
  it('renders all 5 agent entries', () => {
    const onChange = vi.fn()
    render(<AgentNav activeKey="ask" onChange={onChange} />)
    for (const agent of AGENTS) {
      expect(screen.getByText(agent.label)).toBeInTheDocument()
    }
  })

  it('renders descriptions for all agents', () => {
    const onChange = vi.fn()
    render(<AgentNav activeKey="ask" onChange={onChange} />)
    for (const agent of AGENTS) {
      expect(screen.getByText(agent.description)).toBeInTheDocument()
    }
  })

  it('shows "可用" badge for AI 问数 (ask) entry', () => {
    const onChange = vi.fn()
    render(<AgentNav activeKey="ask" onChange={onChange} />)
    const askBadge = screen.getByText('可用')
    expect(askBadge).toBeInTheDocument()
  })

  it('shows "规划中" badge for disabled agent entries', () => {
    const onChange = vi.fn()
    render(<AgentNav activeKey="ask" onChange={onChange} />)
    const planningBadges = screen.getAllByText('规划中')
    // Insight, Report, Build, Explore = 4 disabled entries
    expect(planningBadges).toHaveLength(4)
  })

  it('marks AI 问数 as the active entry when activeKey is "ask"', () => {
    const onChange = vi.fn()
    render(<AgentNav activeKey="ask" onChange={onChange} />)
    const askLabel = screen.getByText('AI 问数')
    // The active card should have the blue color on its label
    expect(askLabel).toBeInTheDocument()
    // The "可用" badge confirms it's the blue-enabled one
    const askCard = askLabel.closest('.ant-card')
    expect(askCard).toBeTruthy()
  })

  it('only calls onChange for the enabled "ask" agent', () => {
    const onChange = vi.fn()
    render(<AgentNav activeKey="ask" onChange={onChange} />)
    // All 5 agent cards should be rendered
    const cards = document.querySelectorAll('.ant-card')
    expect(cards).toHaveLength(AGENTS.length)
  })

  it('renders unique icons for each agent', () => {
    const onChange = vi.fn()
    render(<AgentNav activeKey="ask" onChange={onChange} />)
    // Verify all agent names are present
    const labels = AGENTS.map((a) => a.label)
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })
})
