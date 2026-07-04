import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SemanticGapAlert from './SemanticGapAlert'

describe('SemanticGapAlert', () => {
  it('returns null when no gaps', () => {
    const { container } = render(<SemanticGapAlert gaps={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('returns null when only ambiguous gaps', () => {
    const { container } = render(
      <SemanticGapAlert gaps={[{ field: 'x', reason: 'ambiguous' as const }]} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('returns null when only incomplete gaps', () => {
    const { container } = render(
      <SemanticGapAlert gaps={[{ field: 'x', reason: 'incomplete' as const }]} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders alert for not_found gaps', () => {
    const gaps = [
      { field: '客户等级', reason: 'not_found' as const, candidates: ['CUSTOMER.LEVEL', 'CUSTOMER.TIER'] },
    ]
    render(<SemanticGapAlert gaps={gaps} />)
    expect(screen.getByText(/客户等级/)).toBeInTheDocument()
    expect(screen.getByText(/无法确认/)).toBeInTheDocument()
    expect(screen.getByText(/CUSTOMER.LEVEL/)).toBeInTheDocument()
  })

  it('renders governance button when onNavigateToGovernance provided', () => {
    const gaps = [
      { field: '客户等级', reason: 'not_found' as const, candidates: ['CUSTOMER.LEVEL'] },
    ]
    render(<SemanticGapAlert gaps={gaps} onNavigateToGovernance={vi.fn()} />)
    expect(screen.getByText('前往治理待办完善语义')).toBeInTheDocument()
  })

  it('calls onNavigateToGovernance when button clicked', () => {
    const onNavigate = vi.fn()
    const gaps = [
      { field: '客户等级', reason: 'not_found' as const, candidates: ['CUSTOMER.LEVEL'] },
    ]
    render(<SemanticGapAlert gaps={gaps} onNavigateToGovernance={onNavigate} />)
    fireEvent.click(screen.getByText('前往治理待办完善语义'))
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('handles multiple not_found gaps', () => {
    const gaps = [
      { field: '客户等级', reason: 'not_found' as const },
      { field: '产品类别', reason: 'not_found' as const, candidates: ['PRODUCT.CATEGORY'] },
    ]
    render(<SemanticGapAlert gaps={gaps} />)
    expect(screen.getByText(/客户等级/)).toBeInTheDocument()
    expect(screen.getByText(/产品类别/)).toBeInTheDocument()
  })
})
