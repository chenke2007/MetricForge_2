// frontend/src/components/SqlValidationAlert.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SqlValidationAlert } from './SqlValidationAlert'
import type { SqlValidationDetail } from '../types/aiAsk'

describe('SqlValidationAlert', () => {
  it('renders error list with rule titles and messages', () => {
    const detail: SqlValidationDetail = {
      errors: [
        { rule: 'FIELD_NOT_FOUND', field: 'investment_amount', message: '字段 investment_amount 不存在' },
        { rule: 'TABLE_SCHEMA_MISSING', table: 'DWS_RPT_ZCPZ_CYFL_TF_M', message: '缺少 schema 前缀' },
      ],
      warnings: [],
      sql: 'SELECT investment_amount FROM DWS_RPT_ZCPZ_CYFL_TF_M',
    }
    render(<SqlValidationAlert detail={detail} />)

    // 检查中文标题
    expect(screen.getByText('字段不存在')).toBeTruthy()
    expect(screen.getByText('缺少 Schema 限定')).toBeTruthy()
    // 检查消息
    expect(screen.getByText('字段 investment_amount 不存在')).toBeTruthy()
    expect(screen.getByText('缺少 schema 前缀')).toBeTruthy()
    // 检查 error count
    expect(screen.getByText(/SQL 校验未通过（2 项）/)).toBeTruthy()
  })

  it('renders field and table metadata', () => {
    const detail: SqlValidationDetail = {
      errors: [
        { rule: 'PARTITION_FILTER_MISSING', message: '分区表缺少 pt 分区过滤' },
      ],
      warnings: [],
      sql: '',
    }
    render(<SqlValidationAlert detail={detail} />)

    expect(screen.getByText('缺少 pt 分区过滤')).toBeTruthy()
    expect(screen.getByText('分区表缺少 pt 分区过滤')).toBeTruthy()
  })

  it('renders SQL text when present', () => {
    const sql = 'SELECT amt FROM DWHRPT.DWS_RPT_ZCPZ_CYFL_TF_M WHERE pt=xxx'
    const detail: SqlValidationDetail = {
      errors: [{ rule: 'CASE_MISMATCH', field: 'amt', message: '大小写不匹配' }],
      warnings: [],
      sql,
    }
    render(<SqlValidationAlert detail={detail} />)

    expect(screen.getByText(sql)).toBeTruthy()
  })

  it('shows "no errors" message when errors array is empty', () => {
    const detail: SqlValidationDetail = {
      errors: [],
      warnings: [],
      sql: 'SELECT 1',
    }
    render(<SqlValidationAlert detail={detail} />)

    expect(screen.getByText('无具体错误信息')).toBeTruthy()
  })

  it('renders DDL_DML_NOT_ALLOWED with Chinese title', () => {
    const detail: SqlValidationDetail = {
      errors: [{ rule: 'DDL_DML_NOT_ALLOWED', message: 'DDL not allowed' }],
      warnings: [],
      sql: '',
    }
    render(<SqlValidationAlert detail={detail} />)

    expect(screen.getByText('只允许 SELECT 查询')).toBeTruthy()
  })

  it('renders UNKNOWN_TABLE_REFERENCE with Chinese title', () => {
    const detail: SqlValidationDetail = {
      errors: [{ rule: 'UNKNOWN_TABLE_REFERENCE', table: 'DWHRPT.UNKNOWN', message: '未知表引用' }],
      warnings: [],
      sql: '',
    }
    render(<SqlValidationAlert detail={detail} />)

    expect(screen.getByText('引用了未选表')).toBeTruthy()
  })

  it('renders PARSE_ERROR with Chinese title', () => {
    const detail: SqlValidationDetail = {
      errors: [{ rule: 'PARSE_ERROR', message: 'SQL parse failed' }],
      warnings: [],
      sql: 'invalid sql',
    }
    render(<SqlValidationAlert detail={detail} />)

    expect(screen.getByText('SQL 解析失败')).toBeTruthy()
  })
})
