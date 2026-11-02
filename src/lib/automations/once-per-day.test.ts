import { describe, expect, it } from 'vitest'

import {
  logSentMessage,
  oncePerDayEnabled,
  oncePerDayTimeZone,
  startOfDayInTimeZone,
} from './once-per-day'

describe('startOfDayInTimeZone', () => {
  it('returns local midnight in Fortaleza (UTC-3)', () => {
    // 2026-11-02 12:34:56.789 local = 15:34:56.789Z
    const now = new Date('2026-11-02T15:34:56.789Z')
    expect(startOfDayInTimeZone(now, 'America/Fortaleza').toISOString()).toBe(
      '2026-11-02T03:00:00.000Z',
    )
  })

  it('uses the local calendar day, not the UTC one', () => {
    // 23:30 local on Nov 2 is already Nov 3 in UTC.
    const now = new Date('2026-11-03T02:30:00.000Z')
    expect(startOfDayInTimeZone(now, 'America/Fortaleza').toISOString()).toBe(
      '2026-11-02T03:00:00.000Z',
    )
  })

  it('works in UTC', () => {
    const now = new Date('2026-11-02T00:00:00.000Z')
    expect(startOfDayInTimeZone(now, 'UTC').toISOString()).toBe('2026-11-02T00:00:00.000Z')
  })
})

describe('logSentMessage', () => {
  it('counts a successful send step', () => {
    expect(
      logSentMessage([
        { step_id: 'a', step_type: 'condition', status: 'success' },
        { step_id: 'b', step_type: 'send_message', status: 'success' },
      ]),
    ).toBe(true)
  })

  it('ignores runs that sent nothing (e.g. inside business hours)', () => {
    expect(
      logSentMessage([
        { step_id: 'a', step_type: 'condition', status: 'success' },
        { step_id: 'b', step_type: 'add_tag', status: 'success' },
      ]),
    ).toBe(false)
  })

  it('ignores failed sends', () => {
    expect(logSentMessage([{ step_id: 'b', step_type: 'send_template', status: 'failed' }])).toBe(
      false,
    )
  })

  it('handles empty logs', () => {
    expect(logSentMessage(null)).toBe(false)
    expect(logSentMessage([])).toBe(false)
  })
})

describe('config helpers', () => {
  it('reads the switch and time zone from trigger_config', () => {
    expect(oncePerDayEnabled({ once_per_day: true })).toBe(true)
    expect(oncePerDayEnabled({})).toBe(false)
    expect(oncePerDayEnabled(null)).toBe(false)
    expect(oncePerDayTimeZone({ once_per_day_timezone: 'America/Fortaleza' })).toBe(
      'America/Fortaleza',
    )
    expect(oncePerDayTimeZone({ once_per_day_timezone: 'Not/AZone' })).toBe('UTC')
  })
})
