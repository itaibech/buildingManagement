/** The admin "לטיפולך" inbox (Task 26): what needs a decision, as counts with deep links. Pure. */
import { daysSince, type LastReminder } from '../email/reminders'

export type InboxKey = 'users' | 'tickets' | 'maintenance' | 'publish' | 'invited' | 'debtors'
export interface InboxItem { key: InboxKey; count: number; to: string }
export interface InboxInput {
  pendingUsers: number
  unseenTickets: number
  overdueTasks: number
  /** Closed meetings waiting to be published. */
  toPublish: number
  /** Invited meetings within the next 7 days (and the soonest one's id). */
  invited: { count: number; firstId: string | null }
  /** Debtors with no reminder in the last 30 days. */
  staleDebtors: number
}

const DAY = 86_400_000
export const REMINDER_DAYS = 30

/** The rows with something open, in a fixed order. */
export function inboxItems(i: InboxInput): InboxItem[] {
  const rows: InboxItem[] = [
    { key: 'users', count: i.pendingUsers, to: '/users' },
    { key: 'tickets', count: i.unseenTickets, to: '/tickets' },
    { key: 'maintenance', count: i.overdueTasks, to: '/maintenance' },
    { key: 'publish', count: i.toPublish, to: '/meetings?tab=pending' },
    { key: 'invited', count: i.invited.count, to: i.invited.count === 1 && i.invited.firstId ? `/meetings/${i.invited.firstId}` : '/meetings' },
    { key: 'debtors', count: i.staleDebtors, to: '/finance?tab=balances' },
  ]
  return rows.filter((r) => r.count > 0)
}

/** Invited meetings from now to 7 days ahead; the soonest first. */
export function upcomingInvited(meetings: readonly { id: string; status: string; scheduled_at: string }[], now: Date): { count: number; firstId: string | null } {
  const t = now.getTime()
  const soon = meetings
    .filter((m) => m.status === 'invited' && Date.parse(m.scheduled_at) >= t && Date.parse(m.scheduled_at) <= t + 7 * DAY)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
  return { count: soon.length, firstId: soon[0]?.id ?? null }
}

/** Debtors whose last reminder is older than 30 days, or who never got one. */
export function staleDebtors(balances: readonly { apartmentId: string; balance: number }[], last: ReadonlyMap<string, LastReminder>, today: string): number {
  return balances.filter((b) => {
    if (b.balance <= 0) return false
    const l = last.get(b.apartmentId)
    return !l || daysSince(l.at, today) > REMINDER_DAYS
  }).length
}
