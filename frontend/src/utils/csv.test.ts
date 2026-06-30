import { describe, it, expect } from 'vitest'
import { rowsToCsv, escapeCsvField, formatTimestamp } from './csv'

describe('escapeCsvField', () => {
  it('returns plain value unchanged', () => {
    expect(escapeCsvField('hello')).toBe('hello')
  })

  it('returns empty string for empty input', () => {
    expect(escapeCsvField('')).toBe('')
  })

  it('wraps value containing comma in quotes', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"')
  })

  it('wraps value containing double quote and escapes inner quotes', () => {
    expect(escapeCsvField('say "hello"')).toBe('"say ""hello"""')
  })

  it('wraps value containing newline in quotes', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"')
  })

  it('wraps value containing CRLF in quotes', () => {
    expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"')
  })

  it('does not wrap numeric string without special chars', () => {
    expect(escapeCsvField('123')).toBe('123')
  })

  it('prefixes leading equals sign with tab and quotes', () => {
    expect(escapeCsvField('=1+1')).toBe('"\t=1+1"')
  })

  it('prefixes leading plus sign with tab and quotes', () => {
    expect(escapeCsvField('+123')).toBe('"\t+123"')
  })

  it('prefixes leading minus sign with tab and quotes', () => {
    expect(escapeCsvField('-123')).toBe('"\t-123"')
  })

  it('prefixes leading at sign with tab and quotes', () => {
    expect(escapeCsvField('@user')).toBe('"\t@user"')
  })

  it('does not modify safe plain text', () => {
    expect(escapeCsvField('hello')).toBe('hello')
  })

  it('does not double-prefix already tab-prefixed values', () => {
    expect(escapeCsvField('\t=1')).toBe('\t=1')
  })
})

describe('rowsToCsv', () => {
  it('produces UTF-8 BOM header', () => {
    const result = rowsToCsv(['a', 'b'], [[1, 2]])
    // BOM is first character
    expect(result.charCodeAt(0)).toBe(0xFEFF)
  })

  it('outputs header followed by data rows with CRLF between lines', () => {
    const result = rowsToCsv(['name', 'age'], [['Alice', '30'], ['Bob', '25']])
    const body = result.slice(1) // strip BOM
    expect(body).toBe('name,age\r\nAlice,30\r\nBob,25')
  })

  it('outputs NULL values as empty cells', () => {
    const result = rowsToCsv(['a'], [[null]])
    const body = result.slice(1)
    expect(body).toBe('a\r\n')
  })

  it('outputs empty string as empty cell', () => {
    const result = rowsToCsv(['a'], [['']])
    const body = result.slice(1)
    expect(body).toBe('a\r\n')
  })

  it('escapes fields containing special characters', () => {
    const result = rowsToCsv(['col'], [['hello, world']])
    const body = result.slice(1)
    expect(body).toBe('col\r\n"hello, world"')
  })

  it('handles empty rows array — only header line output', () => {
    const result = rowsToCsv(['a', 'b'], [])
    const body = result.slice(1) // strip BOM
    // No trailing CRLF: BOM + "a,b"
    expect(body).toBe('a,b')
  })

  it('uses CRLF between lines', () => {
    const result = rowsToCsv(['x'], [['1'], ['2']])
    // BOM + "x\r\n1\r\n2" — no trailing CRLF
    expect(result.slice(1)).toBe('x\r\n1\r\n2')
  })

  it('produces correct multi-column output', () => {
    const result = rowsToCsv(['a', 'b', 'c'], [['1', '2', '3']])
    const body = result.slice(1)
    expect(body).toBe('a,b,c\r\n1,2,3')
  })
})

describe('formatTimestamp', () => {
  it('returns YYYYMMDD_HHmmss format', () => {
    const ts = formatTimestamp()
    expect(ts).toMatch(/^\d{8}_\d{6}$/)
  })
})
