import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ChartDraftSaveModal from './ChartDraftSaveModal'
import type { ChartConfig } from '../stores/sqlWorkbenchStore'

const mockMutation = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}))

const mockMessage = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../api/chartDrafts', () => ({
  useCreateChartDraft: () => mockMutation,
}))

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd')
  return {
    ...(actual as any),
    message: mockMessage,
  }
})

const baseProps = {
  open: true,
  onClose: vi.fn(),
  sql: 'SELECT * FROM users',
  datasourceId: 1,
  chartConfig: { chartType: 'bar' as const, xColumn: 'name', yColumn: 'amount' } as ChartConfig,
}

describe('ChartDraftSaveModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMutation.isPending = false
  })

  it('renders title input and save button when open', () => {
    render(<ChartDraftSaveModal {...baseProps} />)
    expect(screen.getByPlaceholderText('留空将自动生成')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /保\s*存/ })).toBeInTheDocument()
  })

  it('calls mutateAsync with camelCase payload when saving', async () => {
    mockMutation.mutateAsync.mockResolvedValueOnce({ id: 1 })
    render(<ChartDraftSaveModal {...baseProps} />)

    fireEvent.change(screen.getByPlaceholderText('留空将自动生成'), {
      target: { value: 'My Chart' },
    })
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => {
      expect(mockMutation.mutateAsync).toHaveBeenCalledWith({
        title: 'My Chart',
        sqlText: baseProps.sql,
        datasourceId: baseProps.datasourceId,
        chartConfig: baseProps.chartConfig,
      })
    })
  })

  it('calls onClose and shows success message after saving', async () => {
    mockMutation.mutateAsync.mockResolvedValueOnce({ id: 1 })
    render(<ChartDraftSaveModal {...baseProps} />)

    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => {
      expect(mockMessage.success).toHaveBeenCalledWith('图表草稿已保存')
    })
    expect(baseProps.onClose).toHaveBeenCalled()
  })

  it('shows error message when saving fails', async () => {
    mockMutation.mutateAsync.mockRejectedValueOnce(new Error('network error'))
    render(<ChartDraftSaveModal {...baseProps} />)

    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => {
      expect(mockMessage.error).toHaveBeenCalledWith('network error')
    })
    expect(baseProps.onClose).not.toHaveBeenCalled()
  })

  it('does not call mutateAsync when sql is empty', async () => {
    render(<ChartDraftSaveModal {...baseProps} sql="" />)

    const saveButton = screen.getByRole('button', { name: /保\s*存/ })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(mockMessage.error).toHaveBeenCalledWith(expect.stringContaining('SQL'))
    })
    expect(mockMutation.mutateAsync).not.toHaveBeenCalled()
  })

  it('does not call mutateAsync when datasourceId is null', async () => {
    render(<ChartDraftSaveModal {...baseProps} datasourceId={null} />)

    const saveButton = screen.getByRole('button', { name: /保\s*存/ })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(mockMessage.error).toHaveBeenCalledWith(expect.stringContaining('数据源'))
    })
    expect(mockMutation.mutateAsync).not.toHaveBeenCalled()
  })

  it('shows error and does not save when chartConfig chartType is missing', async () => {
    render(
      <ChartDraftSaveModal
        {...baseProps}
        chartConfig={{ chartType: '' as unknown as ChartConfig['chartType'], xColumn: 'name', yColumn: 'amount' }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => {
      expect(mockMessage.error).toHaveBeenCalledWith(expect.stringContaining('图表配置'))
    })
    expect(mockMutation.mutateAsync).not.toHaveBeenCalled()
  })

  it('binds confirmLoading to mutation pending state', () => {
    mockMutation.isPending = true
    render(<ChartDraftSaveModal {...baseProps} />)

    const saveButton = screen.getByRole('button', { name: /保\s*存/ })
    expect(saveButton).toHaveClass('ant-btn-loading')
  })
})
