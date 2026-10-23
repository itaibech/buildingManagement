export type Frequency = 'once' | 'monthly' | 'quarterly' | 'yearly'
export type DueBucket = 'overdue' | 'soon' | 'later' | 'none'

const MONTHS: Record<Exclude<Frequency, 'once'>, number> = { monthly: 1, quarterly: 3, yearly: 12 }
const SOON_DAYS = 30

const pad = (n: number): string => String(n).padStart(2, '0')

function parse(iso: string): { y: number; m: number; d: number } {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number)
  return { y, m, d }
}

/** The date a recurring task is next due after being done on `doneOn` (day clamped to month end); null for one-off tasks. */
export function nextDue(doneOn: string, frequency: Frequency): string | null {
  if (frequency === 'once') return null
  const { y, m, d } = parse(doneOn)
  const index = y * 12 + (m - 1) + MONTHS[frequency]
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${pad(month)}-${pad(Math.min(d, lastDay))}`
}

function addDays(iso: string, days: number): string {
  const { y, m, d } = parse(iso)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Overdue (before today), soon (within 30 days, inclusive), later, or none (no date). */
export function dueBucket(due: string | null, today: string): DueBucket {
  if (!due) return 'none'
  if (due < today) return 'overdue'
  return due <= addDays(today, SOON_DAYS) ? 'soon' : 'later'
}
