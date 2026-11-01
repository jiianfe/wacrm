import { describe, expect, it } from 'vitest'
import {
  addDays,
  formatBRL,
  formatDocument,
  formatLongDate,
  formatPhoneBR,
  formatQuantity,
  formatShortDate,
  lineTotal,
  nextQuoteNumber,
  parseMoney,
  pdfSafe,
  quoteFileName,
  quoteTotal,
} from './format'

describe('money', () => {
  it('formats in Brazilian style', () => {
    expect(formatBRL(260)).toBe('R$ 260,00')
    expect(formatBRL(1234.5)).toBe('R$ 1.234,50')
    expect(formatBRL(1234567.891)).toBe('R$ 1.234.567,89')
    expect(formatBRL(0)).toBe('R$ 0,00')
  })

  it('parses what people type', () => {
    expect(parseMoney('260')).toBe(260)
    expect(parseMoney('260,5')).toBe(260.5)
    expect(parseMoney('1.234,56')).toBe(1234.56)
    expect(parseMoney('R$ 75,00')).toBe(75)
    expect(parseMoney(12.3)).toBe(12.3)
    expect(parseMoney('')).toBeNaN()
    expect(parseMoney('abc')).toBeNaN()
  })

  it('totals lines to the cent', () => {
    expect(lineTotal({ quantity: 3, unit_price: 0.1 })).toBe(0.3)
    expect(quoteTotal([
      { quantity: 10, unit_price: 260 },
      { quantity: 2.5, unit_price: 75 },
    ])).toBe(2787.5)
    expect(quoteTotal([])).toBe(0)
  })
})

describe('text formatting', () => {
  it('shows whole quantities without decimals', () => {
    expect(formatQuantity(10)).toBe('10')
    expect(formatQuantity(1.5)).toBe('1,5')
  })

  it('formats CNPJ and CPF, leaves the rest alone', () => {
    expect(formatDocument('02662483000115')).toBe('02.662.483/0001-15')
    expect(formatDocument('12345678901')).toBe('123.456.789-01')
    expect(formatDocument('123')).toBe('123')
    expect(formatDocument(null)).toBe('')
  })

  it('formats phones, dropping the country code', () => {
    expect(formatPhoneBR('5585933001477')).toBe('(85)93300-1477')
    expect(formatPhoneBR('8532358310')).toBe('(85)3235-8310')
    expect(formatPhoneBR('+1 555')).toBe('+1 555')
  })

  it('builds the quote file name', () => {
    expect(quoteFileName(1387, 'ACME: Ltda.')).toBe('Orçamento 1387 - ACME Ltda.pdf')
    expect(quoteFileName(1387, null)).toBe('Orçamento 1387.pdf')
  })

  it('replaces characters a PDF font cannot draw', () => {
    expect(pdfSafe('Manutenção “ABC” – 6 kg')).toBe('Manutenção “ABC” – 6 kg')
    expect(pdfSafe('Fogo 🔥')).toBe('Fogo ?')
    expect(pdfSafe(null)).toBe('')
  })
})

describe('dates', () => {
  it('formats without time-zone shifts', () => {
    expect(formatShortDate('2026-10-20')).toBe('20/10/2026')
    expect(formatLongDate('2026-10-20')).toBe('20 de outubro de 2026')
    expect(formatShortDate(null)).toBe('')
  })

  it('adds days across months and years', () => {
    expect(addDays('2026-10-20', 20)).toBe('2026-11-09')
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04')
  })
})

describe('nextQuoteNumber', () => {
  it('goes one above the highest, never below the floor', () => {
    expect(nextQuoteNumber([1387, 1390, 1388], 1387)).toBe(1391)
    expect(nextQuoteNumber([], 1387)).toBe(1387)
    expect(nextQuoteNumber([5], 1387)).toBe(1387)
  })
})
