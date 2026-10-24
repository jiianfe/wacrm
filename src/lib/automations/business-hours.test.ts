import { describe, expect, it } from 'vitest'
import { isWithinBusinessHours, parseSchedule } from './business-hours'

const SCHEDULE = 'seg-sex 08:00-17:00; sab 08:00-12:00'
const ZONE = 'America/Fortaleza' // UTC-3, no daylight saving

// 2026-10-19 is a Monday. Fortaleza time → UTC is +3h.
const at = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 9, day, hour + 3, minute))

describe('parseSchedule', () => {
  it('reads ranges, lists and several entries', () => {
    expect(parseSchedule(SCHEDULE)).toEqual([
      { days: [1, 2, 3, 4, 5], from: 480, to: 1020 },
      { days: [6], from: 480, to: 720 },
    ])
    expect(parseSchedule('seg,qua,sex 9:00-18:00')?.[0].days).toEqual([1, 3, 5])
  })

  it('accepts accents, capitals, English names and new lines', () => {
    expect(parseSchedule('Sáb 08:00-12:00\nDom 08:00-09:00')?.map((e) => e.days)).toEqual([[6], [0]])
    expect(parseSchedule('mon-fri 08:00-17:00')?.[0].days).toEqual([1, 2, 3, 4, 5])
  })

  it('wraps a range around the weekend', () => {
    expect(parseSchedule('sex-seg 08:00-12:00')?.[0].days.sort()).toEqual([0, 1, 5, 6])
  })

  it('rejects empty or malformed text', () => {
    expect(parseSchedule('')).toBeNull()
    expect(parseSchedule(undefined)).toBeNull()
    expect(parseSchedule('08:00-17:00')).toBeNull()
    expect(parseSchedule('xyz 08:00-17:00')).toBeNull()
    expect(parseSchedule('seg 17:00-08:00')).toBeNull()
    expect(parseSchedule('seg 08:00-25:00')).toBeNull()
  })
})

describe('isWithinBusinessHours', () => {
  it('is open on weekdays during the day', () => {
    expect(isWithinBusinessHours(SCHEDULE, at(19, 8), ZONE)).toBe(true)
    expect(isWithinBusinessHours(SCHEDULE, at(23, 16, 59), ZONE)).toBe(true)
  })

  it('is closed outside weekday hours, the end minute included', () => {
    expect(isWithinBusinessHours(SCHEDULE, at(19, 7, 59), ZONE)).toBe(false)
    expect(isWithinBusinessHours(SCHEDULE, at(19, 17), ZONE)).toBe(false)
  })

  it('uses the Saturday hours on Saturday', () => {
    expect(isWithinBusinessHours(SCHEDULE, at(24, 11), ZONE)).toBe(true)
    expect(isWithinBusinessHours(SCHEDULE, at(24, 13), ZONE)).toBe(false)
  })

  it('is closed all day on a day with no entry', () => {
    expect(isWithinBusinessHours(SCHEDULE, at(25, 10), ZONE)).toBe(false)
  })

  it('judges the day in the chosen time zone, not UTC', () => {
    // Monday 22:00 in Fortaleza is already Tuesday 01:00 UTC.
    expect(isWithinBusinessHours('seg 20:00-23:00', at(19, 22), ZONE)).toBe(true)
    expect(isWithinBusinessHours('ter 00:00-04:00', at(19, 22), ZONE)).toBe(false)
  })

  it('is closed when the schedule or zone is invalid', () => {
    expect(isWithinBusinessHours('lixo', at(19, 10), ZONE)).toBe(false)
    expect(isWithinBusinessHours(SCHEDULE, at(19, 10), 'Not/AZone')).toBe(false)
  })
})
