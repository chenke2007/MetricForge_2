import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import GovernanceFilterBar from './GovernanceFilterBar'

describe('GovernanceFilterBar', () => {
  it('renders filter selects with default values', () => {
    render(
      <GovernanceFilterBar
        values={{}}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />
    )
    // Use getAllByText because AntD Select renders placeholder text in multiple places
    expect(screen.getAllByText('状态')[0]).toBeTruthy()
    expect(screen.getAllByText('来源')[0]).toBeTruthy()
    expect(screen.getAllByText('类型')[0]).toBeTruthy()
  })

  it('calls onChange when a status is selected', () => {
    const onChange = vi.fn()
    render(
      <GovernanceFilterBar
        values={{}}
        onChange={onChange}
        onReset={vi.fn()}
      />
    )
    // Open status select and pick "待处理"
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '状态' }))
    fireEvent.click(screen.getByText('待处理'))
    expect(onChange).toHaveBeenCalled()
  })

  it('calls onReset when reset button clicked', () => {
    const onReset = vi.fn()
    render(
      <GovernanceFilterBar
        values={{ status: 'open' }}
        onChange={vi.fn()}
        onReset={onReset}
      />
    )
    fireEvent.click(screen.getByText('重置筛选'))
    expect(onReset).toHaveBeenCalled()
  })
})
