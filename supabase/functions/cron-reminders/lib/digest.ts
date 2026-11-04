/**
 * cron-reminders: which maintenance items are due a reminder today (pure: no Deno or network imports, so Vitest can
 * load it). Dates are calendar days in Israel (YYYY-MM-DD), like the app's todayISO().
 */

export type ItemKind = 'task' | 'contract'

/** A maintenance task / inspection (next_due) or a supplier contract (ends_on), as read at send time. */
export interface ReminderItem {
  kind: ItemKind
  id: string
  title: string
  /** null = nothing due (a one-off task already done, an undated contract): never reminded. */
  dueOn: string | null
  /** The item's own reminder window (remind_days, 0032): one more offset besides the building's. 0 = none. */
  remindDays: number
  supplierId: string | null
  supplierName: string | null
  supplierPhone: string | null
}

/** maintenance_reminder_settings (0038); no row = DEFAULT_SETTINGS. */
export interface ReminderSettings { enabled: boolean; daysBefore: number[]; includeOverdue: boolean }
export const DEFAULT_SETTINGS: ReminderSettings = { enabled: true, daysBefore: [7, 1], includeOverdue: true }

/** offset_days: days before the due date; 0 = the day itself, -1 = overdue (the day after, tasks only). */
export const TODAY = 0
export const OVERDUE = -1
export const MAX_DAYS_BEFORE = 60
/** The largest offset (an item's remind_days) and how far back an overdue task is still looked at. */
export const MAX_OFFSET = 365

/** offset: the log's offset_days; daysLeft: days from today to the due date (negative = overdue), for the email. */
export interface DueEntry { item: ReminderItem; offset: number; daysLeft: number }

/** The once-only key, as in maintenance_reminders_log's unique index. */
export const entryKey = (kind: ItemKind, id: string, dueOn: string, offset: number): string => `${kind}:${id}:${dueOn}:${offset}`

const israelFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' })

/** The calendar day in Israel at `ms` (DST included), as YYYY-MM-DD. */
export const israelDate = (ms: number): string => israelFormat.format(ms)

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

const dayNumber = (iso: string): number | null => {
  const m = DATE.exec(iso.slice(0, 10))
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS : null
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); null when either isn't a date. */
export function daysBetween(from: string, to: string): number | null {
  const a = dayNumber(from)
  const b = dayNumber(to)
  return a === null || b === null ? null : b - a
}

/** The settings' distinct valid offsets (1-60 days before). */
export const cleanDays = (days: readonly number[]): number[] =>
  [...new Set(days.filter((d) => Number.isInteger(d) && d >= 1 && d <= MAX_DAYS_BEFORE))].sort((a, b) => b - a)

/** Every offset of the item, smallest first: the day itself, the building's days, the item's own remind_days. */
export const offsetsFor = (item: ReminderItem, s: ReminderSettings): number[] => [...new Set([TODAY, ...cleanDays(s.daysBefore),
  ...(Number.isInteger(item.remindDays) && item.remindDays > 0 && item.remindDays <= MAX_OFFSET ? [item.remindDays] : [])])]
  .sort((a, b) => a - b)

/**
 * The reminder the item is due now, or null. Before the due date: the smallest offset whose day has come (today is
 * on or after "due − offset"), so a missed day is caught up on the next run and a later offset replaces an earlier
 * one. On the day: 0. After it: overdue (tasks only, once per due date).
 */
function offsetFor(item: ReminderItem, s: ReminderSettings, today: string): { offset: number; daysLeft: number } | null {
  if (!item.dueOn) return null
  const daysLeft = daysBetween(today, item.dueOn)
  if (daysLeft === null || daysLeft > MAX_OFFSET) return null
  if (daysLeft < 0) return s.includeOverdue && item.kind === 'task' && daysLeft >= -MAX_OFFSET ? { offset: OVERDUE, daysLeft } : null
  const offset = offsetsFor(item, s).find((k) => k >= daysLeft)
  return offset === undefined ? null : { offset, daysLeft }
}

/**
 * Today's digest for one recipient: each item's current reminder (offsetFor), minus what was already sent to them
 * (`sent`: entryKey values). Nothing while the building turned reminders off.
 */
export function selectDue(items: readonly ReminderItem[], s: ReminderSettings, today: string, sent: ReadonlySet<string>): DueEntry[] {
  if (!s.enabled) return []
  const out: DueEntry[] = []
  for (const item of items) {
    const due = offsetFor(item, s, today)
    if (due === null || !item.dueOn || sent.has(entryKey(item.kind, item.id, item.dueOn, due.offset))) continue
    out.push({ item, ...due })
  }
  return out
}
