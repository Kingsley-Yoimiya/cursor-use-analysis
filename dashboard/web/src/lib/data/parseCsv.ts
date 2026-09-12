/** RFC4180 风格 CSV：表头行 + 对象数组。 */

export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQ = false
        }
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQ = true
    } else if (c === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out
}

export function parseCsvText(text: string): Record<string, string>[] {
  const raw = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = raw.split('\n').filter((l) => l.length > 0)
  if (lines.length === 0) return []
  const header = parseCsvLine(lines[0]).map((h) => h.trim())
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i])
    if (cells.every((c) => c.trim() === '')) continue
    const row: Record<string, string> = {}
    for (let c = 0; c < header.length; c++) {
      row[header[c]] = cells[c] ?? ''
    }
    rows.push(row)
  }
  return rows
}

export function looksLikeUsageCsv(rows: Record<string, string>[]): boolean {
  if (rows.length === 0) return false
  const keys = Object.keys(rows[0])
  return keys.includes('Date') && keys.includes('Model')
}
