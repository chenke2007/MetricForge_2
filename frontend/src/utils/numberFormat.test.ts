// frontend/src/utils/numberFormat.test.ts
import { describe, it, expect } from 'vitest'
import { formatCompact, formatPercent, formatCurrency, formatThousand, detectFormat, formatMetricValue } from './numberFormat'

describe('numberFormat', () => {
  describe('formatCompact', () => {
    it('formats billions', () => expect(formatCompact(1_500_000_000)).toBe('1.5B'))
    it('formats millions', () => expect(formatCompact(12_300_000)).toBe('12.3M'))
    it('formats thousands', () => expect(formatCompact(15_387)).toBe('15.4K'))
    it('keeps small numbers', () => expect(formatCompact(999)).toBe('999'))
  })

  describe('formatPercent', () => {
    it('formats 0.325 as 32.5%', () => expect(formatPercent(0.325)).toBe('32.5%'))
    it('formats 32.5 as 32.5%', () => expect(formatPercent(32.5)).toBe('32.5%'))
  })

  describe('formatCurrency', () => {
    it('formats with ¥ prefix', () => expect(formatCurrency(12_300_000)).toBe('¥12.3M'))
    it('formats small amount', () => expect(formatCurrency(500)).toBe('¥500'))
  })

  describe('formatThousand', () => {
    it('adds thousand separators', () => expect(formatThousand(1234567)).toBe('1,234,567'))
  })

  describe('detectFormat', () => {
    it('detects percent for 0-1 values', () => expect(detectFormat([0.32, 0.5])).toBe('percent'))
    it('detects currency for labels with revenue', () => expect(detectFormat([100], ['sales revenue'])).toBe('currency'))
    it('detects percent for labels with rate', () => expect(detectFormat([10], ['growth rate'])).toBe('percent'))
    it('defaults to compact', () => expect(detectFormat([100, 200])).toBe('compact'))
    it('returns compact for empty array', () => expect(detectFormat([])).toBe('compact'))
  })

  describe('formatMetricValue', () => {
    it('uses detected format from label', () => {
      expect(formatMetricValue(12_300_000, undefined, 'total_revenue')).toBe('¥12.3M')
    })
    it('explicit format overrides detection', () => {
      expect(formatMetricValue(0.325, 'percent')).toBe('32.5%')
    })
    it('auto-detects fraction as percent', () => {
      expect(formatMetricValue(0.256)).toBe('25.6%')
    })
    it('auto-detects large number as compact', () => {
      expect(formatMetricValue(15_387)).toBe('15.4K')
    })
    it('formats small integer as thousand-separated', () => {
      expect(formatMetricValue(999)).toBe('999')
    })
  })
})
