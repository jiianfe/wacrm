/**
 * Formatting and arithmetic for quotes (orçamentos). Dates are plain
 * `YYYY-MM-DD` strings, never run through UTC, so the day never shifts.
 */

const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/** `R$ 1.234,56` with plain spaces (safe for PDF fonts). */
export function formatBRL(value: number): string {
  const fixed = (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2)
  const [int, dec] = fixed.split('.')
  return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`
}

/** "1.234,56", "260", "260,5" or 260 → number; NaN when it isn't one. */
export function parseMoney(input: string | number): number {
  if (typeof input === 'number') return input
  const s = input.replace(/R\$/gi, '').trim()
  if (!s) return NaN
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN
}

/** Quantity without trailing zeros: 10 → "10", 1.5 → "1,5". */
export function formatQuantity(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/0+$/, '').replace('.', ',')
}

/** CNPJ (14 digits) or CPF (11 digits); anything else is returned as typed. */
export function formatDocument(value: string | null | undefined): string {
  const d = (value ?? '').replace(/\D/g, '')
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  return value ?? ''
}

/** (85)93300-1477 — Brazilian phone with area code; other lengths as typed. */
export function formatPhoneBR(value: string | null | undefined): string {
  let d = (value ?? '').replace(/\D/g, '')
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
  if (d.length === 10 || d.length === 11) return `(${d.slice(0, 2)})${d.slice(2, -4)}-${d.slice(-4)}`
  return value ?? ''
}

/** "2026-10-20" → "20/10/2026". */
export function formatShortDate(date: string | null | undefined): string {
  if (!date) return ''
  const [y, m, d] = date.split('-')
  return y && m && d ? `${d}/${m}/${y}` : date
}

/** "2026-10-20" → "20 de outubro de 2026". */
export function formatLongDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${d} de ${MONTHS[m - 1]} de ${y}`
}

/** `date` plus `days` calendar days, as `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(y, m - 1, d + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`
}

export interface PricedLine {
  quantity: number
  unit_price: number
}

export function lineTotal(line: PricedLine): number {
  return Math.round((line.quantity * line.unit_price + Number.EPSILON) * 100) / 100
}

export function quoteTotal(lines: PricedLine[]): number {
  return Math.round(lines.reduce((sum, l) => sum + lineTotal(l), 0) * 100) / 100
}

/** The next quote number: one above the highest in use, never below `floor`. */
export function nextQuoteNumber(existing: number[], floor: number): number {
  return Math.max(floor, ...existing.map((n) => n + 1))
}

/** The file name for a quote's PDF: "Orçamento 1387 - ACME LTDA.pdf". */
export function quoteFileName(number: number, client: string | null | undefined): string {
  const name = (client ?? '').replace(/[\\/:*?"<>|]/g, '').trim().replace(/\.+$/, '')
  return `Orçamento ${number}${name ? ` - ${name}` : ''}.pdf`
}

/**
 * Standard PDF fonts only cover Latin-1 (+ a few punctuation marks). Replace
 * anything else (emoji, other scripts) so drawing the text can't throw.
 */
export function pdfSafe(text: string | null | undefined): string {
  const extra = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'
  let out = ''
  for (const ch of (text ?? '').replace(/\r/g, '')) {
    const code = ch.codePointAt(0) ?? 0
    out += code === 10 || (code >= 32 && code <= 255 && code !== 127) || extra.includes(ch) ? ch : '?'
  }
  return out
}
