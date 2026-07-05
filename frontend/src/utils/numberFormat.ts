// frontend/src/utils/numberFormat.ts

export type MetricFormat = 'number' | 'currency' | 'percent' | 'compact'

/**
 * Format large numbers compactly: 1234567 → '1.2M'
 */
export function formatCompact(value: number, decimals: number = 1): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return (value / 1_000_000_000).toFixed(decimals) + 'B'
  }
  if (Math.abs(value) >= 1_000_000) {
    return (value / 1_000_000).toFixed(decimals) + 'M'
  }
  if (Math.abs(value) >= 10_000) {
    return (value / 1_000).toFixed(decimals) + 'K'
  }
  return value.toLocaleString()
}

/**
 * Format as percentage: 0.325 → '32.5%'
 */
export function formatPercent(value: number, decimals: number = 1): string {
  const percent = Math.abs(value) < 1 && value !== 0 ? value * 100 : value
  return percent.toFixed(decimals) + '%'
}

/**
 * Format as currency: 1234567 → '¥1.2M'
 */
export function formatCurrency(value: number, decimals: number = 1): string {
  return '¥' + formatCompact(value, decimals)
}

/**
 * Format a value with thousand separators: 1234567 → '1,234,567'
 */
export function formatThousand(value: number): string {
  return value.toLocaleString()
}

/**
 * Detect the most appropriate format for a set of values.
 * - If all values are between 0 and 1 (exclusive), assume percentage
 * - If labels include currency-related keywords, assume currency
 * - Otherwise use compact
 */
export function detectFormat(values: number[], labels?: string[]): MetricFormat {
  if (values.length === 0) return 'compact'
  const allFractions = values.every((v) => v > 0 && v < 1)
  if (allFractions) return 'percent'

  if (labels) {
    const labelText = labels.join(' ').toLowerCase()
    if (/revenue|sales|income|amount|revenue|profit|cost|￥|¥|usd|cny|eur/i.test(labelText)) {
      return 'currency'
    }
    if (/rate|ratio|margin|percent|%|rate/i.test(labelText)) {
      return 'percent'
    }
  }

  return 'compact'
}

/**
 * Smart metric value formatter.
 * Guesses format from value magnitude and optional label.
 */
export function formatMetricValue(value: number, format?: MetricFormat, label?: string): string {
  if (format) {
    switch (format) {
      case 'currency': return formatCurrency(value)
      case 'percent': return formatPercent(value)
      case 'compact': return formatCompact(value)
      case 'number': return formatThousand(value)
    }
  }

  // Auto-detect
  if (label) {
    const detected = detectFormat([value], [label])
    return formatMetricValue(value, detected)
  }

  if (value > 0 && value < 1) return formatPercent(value)
  if (Math.abs(value) >= 10_000) return formatCompact(value)
  return formatThousand(value)
}
