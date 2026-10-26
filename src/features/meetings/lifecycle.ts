import type { MeetingStatus, Signature } from './types'

export type MeetingAction = 'edit' | 'delete' | 'invite' | 'quickStart' | 'updateInvite' | 'run' | 'sign' | 'publish' | 'addendum' | 'print'
export type MeetingTab = 'upcoming' | 'pending' | 'archive'

const ACTIONS: Record<MeetingStatus, MeetingAction[]> = {
  draft: ['edit', 'invite', 'quickStart', 'delete'],
  invited: ['run', 'edit', 'updateInvite'],
  in_progress: ['run'],
  closed: ['sign', 'publish', 'addendum', 'print'],
  published: ['print', 'addendum'],
}

/** What an admin can do in each state (the first is the primary action). The DB enforces the same transitions. */
export const actionsFor = (status: MeetingStatus): MeetingAction[] => ACTIONS[status]

export const tabOf = (status: string): MeetingTab =>
  status === 'closed' ? 'pending' : status === 'published' ? 'archive' : 'upcoming'

const DAY = 86_400_000
export const SHORT_NOTICE_DAYS = 5
export const PUBLISH_REMINDER_DAYS = 3

/** Under the Real Estate Law a tenants' assembly is announced 4–5 days ahead: less than 5 days needs a confirmation. */
export const isShortNotice = (scheduledAt: string, now: Date = new Date()): boolean =>
  new Date(scheduledAt).getTime() - now.getTime() < SHORT_NOTICE_DAYS * DAY

/** A closed meeting still unpublished more than 3 days later. */
export const needsPublishReminder = (m: { status: string; closed_at: string | null }, now: Date = new Date()): boolean =>
  m.status === 'closed' && m.closed_at !== null && now.getTime() - new Date(m.closed_at).getTime() > PUBLISH_REMINDER_DAYS * DAY

const yearOf = (iso: string): number => Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Jerusalem' }).format(new Date(iso)))

/** Archive search: the query in the title or any decision, and the meeting's year when one is picked. */
export function matchesArchive(m: { title: string; scheduled_at: string; decisions: readonly string[] }, query: string, year: number | null): boolean {
  if (year !== null && yearOf(m.scheduled_at) !== year) return false
  const q = query.trim().toLowerCase()
  return !q || [m.title, ...m.decisions].some((t) => t.toLowerCase().includes(q))
}

export const meetingYear = yearOf

/** Both required signatures (chair and recorder) are in: the protocol may be published. */
export const isSigned = (m: { signatures: readonly Pick<Signature, 'role'>[] }): boolean =>
  (['chair', 'secretary'] as const).every((r) => m.signatures.some((s) => s.role === r))

/** Why "עריכת הפרוטוקול" (reopen_meeting) is refused, or null: any signature or addendum locks the protocol. */
export const reopenBlock = (m: { signatures: readonly unknown[]; addenda: readonly unknown[] }): 'signed' | 'hasAddenda' | null =>
  m.signatures.length > 0 ? 'signed' : m.addenda.length > 0 ? 'hasAddenda' : null

/** Open for correction after closing (reopen_meeting), not a live meeting. */
export const isCorrection = (m: { status: string; reopened_from: string | null }): boolean =>
  m.status === 'in_progress' && m.reopened_from !== null

/** After a postponement the meeting may not open before the postponed time (open_meeting refuses 'too_early'). */
export const isTooEarly = (postponedTo: string | null, openedAt: string): boolean =>
  postponedTo !== null && new Date(openedAt).getTime() < new Date(postponedTo).getTime()
