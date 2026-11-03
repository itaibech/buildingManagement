// The calendar's sources: its own events plus read-only items computed from other features' data (never copied).
// Each source is a hook gated by the permission of the data it reads; RLS decides the rows. Adding one (polls closing,
// inspections due) = one hook in useCalendarItems' list.
import { useMemo } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { useMeetings } from '../meetings/api'
import type { MeetingListItem } from '../meetings/types'
import { useCalendarEvents } from './api'
import type { CalendarItem } from './types'

const NONE: CalendarItem[] = []

export interface SourceResult { items: CalendarItem[]; isLoading: boolean; isError: boolean; refetch: () => void }

/** Meetings the user may see (residents: invited and published), without drafts. */
export function meetingItems(meetings: readonly MeetingListItem[]): CalendarItem[] {
  return meetings.filter((m) => m.status !== 'draft').map((m) => ({
    id: m.id, source: 'meeting', title: m.title, description: '', location: m.location, category: 'meeting', allDay: false,
    startsAt: m.scheduled_at, endsAt: null, recurrence: 'none', until: null, committee: false, link: `/meetings/${m.id}`,
  }))
}

function useEventsSource(): SourceResult {
  const { can } = useAuth()
  const q = useCalendarEvents(can('calendar'))
  return { items: q.data ?? NONE, isLoading: q.isLoading, isError: q.isError, refetch: () => void q.refetch() }
}

function useMeetingsSource(): SourceResult {
  const { can } = useAuth()
  const q = useMeetings(can('meetings'))
  const items = useMemo(() => meetingItems(q.data ?? []), [q.data])
  return { items, isLoading: q.isLoading, isError: q.isError, refetch: () => void q.refetch() }
}

/** Every source's items, merged (a stable list while no source changes). The sources: one hook each, in a fixed order. */
export function useCalendarItems(): SourceResult {
  const events = useEventsSource()
  const meetings = useMeetingsSource()
  const results: readonly SourceResult[] = [events, meetings]
  const items = useMemo(() => [events.items, meetings.items].flat(), [events.items, meetings.items])
  return {
    items,
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
    refetch: () => results.forEach((r) => r.refetch()),
  }
}
