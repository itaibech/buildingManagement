// The calendar's sources: its own events plus read-only items computed from other features' data (never copied).
// Each source is a hook gated by the permission of the data it reads; RLS decides the rows. Adding one = one hook in
// useCalendarItems' list.
import { useMemo } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { useTasks } from '../maintenance/api'
import { useMeetings } from '../meetings/api'
import { usePolls } from '../polls/api'
import { useCalendarEvents } from './api'
import { maintenanceItems, meetingItems, pollItems } from './items'
import type { CalendarItem } from './types'

const NONE: CalendarItem[] = []

export interface SourceResult { items: CalendarItem[]; isLoading: boolean; isError: boolean; refetch: () => void }

function useEventsSource(): SourceResult {
  const { can } = useAuth()
  const q = useCalendarEvents(can('calendar'))
  return { items: q.data ?? NONE, isLoading: q.isLoading, isError: q.isError, refetch: () => void q.refetch() }
}

function useMeetingsSource(): SourceResult {
  const { can, isAdmin } = useAuth()
  const q = useMeetings(can('meetings'))
  const items = useMemo(() => meetingItems(q.data ?? [], isAdmin), [q.data, isAdmin])
  return { items, isLoading: q.isLoading, isError: q.isError, refetch: () => void q.refetch() }
}

function usePollsSource(): SourceResult {
  const { can } = useAuth()
  const q = usePolls(can('polls'))
  const items = useMemo(() => pollItems(q.data ?? []), [q.data])
  return { items, isLoading: q.isLoading, isError: q.isError, refetch: () => void q.refetch() }
}

function useMaintenanceSource(): SourceResult {
  const { can } = useAuth()
  const q = useTasks(can('maintenance'))
  const items = useMemo(() => maintenanceItems(q.data ?? []), [q.data])
  return { items, isLoading: q.isLoading, isError: q.isError, refetch: () => void q.refetch() }
}

/** Every source's items, merged (a stable list while no source changes). The sources: one hook each, in a fixed order. */
export function useCalendarItems(): SourceResult {
  const events = useEventsSource()
  const meetings = useMeetingsSource()
  const polls = usePollsSource()
  const maintenance = useMaintenanceSource()
  const results: readonly SourceResult[] = [events, meetings, polls, maintenance]
  const items = useMemo(() => [events.items, meetings.items, polls.items, maintenance.items].flat(),
    [events.items, meetings.items, polls.items, maintenance.items])
  return {
    items,
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
    refetch: () => results.forEach((r) => r.refetch()),
  }
}
