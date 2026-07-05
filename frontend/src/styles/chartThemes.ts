// frontend/src/styles/chartThemes.ts
import type { ChartTheme } from '../types/aiAsk'

export interface ChartThemeConfig {
  palette: string[]
  backgroundColor: string
  textColor: string
  axisColor: string
  fontFamily: string
}

export const CHART_THEMES: Record<ChartTheme, ChartThemeConfig> = {
  'business-light': {
    palette: ['#4E7BF5', '#58B9FF', '#7CD3A0', '#FFB347', '#FF7B7B', '#A78BFA'],
    backgroundColor: '#ffffff',
    textColor: '#333333',
    axisColor: '#e8e8e8',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  'executive-blue': {
    palette: ['#1A3A5C', '#2E6B9E', '#4A90D9', '#6BB3F0', '#8FC5F0', '#B0D4F0'],
    backgroundColor: '#F7FAFC',
    textColor: '#1A202C',
    axisColor: '#E2E8F0',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  'soft-gradient': {
    palette: ['#667EEA', '#764BA2', '#F093FB', '#F5576C', '#4FACFE', '#43E97B'],
    backgroundColor: '#ffffff',
    textColor: '#2D3748',
    axisColor: '#EDF2F7',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
}

export const DEFAULT_THEME: ChartTheme = 'business-light'

export function getTheme(theme?: ChartTheme): ChartThemeConfig {
  return CHART_THEMES[theme ?? DEFAULT_THEME] ?? CHART_THEMES[DEFAULT_THEME]
}

/**
 * Get series color with interval strategy to avoid adjacent color conflict.
 * When series count > palette length, alternate by stepping index to maintain contrast.
 */
export function getSeriesColor(index: number, palette: string[]): string {
  const len = palette.length
  if (len === 0) return '#4E7BF5'
  // Alternate stepping: for large series counts, use step of ~len/2 to maximize contrast
  if (index >= len) {
    const step = Math.max(1, Math.floor(len / 2))
    return palette[(index * step) % len]
  }
  return palette[index]
}
