/**
 * Debt settlement ("הסדרת חוב") and the apartment ledger's derived numbers. Pure, no I/O.
 * settlementPlan mirrors public.settlement_plan (0017): the server recomputes it, the client only previews it.
 * Money is summed in agorot (integers) so ₪2,530.20 never prints as 2530.1999999.
 */
import type { LedgerRow } from './ledger'

export interface PlanRow {
  /** First of the month, YYYY-MM-DD. */
  month: string
  /** The month's net charge (write-offs included) and what was paid in it. */
  charged: number
  paid: number
  /** What settling this month writes: its open amount, capped by what the balance still leaves. */
  open: number
}

export interface PlanSummary { months: number; total: number; after: number }

/** A charge as the breakdown needs it. `ev`: it came from an EV meter reading. */
export interface ChargeLine { month: string; amount: number; kind: string; ev: boolean }

export interface Breakdown { fee: number; ev: number; levy: number; other: number }

export type LedgerGroup = { type: 'month'; month: string } | { type: 'empty'; from: string; to: string }

const ag = (n: number): number => Math.round(n * 100)
const ils = (agorot: number): number => agorot / 100
const byMonth = (a: LedgerRow, b: LedgerRow): number => a.month.localeCompare(b.month)

/** Charged minus paid over every row (the apartment's balance through the current month). */
export function ledgerBalance(rows: readonly LedgerRow[]): number {
  return ils(rows.reduce((t, r) => t + ag(r.charged) - ag(r.paid), 0))
}

/**
 * Every month with charged > paid, oldest first, each taking its open amount until `balance` is used up (credit
 * from overpaid months is spent first, so the balance never goes negative). `selection` keeps only those months.
 */
export function settlementPlan(rows: readonly LedgerRow[], balance: number, selection?: ReadonlySet<string>): PlanRow[] {
  let remaining = ag(balance)
  const plan: PlanRow[] = []
  for (const r of [...rows].sort(byMonth)) {
    if (remaining <= 0) break
    const open = ag(r.charged) - ag(r.paid)
    if (open <= 0) continue
    const take = Math.min(open, remaining)
    remaining -= take
    if (!selection || selection.has(r.month)) plan.push({ month: r.month, charged: r.charged, paid: r.paid, open: ils(take) })
  }
  return plan
}

/** "יוסדרו N חודשים · ₪X · יתרה אחרי ההסדרה: ₪Y". */
export function planSummary(plan: readonly PlanRow[], balance: number): PlanSummary {
  const total = plan.reduce((t, p) => t + ag(p.open), 0)
  return { months: plan.length, total: ils(total), after: ils(ag(balance) - total) }
}

/** A month's charges in the order its open amount is attributed: payments cover the fee first, then levies. */
function monthParts(row: LedgerRow, charges: readonly ChargeLine[]): [keyof Breakdown, number][] {
  const own = charges.filter((c) => c.month === row.month && c.kind !== 'adjustment')
  const sum = (pick: (c: ChargeLine) => boolean): number => own.filter(pick).reduce((t, c) => t + ag(c.amount), 0)
  const ev = sum((c) => c.ev)
  const levy = sum((c) => !c.ev && c.kind === 'levy')
  const other = sum((c) => !c.ev && c.kind !== 'levy')
  const gross = ag(row.charged) - ag(row.adjusted ?? 0)
  return [['ev', ev], ['other', other], ['levy', levy], ['fee', gross - ev - levy - other]]
}

/** What the open amount is made of: "דמי ועד ₪0 · טעינת רכב ₪2,530.20 · היטלים ₪0". */
export function debtBreakdown(plan: readonly PlanRow[], rows: readonly LedgerRow[], charges: readonly ChargeLine[]): Breakdown {
  const out = { fee: 0, ev: 0, levy: 0, other: 0 }
  for (const p of plan) {
    const row = rows.find((r) => r.month === p.month)
    if (!row) continue
    let left = ag(p.open)
    for (const [key, part] of monthParts(row, charges)) {
      const take = Math.min(Math.max(part, 0), left)
      out[key] += take
      left -= take
    }
    out.fee += left
  }
  return { fee: ils(out.fee), ev: ils(out.ev), levy: ils(out.levy), other: ils(out.other) }
}

/** The balance at the end of each of `months` (ascending), carrying everything before the first one. */
export function runningBalances(rows: readonly LedgerRow[], months: readonly string[]): number[] {
  const first = months[0] ?? ''
  let total = rows.filter((r) => r.month < first).reduce((t, r) => t + ag(r.charged) - ag(r.paid), 0)
  return months.map((m) => {
    const r = rows.find((x) => x.month === m)
    if (r) total += ag(r.charged) - ag(r.paid)
    return ils(total)
  })
}

const isEmpty = (r: LedgerRow | undefined): boolean => !r || (r.charged === 0 && r.paid === 0 && !(r.adjusted ?? 0))

/** Months in order, with each run of months that have neither a charge nor a payment folded into one group. */
export function groupLedgerMonths(months: readonly string[], rows: ReadonlyMap<string, LedgerRow>): LedgerGroup[] {
  const out: LedgerGroup[] = []
  for (const month of months) {
    const last = out[out.length - 1]
    if (!isEmpty(rows.get(month))) out.push({ type: 'month', month })
    else if (last?.type === 'empty') last.to = month
    else out.push({ type: 'empty', from: month, to: month })
  }
  return out
}
