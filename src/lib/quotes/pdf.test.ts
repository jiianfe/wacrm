import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { buildQuotePdf, type QuotePdfData, type QuotePdfItem } from './pdf'

const quote: QuotePdfData = {
  number: 1387,
  issue_date: '2026-10-20',
  client_legal_name: 'ACME COMERCIO LTDA',
  client_trade_name: 'Acme',
  client_document: '02662483000115',
  client_address: 'Rua das Flores',
  client_address_number: '100',
  client_district: 'Centro',
  client_city: 'Fortaleza - CE',
  client_zip: '60.000-000',
  contact_name: 'Oliveira Bonfim',
  contact_email: 'oliveira@acme.com.br',
  contact_phone: '5585988119099',
  seller_name: 'Jean Felipe',
  seller_phone: '(85)93300-1477',
  valid_until: '2026-11-09',
  delivery_time: '5 dia(s)',
  payment_terms: 'À vista',
  payment_due: null,
  notes: 'Entrega no local.',
}

const items = (n: number): QuotePdfItem[] =>
  Array.from({ length: n }, (_, i) => ({
    quantity: i + 1,
    description: `Extintor PQS 06 kg ABC - recarga e manutenção item ${i + 1}`,
    ncm: '84241000',
    unit_price: 260,
  }))

const logo = () => new Uint8Array(readFileSync(join(process.cwd(), 'public', 'logo-ultratec.png')))

describe('buildQuotePdf', () => {
  it('produces a one-page PDF for a short quote', async () => {
    const bytes = await buildQuotePdf(quote, items(3), logo())
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(1)
    expect(pdf.getTitle()).toBe('Orçamento 1387')
  })

  it('flows a long item list onto more pages', async () => {
    const bytes = await buildQuotePdf(quote, items(60), logo())
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBeGreaterThan(1)
  })

  it('works without a logo and with characters the font cannot draw', async () => {
    const bytes = await buildQuotePdf(
      { ...quote, notes: 'Fogo 🔥 ' + 'x'.repeat(300) },
      [{ quantity: 1.5, description: '🔥'.repeat(5) + ' ' + 'a'.repeat(200), ncm: null, unit_price: 0.5 }],
    )
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1)
  })
})
