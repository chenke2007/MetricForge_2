import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SqlCodeBlock from './SqlCodeBlock'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

describe('SqlCodeBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extracts datasource_id from code first line', () => {
    const code = `-- datasource_id: 2\nSELECT * FROM DW_CONTRACT`
    render(<SqlCodeBlock code={code} />)
    expect(screen.getByTestId('open-in-workbench-btn')).toBeInTheDocument()
  })

  it('extracts datasource_id with leading whitespace', () => {
    const code = `  -- datasource_id: 2\nSELECT * FROM DW_CONTRACT`
    render(<SqlCodeBlock code={code} />)
    fireEvent.click(screen.getByTestId('open-in-workbench-btn'))
    const url = mockNavigate.mock.calls[0][0]
    expect(url).toContain('datasource_id=2')
  })

  it('navigates to workbench with correct params', () => {
    const code = `-- datasource_id: 2\nSELECT * FROM DW_CONTRACT`
    render(<SqlCodeBlock code={code} />)
    fireEvent.click(screen.getByTestId('open-in-workbench-btn'))
    const url = mockNavigate.mock.calls[0][0]
    expect(url).toContain('datasource_id=2')
    expect(url).toContain('sql=SELECT+*+FROM+DW_CONTRACT')
  })

  it('removes datasource_id line before passing to URL', () => {
    const code = `-- datasource_id: 2\nSELECT * FROM DW_CONTRACT`
    render(<SqlCodeBlock code={code} />)
    fireEvent.click(screen.getByTestId('open-in-workbench-btn'))
    const callUrl = mockNavigate.mock.calls[0][0]
    expect(callUrl).not.toContain('datasource_id:')
  })

  it('navigates without datasource_id when comment is missing', () => {
    const code = `SELECT * FROM DW_CONTRACT`
    render(<SqlCodeBlock code={code} />)
    fireEvent.click(screen.getByTestId('open-in-workbench-btn'))
    const url = mockNavigate.mock.calls[0][0]
    expect(url).toContain('sql=SELECT+*+FROM+DW_CONTRACT')
    expect(url).not.toContain('datasource_id=')
  })

  it('does not show button for empty code', () => {
    render(<SqlCodeBlock code="" />)
    expect(screen.queryByTestId('open-in-workbench-btn')).not.toBeInTheDocument()
  })

  it('shows warning modal when URL exceeds 1800 chars', () => {
    const longSql = 'SELECT ' + 'a'.repeat(1755) + ' FROM t'
    const code = `-- datasource_id: 2\n${longSql}`
    render(<SqlCodeBlock code={code} />)
    fireEvent.click(screen.getByTestId('open-in-workbench-btn'))
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('encodes special characters in SQL', () => {
    const code = `-- datasource_id: 2\nSELECT '中文' FROM t`
    render(<SqlCodeBlock code={code} />)
    fireEvent.click(screen.getByTestId('open-in-workbench-btn'))
    const url = mockNavigate.mock.calls[0][0]
    expect(url).toContain('%E4%B8%AD%E6%96%87')
  })
})
