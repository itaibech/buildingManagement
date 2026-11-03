export type Frequency = 'once' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly'
export type DueBucket = 'overdue' | 'soon' | 'later' | 'none'

export const FREQUENCY_MONTHS: Record<Exclude<Frequency, 'once'>, number> = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 }
/** The default "remind N days before" window (maintenance_tasks.remind_days, supplier_contracts.remind_days). */
export const SOON_DAYS = 30
/** Monthly items remind a week ahead: a 30-day window would flag them all month. */
export const MONTHLY_REMIND_DAYS = 7

/** The default reminder for a recurrence of `months` (null = one-off). */
export const defaultRemindDays = (months: number | null): number => (months === 1 ? MONTHLY_REMIND_DAYS : SOON_DAYS)

// The shortest length in days of a period of 1, 3, 6 or 12 months.
const MIN_PERIOD_DAYS: Readonly<Record<number, number>> = { 1: 28, 3: 89, 6: 181, 12: 365 }

/** The reminder window actually used: below one period, so a recurring item isn't "due soon" for its whole cycle. */
export function reminderWindow(remindDays: number, months: number | null): number {
  const min = months === null ? undefined : MIN_PERIOD_DAYS[months]
  return min === undefined ? remindDays : Math.min(remindDays, min - 1)
}

export const frequencyMonths = (f: Frequency): number | null => (f === 'once' ? null : FREQUENCY_MONTHS[f])

/** A task's due bucket with its own (capped) reminder window. */
export function taskBucket(t: { next_due: string | null; remind_days: number; frequency: Frequency }, today: string): DueBucket {
  return dueBucket(t.next_due, today, reminderWindow(t.remind_days, frequencyMonths(t.frequency)))
}

const pad = (n: number): string => String(n).padStart(2, '0')

function parse(iso: string): { y: number; m: number; d: number } {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number)
  return { y, m, d }
}

/** `iso` plus whole months, the day clamped to the target month's end (Jan 31 + 1 month = Feb 28/29), like Postgres. */
export function addMonths(iso: string, months: number): string {
  const { y, m, d } = parse(iso)
  const index = y * 12 + (m - 1) + months
  const year = Math.floor(index / 12)
  const month = (index - year * 12) + 1
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${pad(month)}-${pad(Math.min(d, lastDay))}`
}

/** The date a recurring task is next due after being done on `doneOn` (day clamped to month end); null for one-off tasks. */
export function nextDue(doneOn: string, frequency: Frequency): string | null {
  return frequency === 'once' ? null : addMonths(doneOn, FREQUENCY_MONTHS[frequency])
}

export function addDays(iso: string, days: number): string {
  const { y, m, d } = parse(iso)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Overdue (before today), soon (within `soonDays`, inclusive; the task's reminder window), later, or none (no date). */
export function dueBucket(due: string | null, today: string, soonDays: number = SOON_DAYS): DueBucket {
  if (!due) return 'none'
  if (due < today) return 'overdue'
  return due <= addDays(today, soonDays) ? 'soon' : 'later'
}
