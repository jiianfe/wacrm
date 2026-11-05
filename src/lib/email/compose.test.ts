import { describe, expect, it } from 'vitest'

import { headerSafe, parseAddressList, realMessageId, replySubject } from './compose'

describe('parseAddressList', () => {
  it('splits, trims, de-duplicates and reports invalid entries', () => {
    const r = parseAddressList('a@x.com, B@y.com; a@x.com\nnot-an-email, Fulano <f@z.com>')
    expect(r.valid).toEqual(['a@x.com', 'B@y.com', 'f@z.com'])
    expect(r.invalid).toEqual(['not-an-email'])
  })
  it('handles empty input', () => {
    expect(parseAddressList('')).toEqual({ valid: [], invalid: [] })
    expect(parseAddressList(null)).toEqual({ valid: [], invalid: [] })
  })
})

describe('replySubject', () => {
  it('adds Re: once', () => {
    expect(replySubject('Orçamento')).toBe('Re: Orçamento')
    expect(replySubject('Re: Orçamento')).toBe('Re: Orçamento')
    expect(replySubject('RES: Orçamento')).toBe('RES: Orçamento')
    expect(replySubject('')).toBe('Re:')
  })
  it('flattens line breaks', () => {
    expect(replySubject('a\r\nb')).toBe('Re: a b')
  })
})

describe('realMessageId', () => {
  it('turns a stored id into a Message-ID header value', () => {
    expect(realMessageId('email:abc@mail.x')).toBe('<abc@mail.x>')
  })
  it('refuses made-up and foreign ids', () => {
    expect(realMessageId('email:generated-123')).toBeNull()
    expect(realMessageId('wamid.XYZ')).toBeNull()
    expect(realMessageId(null)).toBeNull()
  })
})

describe('headerSafe', () => {
  it('removes line breaks and cuts the length', () => {
    expect(headerSafe('a\nb')).toBe('a b')
    expect(headerSafe('x'.repeat(500)).length).toBe(300)
  })
})
