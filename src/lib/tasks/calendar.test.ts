import { describe, expect, it } from 'vitest'
import { monthGrid, openBlockers, tasksOnDay, wouldCycle } from '@/lib/deal-tasks'

describe('monthGrid', () => {
  it('covers the month in whole Sunday-first weeks', () => {
    const grid = monthGrid(2026, 10) // November 2026 starts on a Sunday
    expect(grid[0][0]).toBe('2026-11-01')
    expect(grid).toHaveLength(5)
    expect(grid[4][6]).toBe('2026-12-05')
    expect(grid.every((w) => w.length === 7)).toBe(true)
  })

  it('pads with the previous month when the 1st is mid-week', () => {
    const grid = monthGrid(2026, 11) // December 2026 starts on a Tuesday
    expect(grid[0][0]).toBe('2026-11-29')
    expect(grid[0][2]).toBe('2026-12-01')
    expect(grid.at(-1)?.includes('2026-12-31')).toBe(true)
  })
})

describe('tasksOnDay', () => {
  it('includes both ends of the period', () => {
    const t = { start_date: '2026-11-10', end_date: '2026-11-12' }
    expect(tasksOnDay([t], '2026-11-09')).toHaveLength(0)
    expect(tasksOnDay([t], '2026-11-10')).toHaveLength(1)
    expect(tasksOnDay([t], '2026-11-12')).toHaveLength(1)
    expect(tasksOnDay([t], '2026-11-13')).toHaveLength(0)
  })
})

describe('dependencies', () => {
  const byId = new Map([
    ['a', { id: 'a', completed_at: null }],
    ['b', { id: 'b', completed_at: '2026-11-01T00:00:00Z' }],
    ['c', { id: 'c', completed_at: null }],
  ])
  const edges = [
    { task_id: 'c', depends_on_id: 'a' },
    { task_id: 'c', depends_on_id: 'b' },
  ]

  it('lists only the open prerequisites', () => {
    expect(openBlockers('c', edges, byId).map((x) => x.id)).toEqual(['a'])
    expect(openBlockers('a', edges, byId)).toEqual([])
  })

  it('detects loops, direct and indirect', () => {
    expect(wouldCycle('a', 'a', edges)).toBe(true)
    expect(wouldCycle('a', 'c', edges)).toBe(true) // c already waits for a
    expect(wouldCycle('c', 'a', [])).toBe(false)
    expect(wouldCycle('b', 'c', edges)).toBe(true) // c waits for b
    expect(wouldCycle('x', 'c', edges)).toBe(false)
  })
})
