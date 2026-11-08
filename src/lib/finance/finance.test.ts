import { describe, expect, it } from 'vitest'

import {
  addDays,
  addMonths,
  buildInstallments,
  cashOnHand,
  monthStart,
  receivedByMethod,
  splitAmount,
  summarize,
  todayFortaleza,
  type ReceivableRow,
} from './finance'

const row = (over: Partial<ReceivableRow>): ReceivableRow => ({
  id: 'r',
  account_id: 'a',
  user_id: null,
  contact_id: null,
  company_id: null,
  deal_id: null,
  quote_id: null,
  description: 'x',
  amount: 100,
  due_date: '2026-11-10',
  method: null,
  reference: null,
  installment_no: null,
  installment_total: null,
  note: null,
  cancelled_at: null,
  created_at: '',
  updated_at: '',
  paid_amount: 0,
  balance: 100,
  last_paid_at: null,
  status: 'open',
  ...over,
})

describe('dates', () => {
  it('adds days across months and years', () => {
    expect(addDays('2026-11-05', 7)).toBe('2026-11-12')
    expect(addDays('2026-12-30', 5)).toBe('2027-01-04')
  })
  it('adds months, clamping the day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15')
    expect(addMonths('2026-12-10', 12)).toBe('2027-12-10')
  })
  it('uses the Fortaleza calendar day', () => {
    // 02:30 UTC on the 6th is still the 5th (21:30) in Fortaleza (UTC-3).
    expect(todayFortaleza(new Date('2026-11-06T02:30:00Z'))).toBe('2026-11-05')
    expect(todayFortaleza(new Date('2026-11-06T12:00:00Z'))).toBe('2026-11-06')
  })
  it('finds the month start', () => {
    expect(monthStart('2026-11-18')).toBe('2026-11-01')
  })
})

describe('installments', () => {
  it('splits so the parts add up to the total', () => {
    expect(splitAmount(100, 3)).toEqual([33.34, 33.33, 33.33])
    expect(splitAmount(310, 2)).toEqual([155, 155])
    const parts = splitAmount(1000.01, 7)
    expect(Math.round(parts.reduce((a, b) => a + b, 0) * 100)).toBe(100001)
  })
  it('builds one receivable per month', () => {
    const list = buildInstallments({ amount: 300, count: 3, firstDue: '2026-11-30', description: 'Orçamento 1462' })
    expect(list.map((i) => i.due_date)).toEqual(['2026-11-30', '2026-12-30', '2027-01-30'])
    expect(list.map((i) => i.description)).toEqual(['Orçamento 1462 (1/3)', 'Orçamento 1462 (2/3)', 'Orçamento 1462 (3/3)'])
    expect(list.map((i) => i.installment_no)).toEqual([1, 2, 3])
  })
  it('keeps a single receivable plain', () => {
    const [one] = buildInstallments({ amount: 310, count: 1, firstDue: '2026-11-10', description: 'Tele Entrega' })
    expect(one).toMatchObject({ amount: 310, description: 'Tele Entrega', installment_no: null })
  })
})

describe('summarize', () => {
  it('groups what is due soon, overdue and outstanding; ignores paid and cancelled', () => {
    const today = '2026-11-05'
    const s = summarize(
      [
        row({ id: '1', due_date: '2026-11-08', balance: 100 }),
        row({ id: '2', due_date: '2026-11-25', balance: 250.5 }),
        row({ id: '3', due_date: '2026-12-20', balance: 40 }),
        row({ id: '4', due_date: '2026-10-30', balance: 60, status: 'overdue' }),
        row({ id: '5', due_date: '2026-10-01', balance: 10, status: 'overdue' }),
        row({ id: '6', status: 'paid', balance: 0 }),
        row({ id: '7', status: 'cancelled', balance: 999 }),
      ],
      today,
    )
    expect(s.due7).toBe(100)
    expect(s.due30).toBe(350.5)
    expect(s.overdueAmount).toBe(70)
    expect(s.overdueCount).toBe(2)
    expect(s.outstanding).toBe(460.5)
  })
})

describe('payments', () => {
  const payments = [
    { method: 'cash' as const, amount: 50, deposited_at: null },
    { method: 'cash' as const, amount: 20.25, deposited_at: '2026-11-04' },
    { method: 'pix' as const, amount: 310, deposited_at: null },
    { method: 'cash' as const, amount: 10.1, deposited_at: null },
  ]
  it('sums cash not yet deposited', () => {
    expect(cashOnHand(payments)).toBe(60.1)
  })
  it('sums received per method', () => {
    expect(receivedByMethod(payments)).toEqual({ pix: 310, boleto: 0, cash: 80.35, other: 0 })
  })
})
