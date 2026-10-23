/** Pure EV charging math (no I/O). Mirrors public.ev_charge_reading() so the live preview equals the charge. */
import { formatRate, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'

export interface Rate { rate: number; effective_from: string }
export interface EvPreview { kwh: number; amount: number; error?: 'lower' | 'next' | 'noRate' | 'future' }
export interface HistoryReading { id: string; month: string; reading: number; kwh: number | null; rate: number | null; amount: number | null }
export interface EvPaymentLike { paid_on: string; amount: number; note: string }
export interface HistoryRow { id: string; month: string; reading: number; kwh: number | null; rate: number | null; amount: number | null; paid: number; diff: number }

/** Agorot as an integer, so sums and differences don't drift (0.1 + 0.2). */
const cents = (n: number): number => Math.round(n * 100)
export const money = (n: number): number => cents(n) / 100

/**
 * round(kwh × rate, 2), half away from zero like Postgres numeric round. kWh has 2 decimals and the rate 4,
 * so the product is an exact integer in millionths before rounding.
 */
export function chargeAmount(kwh: number, rate: number): number {
  const micro = cents(kwh) * Math.round(rate * 10000)
  return (Math.sign(micro) * Math.round(Math.abs(micro) / 10000)) / 100
}

/** The rate in force for a month (latest effective_from on or before it), or null. */
export function rateFor(rates: readonly Rate[], month: string): number | null {
  let best: Rate | null = null
  for (const r of rates) if (r.effective_from <= month && (!best || r.effective_from > best.effective_from)) best = r
  return best?.rate ?? null
}

/** The latest reading before `month`, else the charger's initial reading. */
export function previousReading(readings: readonly { month: string; reading: number }[], initial: number, month: string): number {
  let best: { month: string; reading: number } | null = null
  for (const r of readings) if (r.month < month && (!best || r.month > best.month)) best = r
  return best?.reading ?? initial
}

/** The next month's reading after `month`, if one is recorded (editing must not exceed it). */
export function nextReading(readings: readonly { month: string; reading: number }[], month: string): number | null {
  let best: { month: string; reading: number } | null = null
  for (const r of readings) if (r.month > month && (!best || r.month < best.month)) best = r
  return best?.reading ?? null
}

/** Live preview for the reading form: kWh used and the amount to charge, or why it can't be saved. */
export function evPreview(previous: number, reading: number, rate: number | null, next: number | null = null): EvPreview {
  const kwh = (cents(reading) - cents(previous)) / 100
  if (kwh < 0) return { kwh, amount: 0, error: 'lower' }
  if (next !== null && reading > next) return { kwh, amount: rate === null ? 0 : chargeAmount(kwh, rate), error: 'next' }
  if (rate === null) return { kwh, amount: 0, error: 'noRate' }
  return { kwh, amount: chargeAmount(kwh, rate) }
}

/** EV payments are the ones noted as EV charging (manual, the meter import and the main workbook's EV block). */
export const isEvPayment = (note: string): boolean => note.trim().startsWith(he.ev.chargeLabel)

/** One row per reading, newest first, with what was paid for EV that month and the difference (paid − amount). */
export function historyRows(readings: readonly HistoryReading[], payments: readonly EvPaymentLike[]): HistoryRow[] {
  const paid = new Map<string, number>()
  for (const p of payments) {
    if (!isEvPayment(p.note)) continue
    const month = `${p.paid_on.slice(0, 7)}-01`
    paid.set(month, (paid.get(month) ?? 0) + cents(p.amount))
  }
  return [...readings].sort((a, b) => b.month.localeCompare(a.month)).map((r) => {
    const p = paid.get(r.month) ?? 0
    return { ...r, paid: p / 100, diff: (p - cents(r.amount ?? 0)) / 100 }
  })
}

export interface ReadingPreview extends EvPreview { previous: number; rate: number | null; next: number | null; existing: number | null }

/** What the reading form shows while typing: previous and next readings, the month's rate and the preview. */
export function readingPreview(
  readings: readonly { month: string; reading: number }[], initial: number, rates: readonly Rate[], month: string, reading: number | null,
  currentMonth?: string,
): ReadingPreview | null {
  const previous = previousReading(readings, initial, month)
  const rate = rateFor(rates, month)
  const next = nextReading(readings, month)
  const existing = readings.find((r) => r.month === month)?.reading ?? null
  if (reading === null) return null
  const p = evPreview(previous, reading, rate, next)
  const future = currentMonth !== undefined && month > currentMonth
  return { ...p, ...(future ? { error: 'future' as const } : {}), previous, rate, next, existing }
}

/** "₪0.574 לקוט״ש מאוגוסט 2022" */
export const rateText = (r: Rate): string => he.ev.rateFrom(formatRate(r.rate), monthLabel(r.effective_from))
