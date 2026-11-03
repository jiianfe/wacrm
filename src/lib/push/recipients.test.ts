import { describe, expect, it } from 'vitest'
import { isPushRecipient } from './recipients'

describe('isPushRecipient', () => {
  it('uses the role while the flag is unset', () => {
    expect(isPushRecipient(null, 'owner')).toBe(true)
    expect(isPushRecipient(null, 'admin')).toBe(true)
    expect(isPushRecipient(null, 'agent')).toBe(false)
    expect(isPushRecipient(undefined, 'viewer')).toBe(false)
  })

  it('lets an explicit choice override the role', () => {
    expect(isPushRecipient(true, 'agent')).toBe(true)
    expect(isPushRecipient(false, 'admin')).toBe(false)
  })
})
