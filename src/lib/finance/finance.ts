/**
 * Receivables (cobranças) and payments (recebimentos): types and the small
 * arithmetic around them. Money is handled in cents so nothing drifts, and
 * dates are plain `YYYY-MM-DD` strings (never run through UTC).
 */

export type PaymentMethod = 'boleto' | 'pix' | 'cash' | 'other'
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['pix', 'boleto', 'cash', 'other']

export type ReceivableStatus = 'open' | 'partial' | 'overdue' | 'paid' | 'cancelled'
export const RECEIVABLE_STATUSES: readonly ReceivableStatus[] = ['open', 'partial', 'overdue', 'paid', 'cancelled']

/** A row of the `receivable_balances` view (migration 075). */
export interface ReceivableRow {
  id: string
  account_id: string
  user_id: string | null
  contact_id: string | null
  company_id: string | null
  deal_id: string | null
  quote_id: string | null
  description: string
  amount: number
  due_date: string
  method: PaymentMethod | null
  reference: string | null
  installment_no: number | null
  installment_total: number | null
  note: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
  paid_amount: number
  balance: number
  last_paid_at: string | null
  status: ReceivableStatus
}

export interface PaymentRow {
  id: string
  account_id: string
  receivable_id: string
  user_id: string | null
  amount: number
  method: PaymentMethod
  paid_at: string
  note: string | null
  deposited_at: string | null
  created_at: string
}

export const toCents = (value: number): number => Math.round((value + Number.EPSILON) * 100)
export const fromCents = (cents: number): number => cents / 100

/** Today's date in Fortaleza, as `YYYY-MM-DD` (what the database's "overdue" uses too). */
export function todayFortaleza(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function parseDate(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number)
  return { y, m, d }
}

const pad = (n: number) => String(n).padStart(2, '0')
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

export function addDays(date: string, days: number): string {
  const { y, m, d } = parseDate(date)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** Same day `months` later; a day that does not exist there (31 Jan + 1) becomes the month's last day. */
export function addMonths(date: string, months: number): string {
  const { y, m, d } = parseDate(date)
  const index = y * 12 + (m - 1) + months
  const ny = Math.floor(index / 12)
  const nm = (index % 12) + 1
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`
}

/** Splits an amount into `count` parts that add up exactly; the leftover cents go to the first parts. */
export function splitAmount(amount: number, count: number): number[] {
  const total = toCents(amount)
  const base = Math.floor(total / count)
  const extra = total - base * count
  return Array.from({ length: count }, (_, i) => fromCents(base + (i < extra ? 1 : 0)))
}

export interface InstallmentDraft {
  amount: number
  due_date: string
  description: string
  installment_no: number | null
  installment_total: number | null
}

/** One receivable per month from `firstDue`; a single one when `count` is 1. */
export function buildInstallments(input: {
  amount: number
  count: number
  firstDue: string
  description: string
}): InstallmentDraft[] {
  const count = Math.max(1, Math.floor(input.count))
  if (count === 1) {
    return [{ amount: input.amount, due_date: input.firstDue, description: input.description, installment_no: null, installment_total: null }]
  }
  return splitAmount(input.amount, count).map((amount, i) => ({
    amount,
    due_date: addMonths(input.firstDue, i),
    description: `${input.description} (${i + 1}/${count})`,
    installment_no: i + 1,
    installment_total: count,
  }))
}

export interface FinanceSummary {
  /** Balance still to come due within 7 / 30 days (not yet overdue). */
  due7: number
  due30: number
  overdueAmount: number
  overdueCount: number
  /** Everything still owed (open, partial and overdue). */
  outstanding: number
}

export function summarize(rows: ReceivableRow[], today: string): FinanceSummary {
  const in7 = addDays(today, 7)
  const in30 = addDays(today, 30)
  const out: FinanceSummary = { due7: 0, due30: 0, overdueAmount: 0, overdueCount: 0, outstanding: 0 }
  let due7 = 0
  let due30 = 0
  let overdue = 0
  let outstanding = 0
  for (const r of rows) {
    if (r.status === 'paid' || r.status === 'cancelled') continue
    const balance = toCents(Number(r.balance))
    outstanding += balance
    if (r.status === 'overdue') {
      overdue += balance
      out.overdueCount += 1
    } else {
      if (r.due_date <= in7) due7 += balance
      if (r.due_date <= in30) due30 += balance
    }
  }
  out.due7 = fromCents(due7)
  out.due30 = fromCents(due30)
  out.overdueAmount = fromCents(overdue)
  out.outstanding = fromCents(outstanding)
  return out
}

/** Cash received and still not deposited. */
export function cashOnHand(payments: Pick<PaymentRow, 'method' | 'amount' | 'deposited_at'>[]): number {
  return fromCents(
    payments.filter((p) => p.method === 'cash' && !p.deposited_at).reduce((sum, p) => sum + toCents(Number(p.amount)), 0),
  )
}

/** Received amounts per method. */
export function receivedByMethod(payments: Pick<PaymentRow, 'method' | 'amount'>[]): Record<PaymentMethod, number> {
  const cents: Record<PaymentMethod, number> = { pix: 0, boleto: 0, cash: 0, other: 0 }
  for (const p of payments) cents[p.method] += toCents(Number(p.amount))
  return { pix: fromCents(cents.pix), boleto: fromCents(cents.boleto), cash: fromCents(cents.cash), other: fromCents(cents.other) }
}

/** First day of the month of `date`. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`
}
