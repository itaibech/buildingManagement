// Labels for days, times and rules (Israel time), and the hook the views read occurrences from.
import { useMemo, useState } from 'react'
import { todayISO } from '../../lib/dates'
import { formatDate } from '../../lib/format'
import { he } from '../../lib/he'
import { meetingISODate, meetingTime } from '../meetings/fmt'
import { addDays, expandAll, upcoming, weekdayOf } from './recurrence'
import { useCalendarItems } from './sources'
import type { CalendarItem, Occurrence } from './types'

const C = he.calendar

/** The agenda's window: today and the next 59 days. */
export const AGENDA_DAYS = 60

/** "היום · יום חמישי, 05/11/2026" (today / tomorrow named first). */
export function dayTitle(day: string, today: string): string {
  const base = C.dayHeading(C.weekdays[weekdayOf(day)], formatDate(day))
  if (day === today) return `${C.today} · ${base}`
  return day === addDays(today, 1) ? `${C.tomorrow} · ${base}` : base
}

/** "09:00–11:00", "09:00", "כל היום" or "כל היום · עד 11/11/2026". */
export function timeLabel(o: Occurrence): string {
  if (o.item.allDay) return o.lastDay === o.day ? C.allDay : `${C.allDay} · ${C.until(formatDate(o.lastDay))}`
  const from = meetingTime(o.start)
  if (!o.end) return from
  const to = meetingISODate(o.end) === o.day ? meetingTime(o.end) : `${formatDate(meetingISODate(o.end))} ${meetingTime(o.end)}`
  return C.timeRange(from, to)
}

/** "חוזר כל יום חמישי · עד 31/12/2026", or null for a one-off. */
export function recurrenceLabel(item: CalendarItem): string | null {
  if (item.recurrence === 'none') return null
  const first = meetingISODate(item.startsAt)
  const rule = item.recurrence === 'weekly' ? C.weekly(C.weekdays[weekdayOf(first)]) : C.monthly(Number(first.slice(8, 10)))
  return item.until ? `${rule} · ${C.until(formatDate(item.until))}` : rule
}

/** Every source's occurrences in [from, to]. */
export function useOccurrences(from: string, to: string) {
  const src = useCalendarItems()
  const occurrences = useMemo(() => expandAll(src.items, from, to), [src.items, from, to])
  return { ...src, occurrences }
}

/** The agenda window's occurrences that are not over yet. */
export function useUpcoming() {
  const today = todayISO()
  const q = useOccurrences(today, addDays(today, AGENDA_DAYS - 1))
  const [now] = useState(() => new Date())
  const occurrences = useMemo(() => upcoming(q.occurrences, now, today), [q.occurrences, now, today])
  return { ...q, today, occurrences }
}
