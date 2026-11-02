import type { AutomationLogStepResult } from '@/types'
import { isValidTimeZone, LEGACY_CONDITION_TIMEZONE } from './time-of-day'

/**
 * "Send at most once per day per contact" — an optional switch stored in
 * an automation's `trigger_config` (no migration needed):
 *
 *   { once_per_day: true, once_per_day_timezone: 'America/Fortaleza' }
 *
 * Typical use: an away / out-of-hours message. The customer may write ten
 * times in the evening; they should get the away message once, not ten
 * times. Only runs that actually SENT something count, so a run that
 * fired inside business hours (and sent nothing) does not use up the day.
 */

export interface OncePerDayConfig {
  once_per_day?: boolean
  once_per_day_timezone?: string
}

/** Step types that put a message in front of the customer. */
export const SENDING_STEP_TYPES = new Set<string>([
  'send_message',
  'send_buttons',
  'send_list',
  'send_template',
])

export function oncePerDayEnabled(triggerConfig: unknown): boolean {
  return Boolean((triggerConfig as OncePerDayConfig | null)?.once_per_day)
}

export function oncePerDayTimeZone(triggerConfig: unknown): string {
  const zone = (triggerConfig as OncePerDayConfig | null)?.once_per_day_timezone
  return isValidTimeZone(zone) ? zone : LEGACY_CONDITION_TIMEZONE
}

/**
 * The instant local midnight began for `now` in `timeZone`. "Day" means
 * the calendar day where the business is, so a customer who wrote at
 * 23:00 gets the message again after midnight, not 24h later.
 */
export function startOfDayInTimeZone(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const elapsedMs =
    ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second')) * 1000 +
    now.getUTCMilliseconds()
  return new Date(now.getTime() - elapsedMs)
}

/** True when a run's log shows at least one message successfully sent. */
export function logSentMessage(steps: AutomationLogStepResult[] | null | undefined): boolean {
  return (steps ?? []).some(
    (s) => s?.status === 'success' && SENDING_STEP_TYPES.has(String(s.step_type)),
  )
}
