import { HEBREW_MONTHS } from './he'

export { HEBREW_MONTHS }

const ils = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' })

export function formatILS(n: number): string {
  return ils.format(n)
}

const rateFmt = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 4 })
const kwhFmt = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** A per-kWh rate: up to 4 decimals (₪0.6155). */
export function formatRate(n: number): string {
  return rateFmt.format(n)
}

/** kWh or a meter reading: always 2 decimals, thousands separators. */
export function formatKwh(n: number): string {
  return kwhFmt.format(n)
}

const pad = (n: number): string => String(n).padStart(2, '0')

export function formatDate(d: string | Date): string {
  if (typeof d === 'string') {
    const [y, m, day] = d.slice(0, 10).split('-')
    return `${day}/${m}/${y}`
  }
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-')
  return `${HEBREW_MONTHS[Number(m) - 1]} ${y}`
}

const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto' })
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['minute', 60],
  ['hour', 60],
  ['day', 24],
  ['month', 30],
  ['year', 12],
]

/** "לפני 3 ימים" style relative time (Hebrew), from seconds up to years. */
export function relativeDate(iso: string, now: Date = new Date()): string {
  let value = (new Date(iso).getTime() - now.getTime()) / 1000
  if (Math.abs(value) < 60) return rtf.format(0, 'second')
  let unit: Intl.RelativeTimeFormatUnit = 'second'
  for (const [next, size] of STEPS) {
    if (Math.abs(value) < size) break
    value /= size
    unit = next
  }
  // Chrome's Hebrew data appends the count to dual/singular forms ("לפני דקה (1)", "לפני שעתיים (2)").
  return rtf.format(Math.round(value), unit).replace(/\s*\(\d+\)$/, '')
}
