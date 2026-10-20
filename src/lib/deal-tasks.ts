/**
 * Colour logic for deal tasks (migration 069).
 *
 * Task dates are plain calendar dates ("2026-10-20"), compared as strings
 * against "today" in the viewer's own time zone — never through a UTC
 * `toISOString()`, which would flip the day for people in the evening.
 *
 *   done      completed (whatever the dates say)
 *   overdue   open, and its end date is before today
 *   active    open, started, and today is on or before its end date
 *   upcoming  open, and not started yet
 *
 * A card turns RED when any open task is overdue and GREEN when it has
 * active tasks and none overdue. With only tasks that haven't started yet
 * it shows a neutral (grey) note, so the card still says a task is coming;
 * done tasks alone show nothing.
 */

export type TaskState = 'done' | 'overdue' | 'active' | 'upcoming';

export interface TaskDates {
  start_date: string;
  end_date: string;
  completed_at: string | null;
}

export interface TaskSummary {
  overdue: number;
  active: number;
  upcoming: number;
  done: number;
  /** What the card shows: red beats green beats grey; none = nothing to flag. */
  status: 'overdue' | 'active' | 'upcoming' | 'none';
  /** red: the oldest missed end date; green: the next end date to arrive;
   *  grey: the earliest start date. */
  date: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` for the local calendar day of `now`. */
export function localDateString(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function taskState(task: TaskDates, today: string): TaskState {
  if (task.completed_at) return 'done';
  if (task.end_date < today) return 'overdue';
  if (task.start_date > today) return 'upcoming';
  return 'active';
}

export function summarizeTasks(tasks: TaskDates[] | null | undefined, today: string): TaskSummary {
  const summary: TaskSummary = {
    overdue: 0,
    active: 0,
    upcoming: 0,
    done: 0,
    status: 'none',
    date: null,
  };
  let oldestOverdueEnd: string | null = null;
  let nextActiveEnd: string | null = null;
  let earliestStart: string | null = null;

  for (const task of tasks ?? []) {
    const state = taskState(task, today);
    summary[state] += 1;
    if (state === 'overdue' && (!oldestOverdueEnd || task.end_date < oldestOverdueEnd)) {
      oldestOverdueEnd = task.end_date;
    }
    if (state === 'active' && (!nextActiveEnd || task.end_date < nextActiveEnd)) {
      nextActiveEnd = task.end_date;
    }
    if (state === 'upcoming' && (!earliestStart || task.start_date < earliestStart)) {
      earliestStart = task.start_date;
    }
  }

  if (summary.overdue > 0) {
    summary.status = 'overdue';
    summary.date = oldestOverdueEnd;
  } else if (summary.active > 0) {
    summary.status = 'active';
    summary.date = nextActiveEnd;
  } else if (summary.upcoming > 0) {
    summary.status = 'upcoming';
    summary.date = earliestStart;
  }
  return summary;
}

/** Format a `YYYY-MM-DD` date for display without any time-zone shift. */
export function formatTaskDate(date: string, locale: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
  });
}
