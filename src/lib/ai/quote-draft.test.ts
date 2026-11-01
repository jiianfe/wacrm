import { describe, expect, it } from 'vitest'
import { buildQuoteDraftPrompt, parseQuoteDraft, type CatalogEntry } from './quote-draft'

const catalog: CatalogEntry[] = [
  { id: 'p1', description: 'Extintor PQS 06 kg ABC', unit_price: 260, kind: 'product' },
  { id: 'p2', description: 'Recarga de extintor', unit_price: 75, kind: 'service' },
]

describe('parseQuoteDraft', () => {
  it('keeps catalog matches and drops unknown product ids', () => {
    const raw = JSON.stringify({
      items: [
        { product_id: 'p1', description: 'Extintor PQS 06 kg ABC', quantity: 3 },
        { product_id: 'zzz', description: 'Placa de sinalização', quantity: 2 },
      ],
      notes: 'Entrega na Av. Beira Mar',
    })
    expect(parseQuoteDraft(raw, catalog)).toEqual({
      items: [
        { productId: 'p1', description: 'Extintor PQS 06 kg ABC', quantity: 3 },
        { productId: null, description: 'Placa de sinalização', quantity: 2 },
      ],
      notes: 'Entrega na Av. Beira Mar',
    })
  })

  it('defaults a missing or invalid quantity to 1 and skips items without description', () => {
    const raw = '```json\n{"items":[{"product_id":"p2","description":"Recarga","quantity":"abc"},{"description":""}],"notes":null}\n```'
    expect(parseQuoteDraft(raw, catalog)?.items).toEqual([
      { productId: 'p2', description: 'Recarga', quantity: 1 },
    ])
  })

  it('returns null when the reply is not JSON', () => {
    expect(parseQuoteDraft('desculpe, não sei', catalog)).toBeNull()
  })
})

describe('buildQuoteDraftPrompt', () => {
  it('lists the catalog and the conversation', () => {
    const out = buildQuoteDraftPrompt([{ role: 'user', content: 'Quero 3 extintores' }], catalog)
    expect(out).toContain('id=p1')
    expect(out).toContain('Customer: Quero 3 extintores')
  })
})
