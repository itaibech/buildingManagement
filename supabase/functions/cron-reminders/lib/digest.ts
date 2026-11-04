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

export interface DueEntry { item: ReminderItem; offset: number }

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

/** The offset an item is due today, or null. Contracts end, they don't become overdue. */
function offsetFor(item: ReminderItem, s: ReminderSettings, today: string): number | null {
  if (!item.dueOn) return null
  const diff = daysBetween(today, item.dueOn)
  if (diff === null) return null
  if (diff === 0) return TODAY
  if (diff > 0) return cleanDays(s.daysBefore).includes(diff) ? diff : null
  return diff === -1 && s.includeOverdue && item.kind === 'task' ? OVERDUE : null
}

/**
 * Today's digest: every item whose due date is exactly one of the offsets away (or today, or yesterday when overdue
 * is on), minus what was already sent (`sent`: entryKey values). Nothing while the building turned reminders off.
 */
export function selectDue(items: readonly ReminderItem[], s: ReminderSettings, today: string, sent: ReadonlySet<string>): DueEntry[] {
  if (!s.enabled) return []
  const out: DueEntry[] = []
  for (const item of items) {
    const offset = offsetFor(item, s, today)
    if (offset === null || !item.dueOn || sent.has(entryKey(item.kind, item.id, item.dueOn, offset))) continue
    out.push({ item, offset })
  }
  return out
}
