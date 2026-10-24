import { isValidTimeZone, LEGACY_CONDITION_TIMEZONE, minutesInTimeZone } from './time-of-day'

/**
 * Weekly opening hours for the `business_hours` condition, written as text:
 *
 *   seg-sex 08:00-17:00; sab 08:00-12:00
 *
 * Entries are separated by `;` or a new line. Each is a list of days
 * (`seg`, `ter`, ... or a range such as `seg-sex`, joined with commas)
 * followed by an `HH:mm-HH:mm` window. A day with no entry is closed.
 * English names (mon, tue...) work too. The condition is true while the
 * business is OPEN.
 */

export interface ScheduleEntry {
  days: number[]
  from: number
  to: number
}

// JS weekday numbers: 0 = Sunday ... 6 = Saturday.
const DAY_BY_NAME: Record<string, number> = {
  dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

function dayNumber(token: string): number | null {
  const key = token
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .slice(0, 3)
  return key in DAY_BY_NAME ? DAY_BY_NAME[key] : null
}

function parseDays(spec: string): number[] | null {
  const days = new Set<number>()
  for (const part of spec.split(',')) {
    const bounds = part.split('-')
    if (bounds.length === 1) {
      const d = dayNumber(bounds[0])
      if (d === null) return null
      days.add(d)
    } else if (bounds.length === 2) {
      const a = dayNumber(bounds[0])
      const b = dayNumber(bounds[1])
      if (a === null || b === null) return null
      // A range may wrap around the weekend (sex-seg).
      for (let d = a; ; d = (d + 1) % 7) {
        days.add(d)
        if (d === b) break
      }
    } else {
      return null
    }
  }
  return days.size > 0 ? [...days] : null
}

function parseClock(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (min > 59 || h > 24 || (h === 24 && min > 0)) return null
  return h * 60 + min
}

/** Parse the schedule text; null when it is empty or any entry is malformed. */
export function parseSchedule(text: string | undefined): ScheduleEntry[] | null {
  const entries: ScheduleEntry[] = []
  for (const raw of (text ?? '').split(/[;\n]/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^(.+?)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/)
    if (!m) return null
    const days = parseDays(m[1])
    const from = parseClock(m[2])
    const to = parseClock(m[3])
    if (!days || from === null || to === null || from >= to) return null
    entries.push({ days, from, to })
  }
  return entries.length > 0 ? entries : null
}

export function weekdayInTimeZone(now: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name)
}

/** True while the schedule says the business is open; false when closed or unparsable. */
export function isWithinBusinessHours(
  schedule: string | undefined,
  now: Date,
  timeZone: string | undefined,
): boolean {
  const entries = parseSchedule(schedule)
  if (!entries) return false
  const zone = timeZone ?? LEGACY_CONDITION_TIMEZONE
  if (!isValidTimeZone(zone)) return false
  const day = weekdayInTimeZone(now, zone)
  const mins = minutesInTimeZone(now, zone)
  return entries.some((e) => e.days.includes(day) && mins >= e.from && mins < e.to)
}
