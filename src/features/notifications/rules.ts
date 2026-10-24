// Which live changes notify whom. Pure: no React, no supabase. Task 18 (page permissions) adds its check here.
import type { Database } from '../../lib/db.types'
import { he } from '../../lib/he'

type Tables = Database['public']['Tables']
export type AnnouncementRowLite = Pick<Tables['announcements']['Row'], 'id' | 'title' | 'author_id' | 'expires_at'>
export type TicketRowLite = Pick<Tables['tickets']['Row'], 'id' | 'title' | 'status' | 'opened_by' | 'last_activity_by' | 'last_activity_kind'>
export type CommentRowLite = Pick<Tables['ticket_comments']['Row'], 'id' | 'ticket_id' | 'author_id'>

/** One Realtime change, as delivered by the subscription (only the columns the rules read). */
export type ChangeEvent =
  | { table: 'announcements'; row: AnnouncementRowLite }
  | { table: 'tickets'; type: 'INSERT' | 'UPDATE'; row: TicketRowLite }
  | { table: 'ticket_comments'; row: CommentRowLite }

export interface Viewer {
  userId: string
  isAdmin: boolean
}

/** What the viewer may know about the call an event is about (from my_ticket_activity). */
export interface TicketRef {
  opened_by: string | null
  title: string
  apartment_number: number | null
}

export type NoticeKind = 'announcement' | 'ticketNew' | 'ticketEdited' | 'ticketStatus' | 'ticketComment'

export interface Notice {
  kind: NoticeKind
  /** The toast's main line, e.g. "הודעה חדשה: <title>". */
  text: string
  /** A second line (the call's title when the main line doesn't carry it). */
  detail?: string
  /** Where "לצפייה" goes. */
  path: string
}

const ticketPath = (id: string): string => `/tickets/${id}`
const statusLabel = (s: string): string => (s === 'open' || s === 'in_progress' || s === 'closed' ? he.ticketStatus[s] : s)

function forAnnouncement(row: AnnouncementRowLite, viewer: Viewer, today: string): Notice | null {
  if (row.author_id === viewer.userId) return null
  if (row.expires_at !== null && row.expires_at < today) return null
  return { kind: 'announcement', text: he.notifications.newAnnouncement(row.title), path: '/announcements' }
}

/** Admins: a new call and an opener's edit. Residents: a status change on a call they opened. */
function forTicket(type: 'INSERT' | 'UPDATE', row: TicketRowLite, viewer: Viewer, ticket: TicketRef | null): Notice | null {
  if (row.last_activity_by === viewer.userId) return null
  const path = ticketPath(row.id)
  if (viewer.isAdmin) {
    if (type === 'INSERT') {
      return { kind: 'ticketNew', text: he.notifications.newTicket(row.title, ticket?.apartment_number ?? null), path }
    }
    const byOpener = row.last_activity_by !== null && row.last_activity_by === row.opened_by
    return row.last_activity_kind === 'edited' && byOpener ? { kind: 'ticketEdited', text: he.notifications.ticketEdited(row.title), path } : null
  }
  if (type !== 'UPDATE' || row.opened_by !== viewer.userId || row.last_activity_kind !== 'status') return null
  return { kind: 'ticketStatus', text: he.notifications.statusChanged(statusLabel(row.status)), detail: row.title, path }
}

/** Admins: any comment by someone else. Residents: a comment by someone else on a call they opened. */
function forComment(row: CommentRowLite, viewer: Viewer, ticket: TicketRef | null): Notice | null {
  if (row.author_id === viewer.userId || !ticket) return null
  if (!viewer.isAdmin && ticket.opened_by !== viewer.userId) return null
  return { kind: 'ticketComment', text: he.notifications.newComment(ticket.title), path: ticketPath(row.ticket_id) }
}

/**
 * The notice a change should raise for this viewer, or null. The viewer's own actions never notify them.
 * `ticket` is the call the event is about (needed for comments and the apartment number), when the viewer can see it.
 */
export function qualify(event: ChangeEvent, viewer: Viewer, ticket: TicketRef | null, today: string): Notice | null {
  switch (event.table) {
    case 'announcements':
      return forAnnouncement(event.row, viewer, today)
    case 'tickets':
      return forTicket(event.type, event.row, viewer, ticket)
    case 'ticket_comments':
      return forComment(event.row, viewer, ticket)
  }
}

/** The call an event is about, if any. */
export function ticketIdOf(event: ChangeEvent): string | null {
  if (event.table === 'tickets') return event.row.id
  if (event.table === 'ticket_comments') return event.row.ticket_id
  return null
}

/** Whether qualify() needs the call's TicketRef: comments, and a new call for admins (the apartment number). */
export function needsTicketRef(event: ChangeEvent, viewer: Viewer): boolean {
  return event.table === 'ticket_comments' || (event.table === 'tickets' && event.type === 'INSERT' && viewer.isAdmin)
}
