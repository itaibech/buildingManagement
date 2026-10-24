// The notification center's list and the call badge, built client-side (pure).
import { he } from '../../lib/he'

export type ActivityKind = 'created' | 'status' | 'edited' | 'other' | 'comment'

/** One row of my_ticket_activity(): a call the user is notified about, and its latest activity by someone else. */
export interface TicketActivity {
  ticket_id: string
  title: string
  status: string
  opened_by: string | null
  apartment_number: number | null
  /** Null when no one else has acted on the call. */
  activity_at: string | null
  activity_by: string | null
  activity_kind: ActivityKind | null
  unseen: boolean
}

export interface FeedAnnouncement {
  id: string
  title: string
  created_at: string
  isRead: boolean
}

export interface FeedItem {
  key: string
  kind: 'announcement' | 'ticket'
  id: string
  title: string
  subtitle: string
  at: string
  unseen: boolean
  path: string
}

const WINDOW_MS = 30 * 86400_000

export function unseenTicketIds(list: readonly TicketActivity[] | undefined): Set<string> {
  return new Set((list ?? []).filter((a) => a.unseen).map((a) => a.ticket_id))
}

export function unseenTicketCount(list: readonly TicketActivity[] | undefined): number {
  return unseenTicketIds(list).size
}

const statusLabel = (s: string): string => (s === 'open' || s === 'in_progress' || s === 'closed' ? he.ticketStatus[s] : s)

function subtitleFor(a: TicketActivity): string {
  if (a.activity_kind === 'status') return he.notifications.statusChanged(statusLabel(a.status))
  return he.notifications.kinds[a.activity_kind ?? 'other']
}

function ticketItem(a: TicketActivity & { activity_at: string }): FeedItem {
  return {
    key: `ticket:${a.ticket_id}`, kind: 'ticket', id: a.ticket_id, title: a.title, subtitle: subtitleFor(a),
    at: a.activity_at, unseen: a.unseen, path: `/tickets/${a.ticket_id}`,
  }
}

function announcementItem(a: FeedAnnouncement): FeedItem {
  return {
    key: `announcement:${a.id}`, kind: 'announcement', id: a.id, title: a.title, subtitle: he.notifications.kinds.announcement,
    at: a.created_at, unseen: !a.isRead, path: '/announcements',
  }
}

/** Visible announcements and call activity from the last 30 days, newest first. */
export function buildFeed(announcements: readonly FeedAnnouncement[], activity: readonly TicketActivity[], now: Date = new Date()): FeedItem[] {
  const since = now.getTime() - WINDOW_MS
  const recent = (iso: string): boolean => new Date(iso).getTime() >= since
  const tickets = activity
    .filter((a): a is TicketActivity & { activity_at: string } => a.activity_at !== null && recent(a.activity_at))
    .map(ticketItem)
  const notices = announcements.filter((a) => recent(a.created_at)).map(announcementItem)
  return [...tickets, ...notices].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}
