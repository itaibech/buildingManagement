// Expanding events into occurrences, in Israel wall time: a weekly 09:00 stays 09:00 across the DST change.
// Pure: dates are YYYY-MM-DD strings, timestamps ISO strings.
import { fromInputs, meetingISODate, meetingTime } from '../meetings/fmt'
import type { CalendarItem, Occurrence } from './types'

const DAY_MS = 86_400_000
/** Guards a broken rule from looping forever (weekly for ~100 years). */
const MAX_STEPS = 5300

const utc = (date: string): number => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

export const addDays = (date: string, n: number): string => isoOf(utc(date) + n * DAY_MS)
export const daysBetween = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / DAY_MS)
/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (date: string): number => new Date(utc(date)).getUTCDay()
export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** The same day of the month `n` months later, or that month's last day when it is shorter (the 31st → 30 Apr). */
export function addMonthsClamped(date: string, n: number): string {
  const total = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 + n
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  const day = Math.min(Number(date.slice(8, 10)), daysInMonth(year, month))
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** The month grid's first and last day for a month (YYYY-MM): whole weeks, Sunday first. */
export function monthRange(month: string): { from: string; to: string } {
  const first = `${month}-01`
  const last = `${month}-${String(daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)))).padStart(2, '0')}`
  return { from: addDays(first, -weekdayOf(first)), to: addDays(last, 6 - weekdayOf(last)) }
}

export const shiftMonth = (month: string, n: number): string => addMonthsClamped(`${month}-01`, n).slice(0, 7)

/** The k-th date of the series (k = 0 is the first). */
function nthDate(item: CalendarItem, first: string, k: number): string {
  if (item.recurrence === 'weekly') return addDays(first, 7 * k)
  if (item.recurrence === 'monthly') return addMonthsClamped(first, k)
  return first
}

/** The item's first day, how many extra days it spans, its start time and its timed duration. */
function shapeOf(item: CalendarItem) {
  const first = meetingISODate(item.startsAt)
  const span = item.endsAt ? Math.max(0, daysBetween(first, meetingISODate(item.endsAt))) : 0
  const durationMs = !item.allDay && item.endsAt ? new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime() : null
  return { first, span, time: item.allDay ? '00:00' : meetingTime(item.startsAt), durationMs }
}

/** The occurrences of one item that overlap [from, to] (inclusive dates), in order. */
export function expandItem(item: CalendarItem, from: string, to: string): Occurrence[] {
  const { first, span, time, durationMs } = shapeOf(item)
  const last = item.recurrence === 'none' ? first : item.until ?? to
  const out: Occurrence[] = []
  for (let k = 0; k < MAX_STEPS; k++) {
    const day = nthDate(item, first, k)
    if (day > to || day > last) break
    const lastDay = addDays(day, span)
    if (lastDay >= from) {
      const start = k === 0 ? new Date(item.startsAt).toISOString() : fromInputs(day, time)
      const end = item.allDay ? (item.endsAt ? fromInputs(lastDay, '00:00') : null)
        : durationMs === null ? null : new Date(new Date(start).getTime() + durationMs).toISOString()
      out.push({ key: `${item.source}:${item.id}:${day}`, item, start, end, day, lastDay })
    }
    if (item.recurrence === 'none') break
  }
  return out
}

/** Every item's occurrences in [from, to], by start time. */
export function expandAll(items: readonly CalendarItem[], from: string, to: string): Occurrence[] {
  return items.flatMap((i) => expandItem(i, from, to)).sort((a, b) => a.start.localeCompare(b.start) || a.item.title.localeCompare(b.item.title))
}

/** Occurrences grouped by each day they cover (a 3-day shutoff shows on all three), for [from, to]. */
export function groupByDay(occurrences: readonly Occurrence[], from: string, to: string): Map<string, Occurrence[]> {
  const days = new Map<string, Occurrence[]>()
  for (const o of occurrences) {
    for (let d = o.day < from ? from : o.day; d <= o.lastDay && d <= to; d = addDays(d, 1)) {
      const list = days.get(d) ?? []
      list.push(o)
      days.set(d, list)
    }
  }
  return new Map([...days.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

/** Upcoming occurrences from `now`: those not yet over (timed ones by their end, or start when open-ended). */
export function upcoming(occurrences: readonly Occurrence[], now: Date, today: string): Occurrence[] {
  const t = now.getTime()
  return occurrences.filter((o) => {
    if (o.item.allDay) return o.lastDay >= today
    return new Date(o.end ?? o.start).getTime() >= t
  })
}
