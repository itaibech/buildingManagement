import { he } from '../../lib/he'

// Meeting dates and times, always in Israel time (the building's), whatever the device's zone.
const TZ = 'Asia/Jerusalem'
const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

function parts(iso: string | Date): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of partsFmt.formatToParts(new Date(iso))) out[p.type] = p.value
  return out
}

/** DD/MM/YYYY. */
export const meetingDate = (iso: string | Date): string => { const p = parts(iso); return `${p.day}/${p.month}/${p.year}` }
/** HH:MM. */
export const meetingTime = (iso: string | Date): string => { const p = parts(iso); return `${p.hour}:${p.minute}` }
/** YYYY-MM-DD, for document titles and date inputs. */
export const meetingISODate = (iso: string | Date): string => { const p = parts(iso); return `${p.year}-${p.month}-${p.day}` }

/** Date and time inputs (Israel time) for a timestamp. */
export const toInputs = (iso: string | Date): { date: string; time: string } => ({ date: meetingISODate(iso), time: meetingTime(iso) })

/** The timestamp for a date and time typed in Israel time. */
export function fromInputs(date: string, time: string): string {
  const guess = new Date(`${date}T${time}:00Z`)
  const p = parts(guess)
  const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute))
  return new Date(guess.getTime() - (shown - guess.getTime())).toISOString()
}

/** Whole days from now until the timestamp (for the short-notice warning). */
export const daysUntil = (iso: string, now: Date = new Date()): number => Math.floor((new Date(iso).getTime() - now.getTime()) / 86_400_000)


const DAY_MS = 86_400_000
const dayNumber = (iso: string | Date): number => Date.parse(`${meetingISODate(iso)}T00:00:00Z`) / DAY_MS

/** A time, with the day when it isn't today (Israel time): "21:00", "מחר 21:00", "24/10 21:00". */
export function whenText(iso: string | Date, now: Date = new Date()): string {
  const diff = dayNumber(iso) - dayNumber(now)
  const time = meetingTime(iso)
  if (diff === 0) return he.meetings.whenShort.today(time)
  if (diff === 1) return he.meetings.whenShort.tomorrow(time)
  return he.meetings.whenShort.other(meetingDate(iso).slice(0, 5), time)
}

/** A wait in hours and minutes, never thousands of minutes: "בעוד 37 שעות ו-21 דקות", "בעוד 5 דקות". */
export function waitText(ms: number): string {
  const W = he.meetings.wait
  const total = Math.ceil(ms / 60_000)
  if (total <= 1) return W.lessThanMinute
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return W.single(W.minutes(m))
  return m === 0 ? W.single(W.hours(h)) : W.join(W.hours(h), W.minutes(m))
}
