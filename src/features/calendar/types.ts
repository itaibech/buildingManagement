import type { Database } from '../../lib/db.types'

export type CalendarEventRow = Database['public']['Tables']['calendar_events']['Row']

export const CATEGORIES = ['cleaning', 'pest_control', 'shutoff', 'maintenance', 'meeting', 'other'] as const
export type Category = (typeof CATEGORIES)[number]
export const isCategory = (v: string): v is Category => (CATEGORIES as readonly string[]).includes(v)

export const RECURRENCES = ['none', 'weekly', 'monthly'] as const
export type Recurrence = (typeof RECURRENCES)[number]
export const isRecurrence = (v: string): v is Recurrence => (RECURRENCES as readonly string[]).includes(v)

export const VISIBILITIES = ['residents', 'committee'] as const
export type Visibility = (typeof VISIBILITIES)[number]

/** Where an item comes from: the calendar's own table (editable) or another feature's data (read-only). */
export type SourceKey = 'event' | 'meeting' | 'poll' | 'maintenance'

/**
 * One calendar entry from any source: a single event or a recurring series. Timed: startsAt / endsAt are timestamps.
 * All-day: startsAt is the Israel midnight of the first day, endsAt (if set) that of the last day, inclusive.
 */
export interface CalendarItem {
  id: string
  source: SourceKey
  title: string
  description: string
  location: string
  category: Category
  allDay: boolean
  startsAt: string
  endsAt: string | null
  recurrence: Recurrence
  /** Last date (YYYY-MM-DD, inclusive) of a recurring series; null = forever. */
  until: string | null
  committee: boolean
  /** In-app page of a read-only item (e.g. the meeting). */
  link?: string
  /** The row, for own events (the admin edits it). */
  row?: CalendarEventRow
}

/** One occurrence of an item, inside the range asked for. */
export interface Occurrence {
  key: string
  item: CalendarItem
  /** Timestamp of this occurrence's start (for all-day: the Israel midnight of its first day). */
  start: string
  /** Timestamp of its end, or null (timed without an end). */
  end: string | null
  /** First and last day it covers (YYYY-MM-DD, Israel). */
  day: string
  lastDay: string
}
