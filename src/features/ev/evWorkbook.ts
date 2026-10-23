// The EV export in the committee's sheet layout (pure rows; exportXlsx writes the file). One block per year:
// title row, header (A 'דירה ', D carry-in, E..P month dates, Q total), 5 rows per apartment, then the dated rates.
// The EV import parser reads this back (round-trip tested).
import { he } from '../../lib/he'
import type { CellFormats } from '../export/exportXlsx'
import type { Cell, Rows } from '../export/buildWorkbook'
import { yearMonths } from '../finance/ledger'
import { isEvPayment, money, rateFor, type EvPaymentLike, type Rate } from './evMath'

export interface ExportReading { month: string; reading: number; kwh: number | null; rate: number | null }
export interface ExportCharger { number: number; name: string; initial: number; readings: ExportReading[] }
export interface ExportPayment extends EvPaymentLike { apartment: number }

const S = he.ev.sheet
const DAY = 86400000
/** First-of-month date as an Excel serial (1900 system), so the cell is a real date. */
export const toSerial = (date: string): number =>
  (Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) - Date.UTC(1899, 11, 30)) / DAY
/** The sheet's own price: kWh × rate, unrounded (6 decimals keeps float noise out). */
const price = (kwh: number, rate: number): number => Math.round(kwh * rate * 1e6) / 1e6
const total = (cells: Cell[]): number => Math.round(cells.reduce<number>((t, v) => t + (typeof v === 'number' ? v : 0), 0) * 1e6) / 1e6

/** The years that have a reading or an EV payment, oldest first. */
export function exportYears(chargers: ExportCharger[], payments: ExportPayment[]): number[] {
  const ys = [...chargers.flatMap((c) => c.readings.map((r) => r.month)), ...payments.filter((p) => isEvPayment(p.note)).map((p) => p.paid_on)]
  return [...new Set(ys.map((d) => Number(d.slice(0, 4))))].sort((a, b) => a - b)
}

function apartmentRows(c: ExportCharger, paid: Map<string, number>, year: number, rates: readonly Rate[]): Rows {
  const months = yearMonths(year)
  const byMonth = new Map(c.readings.map((r) => [r.month, r]))
  const carry = [...c.readings].filter((r) => r.month < `${year}-01-01`).sort((a, b) => b.month.localeCompare(a.month))[0]?.reading ?? c.initial
  const pay = months.map((m): Cell => paid.get(`${c.number}|${m}`) ?? null)
  const readings = months.map((m): Cell => byMonth.get(m)?.reading ?? null)
  const kwh = months.map((m): Cell => byMonth.get(m)?.kwh ?? null)
  const cost = months.map((m, i): Cell => {
    const k = kwh[i]
    const rate = byMonth.get(m)?.rate ?? rateFor(rates, m)
    return typeof k === 'number' && rate !== null ? price(k, rate) : null
  })
  const diff = months.map((_, i): Cell => (pay[i] === null && cost[i] === null ? null : price(Number(pay[i] ?? 0) - Number(cost[i] ?? 0), 1)))
  return [
    [c.number, c.name, S.paid, null, ...pay, total(pay)],
    [null, null, S.reading, carry, ...readings],
    [null, null, S.kwh, null, ...kwh, total(kwh)],
    [null, null, S.amount, null, ...cost, total(cost)],
    [null, null, S.diff, null, ...diff, total(diff)],
  ]
}

/** The rates shown under a year's block: the one in force on 1 January and every change during the year. */
function rateRows(rates: readonly Rate[], year: number): Rows {
  const start = `${year}-01-01`
  const sorted = [...rates].sort((a, b) => a.effective_from.localeCompare(b.effective_from))
  const opening = sorted.filter((r) => r.effective_from <= start).at(-1)
  const inYear = sorted.filter((r) => r.effective_from > start && r.effective_from.startsWith(String(year)))
  return [...(opening ? [opening] : []), ...inYear].map((r) => [null, toSerial(r.effective_from), S.rate, r.rate, 'ש"ח'])
}

/** Stacked year blocks (blank row between), one per year in `years`. */
export function evSheetRows(chargers: ExportCharger[], payments: ExportPayment[], rates: readonly Rate[], years: number[]): Rows {
  const paid = new Map<string, number>()
  for (const p of payments) {
    if (!isEvPayment(p.note)) continue
    const key = `${p.apartment}|${p.paid_on.slice(0, 7)}-01`
    paid.set(key, money((paid.get(key) ?? 0) + p.amount))
  }
  const rows: Rows = []
  for (const year of years) {
    const active = chargers.filter((c) => c.readings.some((r) => r.month.startsWith(String(year)))
      || [...paid.keys()].some((k) => k.startsWith(`${c.number}|${year}-`)))
    if (rows.length > 0) rows.push([])
    rows.push([null, null, null, null, null, null, null, S.title, null, year], [])
    rows.push([S.apartment, null, null, S.carry, ...yearMonths(year).map(toSerial), S.total])
    for (const c of active) rows.push(...apartmentRows(c, paid, year, rates))
    rows.push([], ...rateRows(rates, year))
  }
  return rows
}

/** Header month cells as MM/YYYY and rate dates as DD/MM/YYYY. */
export const evFormats: CellFormats = (rows) => rows.flatMap((r, i) => {
  if (r[0] === S.apartment) return r.flatMap((v, c) => (typeof v === 'number' ? [{ r: i, c, z: 'mm/yyyy' }] : []))
  if (r[2] === S.rate) return [{ r: i, c: 1, z: 'dd/mm/yyyy' }]
  return []
})
