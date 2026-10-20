import { describe, expect, it } from 'vitest';
import { localDateString, summarizeTasks, taskState, type TaskDates } from './deal-tasks';

const TODAY = '2026-10-20';

const task = (
  start: string,
  end: string,
  completed_at: string | null = null,
): TaskDates => ({ start_date: start, end_date: end, completed_at });

describe('localDateString', () => {
  it('uses the local calendar day, not UTC', () => {
    // 23:59 local on the 20th is still the 20th (UTC would already be the 21st in Brazil).
    expect(localDateString(new Date(2026, 9, 20, 23, 59))).toBe('2026-10-20');
    expect(localDateString(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });
});

describe('taskState', () => {
  it('is overdue only after the end date has passed', () => {
    expect(taskState(task('2026-10-01', '2026-10-19'), TODAY)).toBe('overdue');
    // The end date itself still counts as live: it is due today.
    expect(taskState(task('2026-10-01', '2026-10-20'), TODAY)).toBe('active');
  });

  it('is active from the start date on', () => {
    expect(taskState(task('2026-10-20', '2026-10-25'), TODAY)).toBe('active');
    expect(taskState(task('2026-10-10', '2026-10-25'), TODAY)).toBe('active');
  });

  it('is upcoming before the start date', () => {
    expect(taskState(task('2026-10-21', '2026-10-25'), TODAY)).toBe('upcoming');
  });

  it('is done when completed, even if it would be overdue', () => {
    expect(taskState(task('2026-10-01', '2026-10-05', '2026-10-04T10:00:00Z'), TODAY)).toBe('done');
  });

  it('handles a one-day task', () => {
    expect(taskState(task('2026-10-20', '2026-10-20'), TODAY)).toBe('active');
    expect(taskState(task('2026-10-19', '2026-10-19'), TODAY)).toBe('overdue');
  });
});

describe('summarizeTasks', () => {
  it('has nothing to flag without tasks', () => {
    expect(summarizeTasks([], TODAY).status).toBe('none');
    expect(summarizeTasks(undefined, TODAY).status).toBe('none');
  });

  it('is green with an active task and shows the next end date', () => {
    const s = summarizeTasks(
      [task('2026-10-10', '2026-10-30'), task('2026-10-15', '2026-10-22')],
      TODAY,
    );
    expect(s).toMatchObject({ status: 'active', active: 2, date: '2026-10-22' });
  });

  it('is red when any open task is overdue, even next to an active one', () => {
    const s = summarizeTasks(
      [
        task('2026-10-10', '2026-10-30'),
        task('2026-09-01', '2026-10-05'),
        task('2026-09-20', '2026-10-12'),
      ],
      TODAY,
    );
    expect(s).toMatchObject({ status: 'overdue', overdue: 2, active: 1, date: '2026-10-05' });
  });

  it('shows nothing for done tasks only', () => {
    const s = summarizeTasks(
      [task('2026-10-01', '2026-10-05', '2026-10-04T10:00:00Z')],
      TODAY,
    );
    expect(s).toMatchObject({ status: 'none', done: 1, date: null });
  });

  it('is grey with only tasks that have not started, showing the earliest start', () => {
    const s = summarizeTasks(
      [
        task('2026-10-21', '2026-10-22'),
        task('2026-11-01', '2026-11-05'),
        task('2026-09-01', '2026-09-05', '2026-09-04T10:00:00Z'),
      ],
      TODAY,
    );
    expect(s).toMatchObject({ status: 'upcoming', upcoming: 2, done: 1, date: '2026-10-21' });
  });

  it('prefers green or red over an upcoming task', () => {
    expect(
      summarizeTasks([task('2026-10-10', '2026-10-30'), task('2026-11-01', '2026-11-05')], TODAY)
        .status,
    ).toBe('active');
    expect(
      summarizeTasks([task('2026-09-01', '2026-10-05'), task('2026-11-01', '2026-11-05')], TODAY)
        .status,
    ).toBe('overdue');
  });

  it('turns green again once the overdue task is completed', () => {
    const s = summarizeTasks(
      [task('2026-09-01', '2026-10-05', '2026-10-19T12:00:00Z'), task('2026-10-10', '2026-10-30')],
      TODAY,
    );
    expect(s.status).toBe('active');
  });
});
