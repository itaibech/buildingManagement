// Read-only calendar items computed from other features' rows (pure; the hooks in sources.ts feed them).
import { he } from '../../lib/he'
import type { Task } from '../maintenance/api'
import { fromInputs } from '../meetings/fmt'
import type { MeetingListItem } from '../meetings/types'
import type { Poll } from '../polls/types'
import type { CalendarItem } from './types'

/**
 * Meetings the user may see (residents: invited and published), without drafts. Admins see committee meetings (ישיבת ועד,
 * not a general assembly) marked "הוועד בלבד", like committee-only events.
 */
export function meetingItems(meetings: readonly MeetingListItem[], isAdmin: boolean): CalendarItem[] {
  return meetings.filter((m) => m.status !== 'draft').map((m) => ({
    id: m.id, source: 'meeting', title: m.title, description: '', location: m.location, category: 'meeting', allDay: false,
    startsAt: m.scheduled_at, endsAt: null, recurrence: 'none', until: null, committee: isAdmin && m.kind === 'committee', link: `/meetings/${m.id}`,
  }))
}

/** Open polls, on their closing time (drafts and closed polls are not upcoming). */
export function pollItems(polls: readonly Poll[]): CalendarItem[] {
  return polls.filter((p) => p.status === 'open').map((p) => ({
    id: p.id, source: 'poll', title: he.calendar.pollCloses(p.question), description: '', location: '', category: 'other', allDay: false,
    startsAt: p.closes_at, endsAt: null, recurrence: 'none', until: null, committee: false, link: `/polls/${p.id}`,
  }))
}

/** Maintenance tasks and inspections, all-day on their next due date (undated ones are skipped). */
export function maintenanceItems(tasks: readonly Pick<Task, 'id' | 'title' | 'next_due'>[]): CalendarItem[] {
  return tasks.flatMap((t) => (t.next_due ? [{
    id: t.id, source: 'maintenance' as const, title: he.calendar.maintenanceDue(t.title), description: '', location: '',
    category: 'maintenance' as const, allDay: true, startsAt: fromInputs(t.next_due, '00:00'), endsAt: null, recurrence: 'none' as const,
    until: null, committee: false, link: `/maintenance?task=${t.id}`,
  }] : []))
}
