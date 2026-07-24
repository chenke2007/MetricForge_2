import { describe, it, expect } from 'vitest'
import { generateTitle } from './title'

describe('generateTitle', () => {
  it('extracts first sentence at Chinese period', () => {
    const result = generateTitle('近30天各区域的销售额。同比增长10%')
    expect(result).toBe('近30天各区域的销售额。')
  })

  it('extracts first sentence at Chinese question mark', () => {
    const result = generateTitle('上个月销量如何？同比有增长吗？')
    expect(result).toBe('上个月销量如何？')
  })

  it('extracts first sentence at Chinese exclamation mark', () => {
    const result = generateTitle('今年业绩很好！同比增长20%')
    expect(result).toBe('今年业绩很好！')
  })

  it('extracts first sentence at newline', () => {
    const result = generateTitle('近7天订单量\n按区域查看')
    expect(result).toBe('近7天订单量')
  })

  it('returns whole text when no sentence-ending punctuation found', () => {
    const result = generateTitle('近30天各区域的销售额')
    expect(result).toBe('近30天各区域的销售额')
  })

  it('trims whitespace from result', () => {
    const result = generateTitle('  近30天销量。  ')
    expect(result).toBe('近30天销量。')
  })

  it('truncates long titles at 48 characters with ellipsis', () => {
    const long = '近30天各区域销售额同比增长情况分析报告'.repeat(5)
    const result = generateTitle(long)
    expect(result.length).toBeLessThanOrEqual(49) // 48 chars + '…'
    expect(result.endsWith('…')).toBe(true)
  })

  it('does not truncate titles shorter than 48 characters', () => {
    const short = '近30天各区域销售额情况'
    const result = generateTitle(short)
    expect(result).toBe(short)
  })

  it('handles empty input safely', () => {
    expect(generateTitle('')).toBe('')
  })

  it('handles whitespace-only input safely', () => {
    const result = generateTitle('   ')
    expect(result).toBe('')
  })

  it('extracts first sentence with English period', () => {
    const result = generateTitle('Sales trend this month. Show by region.')
    expect(result).toBe('Sales trend this month.')
  })
})
