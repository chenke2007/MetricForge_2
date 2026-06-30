const BOM = '﻿'

export function escapeCsvField(value: string): string {
  if (value === '') return ''
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function rowsToCsv(columns: string[], rows: any[][]): string {
  const separator = ','
  const lines: string[] = []

  // Header
  lines.push(columns.map(escapeCsvField).join(separator))

  // Rows — NULL → empty cell
  for (const row of rows) {
    const fields = row.map((val) => escapeCsvField(val === null ? '' : String(val)))
    lines.push(fields.join(separator))
  }

  // No trailing CRLF — BOM + "header\r\nval1\r\nval2".
  // Excel and most CSV parsers handle this correctly without trailing newline.
  return BOM + lines.join('\r\n')
}

export function formatTimestamp(): string {
  const now = new Date()
  const y = now.getFullYear()
  const M = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `${y}${M}${d}_${h}${m}${s}`
}

export function downloadCsv(csvContent: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `sql_result_${formatTimestamp()}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function copyCsv(csvContent: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(csvContent)
    return true
  } catch {
    // Fallback: document.execCommand('copy') for non-HTTPS environments
    const textarea = document.createElement('textarea')
    textarea.value = csvContent
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy')
      return true
    } catch {
      return false
    } finally {
      document.body.removeChild(textarea)
    }
  }
}
