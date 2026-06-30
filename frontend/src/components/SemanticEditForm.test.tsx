import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SemanticEditForm from './SemanticEditForm'
import type { FieldContext, FieldSemanticData } from '../api/governance'

vi.mock('../hooks/useSaveSemantic', () => ({
  useSaveSemantic: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

const mockFieldContext: FieldContext = {
  id: 42,
  schema_name: 'DW',
  table_name: 'DW_CONTRACT',
  column_name: 'contract_code',
  column_type: 'VARCHAR2(50)',
  nullable: false,
  comment: '合同编号',
  is_primary_key: true,
  is_foreign_key: false,
  enum_samples: null,
}

const mockExistingSemantic: FieldSemanticData = {
  id: 10,
  business_alias: '合同编号',
  meaning: '合同唯一编码',
  unit: null,
  enum_values: null,
  data_quality_note: '来自合同主表',
  is_governed: true,
  governed_by: '张三',
  governed_at: '2026-06-28 10:00:00',
}

describe('SemanticEditForm', () => {
  const onSaved = vi.fn()
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders read-only field header', () => {
    render(
      <SemanticEditForm
        fieldContext={mockFieldContext}
        existingSemantic={null}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    )
    expect(screen.getByText('DW.DW_CONTRACT.contract_code')).toBeTruthy()
    expect(screen.getByText('VARCHAR2(50)')).toBeTruthy()
    expect(screen.getByText('合同编号')).toBeTruthy()
  })

  it('pre-fills form with existing semantic data', () => {
    render(
      <SemanticEditForm
        fieldContext={mockFieldContext}
        existingSemantic={mockExistingSemantic}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    )
    const aliasInput = screen.getByDisplayValue('合同编号')
    expect(aliasInput).toBeTruthy()
    const meaningInput = screen.getByDisplayValue('合同唯一编码')
    expect(meaningInput).toBeTruthy()
  })

  it('shows validation error when saving with empty fields', async () => {
    const { container } = render(
      <SemanticEditForm
        fieldContext={mockFieldContext}
        existingSemantic={null}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    )
    // Clear the business_alias field
    const aliasInput = screen.getByLabelText('业务别名 *')
    fireEvent.change(aliasInput, { target: { value: '' } })
    // Try to save
    fireEvent.click(screen.getByText('保存字段语义'))
    await waitFor(() => {
      // Assert on the error class since help text rendering is flaky in jsdom
      const errorItem = container.querySelector('.ant-form-item-has-error')
      expect(errorItem).toBeTruthy()
    })
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('calls onCancel when cancel button clicked', () => {
    render(
      <SemanticEditForm
        fieldContext={mockFieldContext}
        existingSemantic={null}
        onSaved={onSaved}
        onCancel={onCancel}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /取 消/ }))
    expect(onCancel).toHaveBeenCalled()
  })
})
