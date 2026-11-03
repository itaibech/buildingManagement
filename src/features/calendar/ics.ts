// "הוספה ליומן שלי": an RFC 5545 VCALENDAR for one item (with its RRULE when recurring), and a Google Calendar link.
// Times are Israel wall times (TZID Asia/Jerusalem, with its VTIMEZONE); all-day items use DATE values.
import { fromInputs, meetingISODate, meetingTime } from '../meetings/fmt'
import { addDays, weekdayOf } from './recurrence'
import type { CalendarItem } from './types'

const TZID = 'Asia/Jerusalem'
const HOUR_MS = 3_600_000
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const

// Israel since 2013: IDT from the Friday before the last Sunday of March, IST from the last Sunday of October, 02:00.
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', `TZID:${TZID}`,
  'BEGIN:STANDARD', 'DTSTART:19701025T020000', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0200', 'TZNAME:IST',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'BEGIN:DAYLIGHT', 'DTSTART:19700327T020000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0300', 'TZNAME:IDT',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=23,24,25,26,27,28,29;BYDAY=FR', 'END:DAYLIGHT',
  'END:VTIMEZONE',
]

/** TEXT value escaping: backslash, semicolon, comma, and newlines as \n. */
export const escapeText = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')

const encoder = new TextEncoder()
const octets = (s: string): number => encoder.encode(s).length

/** Folds a content line at 75 octets (CRLF + space), never inside a UTF-8 character. */
export function foldLine(line: string): string {
  const parts: string[] = []
  let current = ''
  let size = 0
  for (const ch of line) {
    const n = octets(ch)
    const limit = parts.length === 0 ? 75 : 74
    if (size + n > limit) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += ch
    size += n
  }
  parts.push(current)
  return parts.join('\r\n ')
}

const compact = (date: string): string => date.replace(/-/g, '')
/** Israel wall time as 20261105T090000. */
export const localStamp = (iso: string): string => `${compact(meetingISODate(iso))}T${meetingTime(iso).replace(':', '')}00`
/** UTC as 20261105T070000Z. */
export const utcStamp = (iso: string): string => `${new Date(iso).toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`

/** The item's first and (exclusive for all-day) last values, as ICS / Google strings. */
export function boundsOf(item: CalendarItem): { start: string; end: string } {
  if (item.allDay) {
    const lastDay = meetingISODate(item.endsAt ?? item.startsAt)
    return { start: compact(meetingISODate(item.startsAt)), end: compact(addDays(lastDay, 1)) }
  }
  const end = item.endsAt ?? new Date(new Date(item.startsAt).getTime() + HOUR_MS).toISOString()
  return { start: localStamp(item.startsAt), end: localStamp(end) }
}

/** RRULE value (without the "RRULE:" name) for a recurring item, or null. Monthly on the 29th–31st clamps to the month's end. */
export function rruleOf(item: CalendarItem): string | null {
  if (item.recurrence === 'none') return null
  const first = meetingISODate(item.startsAt)
  let rule: string
  if (item.recurrence === 'weekly') {
    rule = `FREQ=WEEKLY;BYDAY=${WEEKDAYS[weekdayOf(first)]}`
  } else {
    const dom = Number(first.slice(8, 10))
    rule = dom <= 28 ? `FREQ=MONTHLY;BYMONTHDAY=${dom}`
      : `FREQ=MONTHLY;BYMONTHDAY=${Array.from({ length: dom - 27 }, (_, i) => 28 + i).join(',')};BYSETPOS=-1`
  }
  if (!item.until) return rule
  // UNTIL is a DATE for all-day series and UTC for TZID ones (the end of the last day in Israel).
  const until = item.allDay ? compact(item.until) : utcStamp(new Date(new Date(fromInputs(item.until, '23:59')).getTime() + 59_000).toISOString())
  return `${rule};UNTIL=${until}`
}

function eventLines(item: CalendarItem, now: Date): string[] {
  const { start, end } = boundsOf(item)
  const dt = item.allDay ? (name: string, v: string) => `${name};VALUE=DATE:${v}` : (name: string, v: string) => `${name};TZID=${TZID}:${v}`
  const rrule = rruleOf(item)
  return [
    'BEGIN:VEVENT',
    `UID:${item.source}-${item.id}@building-management`,
    `DTSTAMP:${utcStamp(now.toISOString())}`,
    dt('DTSTART', start),
    dt('DTEND', end),
    ...(rrule ? [`RRULE:${rrule}`] : []),
    `SUMMARY:${escapeText(item.title)}`,
    ...(item.description ? [`DESCRIPTION:${escapeText(item.description)}`] : []),
    ...(item.location ? [`LOCATION:${escapeText(item.location)}`] : []),
    'END:VEVENT',
  ]
}

/** The whole file: CRLF line ends, folded lines, a VTIMEZONE when the item is timed. */
export function buildIcs(item: CalendarItem, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Building Management//Calendar//HE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ...(item.allDay ? [] : VTIMEZONE),
    ...eventLines(item, now),
    'END:VCALENDAR',
  ]
  return `${lines.map(foldLine).join('\r\n')}\r\n`
}

/** calendar.google.com "add event" template link. */
export function googleCalendarUrl(item: CalendarItem): string {
  const { start, end } = boundsOf(item)
  const params = new URLSearchParams({ action: 'TEMPLATE', text: item.title, dates: `${start}/${end}` })
  if (!item.allDay) params.set('ctz', TZID)
  if (item.description) params.set('details', item.description)
  if (item.location) params.set('location', item.location)
  const rrule = rruleOf(item)
  if (rrule) params.set('recur', `RRULE:${rrule}`)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/** A file name for the download: the title without characters file systems reject. */
export const icsFileName = (title: string): string => `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'event'}.ics`

/** Saves the item as an .ics file (the browser's download). */
export function downloadIcs(item: CalendarItem): void {
  const url = URL.createObjectURL(new Blob([buildIcs(item)], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = icsFileName(item.title)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
