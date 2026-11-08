import { describe, expect, it } from 'vitest'
import { compareTasks, taskBucket, type SortableTask } from '@/lib/deal-tasks'
import { fortalezaHour, reminderKind, reminderText } from './reminders'

const open = { completed_at: null, reminded_on: null }

describe('reminderKind', () => {
  it('reminds tasks ending today and overdue ones, not future ones', () => {
    expect(reminderKind({ id: '1', end_date: '2026-11-08', ...open }, '2026-11-08')).toBe('today')
    expect(reminderKind({ id: '1', end_date: '2026-11-07', ...open }, '2026-11-08')).toBe('overdue')
    expect(reminderKind({ id: '1', end_date: '2026-11-09', ...open }, '2026-11-08')).toBeNull()
  })

  it('skips done tasks and tasks already reminded today', () => {
    expect(
      reminderKind({ id: '1', end_date: '2026-11-08', completed_at: '2026-11-08T10:00:00Z', reminded_on: null }, '2026-11-08'),
    ).toBeNull()
    expect(
      reminderKind({ id: '1', end_date: '2026-11-01', completed_at: null, reminded_on: '2026-11-08' }, '2026-11-08'),
    ).toBeNull()
    expect(
      reminderKind({ id: '1', end_date: '2026-11-01', completed_at: null, reminded_on: '2026-11-07' }, '2026-11-08'),
    ).toBe('overdue')
  })
})

describe('reminderText', () => {
  it('names the task and the deadline', () => {
    expect(reminderText('today', 'Entregar extintores', '2026-11-10').title).toBe('Tarefa para hoje: Entregar extintores')
    expect(reminderText('overdue', 'Ligar', '2026-11-03').body).toBe('O prazo era 03/11.')
  })
})

describe('fortalezaHour', () => {
  it('uses Fortaleza time (UTC-3)', () => {
    expect(fortalezaHour(new Date('2026-11-08T10:30:00Z'))).toBe(7)
    expect(fortalezaHour(new Date('2026-11-08T02:00:00Z'))).toBe(23)
  })
})

describe('taskBucket and compareTasks', () => {
  const t = (end: string, priority: SortableTask['priority'] = 'normal', done = false): SortableTask => ({
    title: end + priority,
    start_date: '2026-11-01',
    end_date: end,
    priority,
    completed_at: done ? '2026-11-08T12:00:00Z' : null,
  })

  it('buckets by end date', () => {
    expect(taskBucket(t('2026-11-07'), '2026-11-08')).toBe('overdue')
    expect(taskBucket(t('2026-11-08'), '2026-11-08')).toBe('today')
    expect(taskBucket(t('2026-11-09'), '2026-11-08')).toBe('later')
    expect(taskBucket(t('2026-11-01', 'normal', true), '2026-11-08')).toBe('done')
  })

  it('orders open tasks by date then priority, done last', () => {
    const list = [t('2026-11-09', 'low'), t('2026-11-09', 'high'), t('2026-11-05'), t('2026-11-01', 'normal', true)]
    const sorted = [...list].sort(compareTasks)
    expect(sorted.map((x) => x.title)).toEqual(['2026-11-05normal', '2026-11-09high', '2026-11-09low', '2026-11-01normal'])
  })
})
