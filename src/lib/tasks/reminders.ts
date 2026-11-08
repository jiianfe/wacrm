import type { SupabaseClient } from '@supabase/supabase-js'
import { todayFortaleza } from '@/lib/finance/finance'
import { sendToSubscriptions } from '@/lib/push/send'

/** Reminders go out from this hour (Fortaleza) on, so nobody is paged at night. */
export const REMINDER_FROM_HOUR = 7

export type ReminderKind = 'today' | 'overdue'

export interface ReminderTask {
  id: string
  end_date: string
  completed_at: string | null
  reminded_on: string | null
}

/** Hour of the day (0-23) in Fortaleza. */
export function fortalezaHour(now: Date = new Date()): number {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Fortaleza',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now)
  return Number(h)
}

/**
 * What to tell the assignee about a task today, or null for nothing: open
 * tasks that end today or already ended, at most once per day.
 */
export function reminderKind(task: ReminderTask, today: string): ReminderKind | null {
  if (task.completed_at) return null
  if (task.reminded_on === today) return null
  if (task.end_date === today) return 'today'
  if (task.end_date < today) return 'overdue'
  return null
}

const dayMonth = (date: string) => date.split('-').reverse().slice(0, 2).join('/')

export function reminderText(kind: ReminderKind, title: string, endDate: string) {
  return kind === 'today'
    ? { title: `Tarefa para hoje: ${title}`, body: 'O prazo termina hoje.' }
    : { title: `Tarefa atrasada: ${title}`, body: `O prazo era ${dayMonth(endDate)}.` }
}

interface DueRow {
  id: string
  account_id: string
  title: string
  end_date: string
  assigned_to: string | null
  user_id: string | null
  completed_at: string | null
  reminded_on: string | null
}

/**
 * Notifies the people responsible for tasks that end today or are overdue:
 * a notification row (bell) per task and one push per person. Each task is
 * claimed first (reminded_on = today), so overlapping runs never double-send.
 * Returns how many tasks were reminded.
 */
export async function runTaskReminders(admin: SupabaseClient, now: Date = new Date()): Promise<number> {
  if (fortalezaHour(now) < REMINDER_FROM_HOUR) return 0
  const today = todayFortaleza(now)

  const { data, error } = await admin
    .from('deal_tasks')
    .select('id, account_id, title, end_date, assigned_to, user_id, completed_at, reminded_on')
    .is('completed_at', null)
    .lte('end_date', today)
    .or(`reminded_on.is.null,reminded_on.lt.${today}`)
    .limit(500)
  if (error || !data?.length) return 0

  const due = (data as DueRow[]).filter((t) => reminderKind(t, today))

  // Who is responsible: the assignee's login, else whoever created the task.
  const profileIds = [...new Set(due.map((t) => t.assigned_to).filter((x): x is string => !!x))]
  const userOfProfile = new Map<string, string>()
  if (profileIds.length) {
    const { data: profiles } = await admin.from('profiles').select('id, user_id').in('id', profileIds)
    for (const p of (profiles ?? []) as { id: string; user_id: string }[]) userOfProfile.set(p.id, p.user_id)
  }
  const withRecipient = due
    .map((t) => ({ task: t, userId: (t.assigned_to && userOfProfile.get(t.assigned_to)) || t.user_id }))
    .filter((x): x is { task: DueRow; userId: string } => !!x.userId)
  if (!withRecipient.length) return 0

  // Claim before sending.
  const { data: claimed } = await admin
    .from('deal_tasks')
    .update({ reminded_on: today })
    .in('id', withRecipient.map((x) => x.task.id))
    .or(`reminded_on.is.null,reminded_on.lt.${today}`)
    .select('id')
  const claimedIds = new Set(((claimed ?? []) as { id: string }[]).map((r) => r.id))
  const mine = withRecipient.filter((x) => claimedIds.has(x.task.id))
  if (!mine.length) return 0

  await admin.from('notifications').insert(
    mine.map(({ task, userId }) => {
      const text = reminderText(reminderKind({ ...task, reminded_on: null }, today) ?? 'overdue', task.title, task.end_date)
      return {
        account_id: task.account_id,
        user_id: userId,
        type: 'task_due',
        task_id: task.id,
        title: text.title.slice(0, 250),
        body: text.body,
      }
    }),
  )

  // One push per person, summarising their tasks.
  const byUser = new Map<string, DueRow[]>()
  for (const { task, userId } of mine) byUser.set(userId, [...(byUser.get(userId) ?? []), task])
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', [...byUser.keys()])
  for (const [userId, tasks] of byUser) {
    const own = ((subs ?? []) as { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }[]).filter(
      (s) => s.user_id === userId,
    )
    const first = tasks[0]
    const kind = reminderKind({ ...first, reminded_on: null }, today) ?? 'overdue'
    const text = reminderText(kind, first.title, first.end_date)
    await sendToSubscriptions(admin, own, {
      title: tasks.length === 1 ? text.title : `${tasks.length} tarefas para hoje ou atrasadas`,
      body: tasks.length === 1 ? text.body : tasks.slice(0, 3).map((t) => t.title).join(' · '),
      tag: 'tasks-due',
      url: '/tasks',
    })
  }
  return mine.length
}
