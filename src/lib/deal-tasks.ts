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

export type TaskPriority = 'high' | 'normal' | 'low';
export const TASK_PRIORITIES: TaskPriority[] = ['high', 'normal', 'low'];

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

/**
 * Which tab of the Tasks page a task belongs to (open tasks only differ by
 * their end date): overdue < today, due today, later; done when completed.
 */
export type TaskBucket = 'overdue' | 'today' | 'later' | 'done';

export function taskBucket(task: Pick<TaskDates, 'end_date' | 'completed_at'>, today: string): TaskBucket {
  if (task.completed_at) return 'done';
  if (task.end_date < today) return 'overdue';
  if (task.end_date === today) return 'today';
  return 'later';
}

export interface SortableTask extends TaskDates {
  priority: TaskPriority;
  title: string;
}

/** Open tasks first, soonest end date first, then priority; done tasks last (newest first). */
export function compareTasks(a: SortableTask, b: SortableTask): number {
  const aDone = !!a.completed_at;
  const bDone = !!b.completed_at;
  if (aDone !== bDone) return aDone ? 1 : -1;
  if (aDone && bDone) return (b.completed_at as string).localeCompare(a.completed_at as string);
  if (a.end_date !== b.end_date) return a.end_date.localeCompare(b.end_date);
  const byPriority = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
  return byPriority || a.title.localeCompare(b.title);
}

/** Format a `YYYY-MM-DD` date for display without any time-zone shift. */
export function formatTaskDate(date: string, locale: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
  });
}
