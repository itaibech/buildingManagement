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
