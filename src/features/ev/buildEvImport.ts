// Turns the parsed EV sheet into the payload for rpc('import_ev'): chargers with their readings, derived rates
// and (optionally) the "שולם" payments. Rates come from the sheet's own numbers (price ÷ kWh), not its rate cells.
import { formatKwh, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { shiftMonth } from '../finance/ledger'
import { mode } from '../import/parseWorkbook'
import { chargeAmount, money, rateFor, type Rate } from './evMath'
import type { EvSheet } from './parseEvWorkbook'

export type EvImportPayload = {
  chargers: { apartment: number; initial_reading: number; readings: { month: string; reading: number }[] }[]
  rates: { effective_from: string; rate: number }[]
  payments: { apartment: number; paid_on: string; amount: number }[]
  /** Remove the main workbook's imported EV charges and payments in the covered months (server side). */
  replace_main_ev?: boolean
}
export type ChargerPlan = EvImportPayload['chargers'][number]
export interface Derived { chargers: ChargerPlan[]; names: Record<number, string>; warnings: string[] }
export interface YearSummary { apartment: number; year: number; readings: number; kwh: number; amount: number }
export interface EvPaymentRow { apartment: number; paid_on: string; amount: number }

const byMonth = (o: Record<string, number>): [string, number][] => Object.entries(o).sort(([a], [b]) => a.localeCompare(b))

/**
 * Per apartment, every block's readings in month order, chained across years. The first block's carry-in (or 0) is
 * the initial reading. A month after `currentMonth`, or one whose reading drops below the previous one (a copied
 * placeholder), is "not yet read": skipped with a warning. A zero difference is a valid reading.
 */
export function deriveReadings(sheet: EvSheet, currentMonth: string): Derived {
  const plans = new Map<number, ChargerPlan & { last: number }>()
  const names: Record<number, string> = {}
  const warnings: string[] = [...sheet.warnings]
  for (const block of sheet.blocks) {
    for (const a of block.apartments) {
      names[a.number] ||= a.name
      let plan = plans.get(a.number)
      if (!plan) {
        plan = { apartment: a.number, initial_reading: a.carry ?? 0, readings: [], last: a.carry ?? 0 }
        plans.set(a.number, plan)
      } else if (a.carry !== null && plan.readings.length > 0 && a.carry !== plan.last) {
        warnings.push(he.ev.import.warnCarry(a.number, block.year, formatKwh(a.carry), formatKwh(plan.last)))
      }
      for (const [month, reading] of byMonth(a.readings)) {
        if (month > currentMonth) warnings.push(he.ev.import.warnFuture(a.number, monthLabel(month)))
        else if (reading < plan.last) warnings.push(he.ev.import.warnLower(a.number, monthLabel(month), formatKwh(reading), formatKwh(plan.last)))
        else {
          plan.readings.push({ month, reading })
          plan.last = reading
        }
      }
    }
  }
  const chargers = [...plans.values()].sort((x, y) => x.apartment - y.apartment)
    .map(({ apartment, initial_reading, readings }) => ({ apartment, initial_reading, readings }))
  return { chargers, names, warnings }
}

/**
 * The rate per month is round(price ÷ kWh, 4) wherever kWh > 0 (the most common value when apartments differ);
 * consecutive equal rates collapse into change points on the first of the month. The first change point moves back
 * to the earliest imported reading, so every reading has a rate in force.
 */
export function deriveRates(sheet: EvSheet, chargers: ChargerPlan[], currentMonth: string): Rate[] {
  const perMonth = new Map<string, number[]>()
  for (const a of sheet.blocks.flatMap((b) => b.apartments)) {
    for (const [month, kwh] of byMonth(a.kwh)) {
      const cost = a.cost[month]
      if (kwh > 0 && cost !== undefined && cost > 0 && month <= currentMonth) {
        perMonth.set(month, [...(perMonth.get(month) ?? []), Math.round((cost / kwh) * 10000) / 10000])
      }
    }
  }
  const out: Rate[] = []
  for (const [month, rates] of [...perMonth].sort(([a], [b]) => a.localeCompare(b))) {
    const rate = mode(rates) ?? 0
    if (rate > 0 && rate !== out.at(-1)?.rate) out.push({ effective_from: month, rate })
  }
  const first = chargers.flatMap((c) => c.readings.map((r) => r.month)).sort()[0]
  if (out[0] && first && first < out[0].effective_from) out[0] = { ...out[0], effective_from: first }
  return out
}

/** The "שולם" row: one payment per month with an amount, dated the first of that month. */
export function derivePayments(sheet: EvSheet): EvPaymentRow[] {
  return sheet.blocks.flatMap((b) => b.apartments.flatMap((a) =>
    byMonth(a.paid).filter(([, v]) => v > 0).map(([month, amount]) => ({ apartment: a.number, paid_on: month, amount: money(amount) }))))
}

/** Readings, kWh and amount per apartment and year, as the app will charge them with `rates`. */
export function summarizeEv(chargers: ChargerPlan[], rates: readonly Rate[]): YearSummary[] {
  const out = new Map<string, YearSummary>()
  for (const c of chargers) {
    let prev = c.initial_reading
    for (const r of c.readings) {
      const year = Number(r.month.slice(0, 4))
      const key = `${c.apartment}|${year}`
      const s = out.get(key) ?? { apartment: c.apartment, year, readings: 0, kwh: 0, amount: 0 }
      const kwh = money(r.reading - prev)
      out.set(key, { ...s, readings: s.readings + 1, kwh: money(s.kwh + kwh), amount: money(s.amount + chargeAmount(kwh, rateFor(rates, r.month) ?? 0)) })
      prev = r.reading
    }
  }
  return [...out.values()].sort((a, b) => a.apartment - b.apartment || a.year - b.year)
}

/** `${apartment}|YYYY-MM-01` */
export const paymentKey = (apartment: number, month: string): string => `${apartment}|${month.slice(0, 7)}-01`

export interface PayloadOptions { includePayments: boolean; skipPayments: ReadonlySet<string>; replaceMain?: boolean }

/** paymentKey()s of every apartment-month the import covers (readings and payments). */
export function coveredKeys(chargers: ChargerPlan[], payments: EvPaymentRow[]): Set<string> {
  return new Set([
    ...chargers.flatMap((c) => c.readings.map((r) => paymentKey(c.apartment, r.month))),
    ...payments.map((p) => paymentKey(p.apartment, p.paid_on)),
  ])
}

export function buildEvPayload(chargers: ChargerPlan[], rates: readonly Rate[], payments: EvPaymentRow[], opts: PayloadOptions): EvImportPayload {
  return {
    chargers,
    rates: rates.map((r) => ({ effective_from: r.effective_from, rate: r.rate })),
    payments: opts.includePayments ? payments.filter((p) => !opts.skipPayments.has(paymentKey(p.apartment, p.paid_on))) : [],
    replace_main_ev: opts.replaceMain ?? false,
  }
}

export interface MainRow { apartment: number; month: string; amount: number }
export interface MainReplacement {
  charges: number; chargesAmount: number; from: string | null; to: string | null
  meterCount: number; meterAmount: number; paymentsRemoved: number; paymentsKept: number
}

/**
 * What replace_main_ev removes (same rules as public.ev_replace_main): per apartment the main import's EV charges in
 * [first reading + 1 month .. last reading + 1 month], and its EV payments in the months `payments` has a payment.
 * The meter side is the readings of the apartments losing a main charge.
 */
export function mainReplacement(chargers: ChargerPlan[], rates: readonly Rate[], payments: EvPaymentRow[], mainCharges: MainRow[], mainPayments: MainRow[]): MainReplacement {
  const windows = new Map(chargers.filter((c) => c.readings.length > 0).map((c) => {
    const months = c.readings.map((r) => r.month).sort()
    return [c.apartment, [shiftMonth(months[0] ?? '', 1), shiftMonth(months.at(-1) ?? '', 1)]] as const
  }))
  const removed = mainCharges.filter((m) => {
    const w = windows.get(m.apartment)
    return !!w && m.month >= w[0] && m.month <= w[1]
  }).sort((a, b) => a.month.localeCompare(b.month))
  const losing = new Set(removed.map((m) => m.apartment))
  const meter = summarizeEv(chargers.filter((c) => losing.has(c.apartment)), rates)
  const paid = new Set(payments.map((p) => paymentKey(p.apartment, p.paid_on)))
  const ofPayload = mainPayments.filter((m) => chargers.some((c) => c.apartment === m.apartment))
  const paymentsRemoved = ofPayload.filter((m) => paid.has(paymentKey(m.apartment, m.month))).length
  return {
    charges: removed.length, chargesAmount: money(removed.reduce((t, m) => t + m.amount, 0)),
    from: removed[0]?.month ?? null, to: removed.at(-1)?.month ?? null,
    meterCount: meter.reduce((n, s) => n + s.readings, 0), meterAmount: money(meter.reduce((t, s) => t + s.amount, 0)),
    paymentsRemoved, paymentsKept: ofPayload.length - paymentsRemoved,
  }
}
