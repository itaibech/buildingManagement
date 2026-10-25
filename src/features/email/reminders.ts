/** Per-debtor reminders (Task 26): the last debt email per apartment and the reminder button's state. Pure. */

export interface DebtLogRow { created_at: string; apartment_ids: string[] | null; dry_run: boolean }
export interface LastReminder { at: string; dryRun: boolean }
/** send-email availability, from its preview: real sending, dry run (test mode), unreachable, or not known yet. */
export type EmailStatus = 'live' | 'dryRun' | 'unavailable' | 'loading'
export interface ReminderState { disabled: boolean; reason: 'noEmail' | 'unavailable' | null; testMode: boolean }

/** Apartment id → its newest debt reminder. */
export function lastReminders(rows: readonly DebtLogRow[]): Map<string, LastReminder> {
  const out = new Map<string, LastReminder>()
  for (const r of rows) {
    for (const id of r.apartment_ids ?? []) {
      const prev = out.get(id)
      if (!prev || prev.at < r.created_at) out.set(id, { at: r.created_at, dryRun: r.dry_run })
    }
  }
  return out
}

const israelDay = (iso: string): string => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })

/** Whole days from `iso` (Israel date) to `today` (YYYY-MM-DD). */
export function daysSince(iso: string, today: string): number {
  return Math.round((Date.parse(today) - Date.parse(israelDay(iso))) / 86_400_000)
}

/** Disabled without a resident email or when sending is unavailable; dry run stays enabled as test mode. */
export function reminderState({ hasEmail, status }: { hasEmail: boolean; status: EmailStatus }): ReminderState {
  if (!hasEmail) return { disabled: true, reason: 'noEmail', testMode: false }
  if (status === 'unavailable') return { disabled: true, reason: 'unavailable', testMode: false }
  if (status === 'loading') return { disabled: true, reason: null, testMode: false }
  return { disabled: false, reason: null, testMode: status === 'dryRun' }
}

/**
 * send-email's availability from its status reply. Any HTTP answer (4xx included) means the function is reachable;
 * dryRun is read from the body (when it isn't there, sending is treated as test mode). Only a network error (no
 * status) or a 5xx is 'unavailable'.
 */
export function emailStatusOf(httpStatus: number | null, body: unknown): Exclude<EmailStatus, 'loading'> {
  if (httpStatus === null || httpStatus >= 500) return 'unavailable'
  const dryRun = typeof body === 'object' && body !== null && 'dryRun' in body ? body.dryRun : undefined
  return dryRun === false ? 'live' : 'dryRun'
}
