/**
 * How payments and credit were applied to an apartment's months (Task 26): the same oldest-first rule as the
 * settlement plan (public.settlement_plan): the balance stays on the oldest open months, and every overpayment
 * covers the rest. Pure; money in agorot.
 */
import type { LedgerRow } from './ledger'
import { ledgerBalance, settlementPlan } from './settlement'

export interface MonthAllocation {
  /** The month's net charge. */
  charged: number
  /** Paid in the month itself, up to its charge. */
  paidInMonth: number
  /** Covered by credit from other months' overpayments. */
  fromCredit: number
  /** Still open (its share of the balance). */
  open: number
  /** Paid above the month's charge (credit for other months). */
  surplus: number
}

const ag = (n: number): number => Math.round(n * 100)
const ils = (agorot: number): number => agorot / 100

/** Month → how its charge was covered: "שולם בחודש זה · זיכוי מחודשים אחרים · נותר". */
export function allocation(rows: readonly LedgerRow[]): Map<string, MonthAllocation> {
  const open = new Map(settlementPlan(rows, ledgerBalance(rows)).map((p) => [p.month, ag(p.open)]))
  const out = new Map<string, MonthAllocation>()
  for (const r of rows) {
    const charged = ag(r.charged)
    const paid = ag(r.paid)
    const inMonth = Math.max(Math.min(paid, charged), 0)
    const left = open.get(r.month) ?? 0
    const fromCredit = Math.max(charged - inMonth - left, 0)
    out.set(r.month, { charged: ils(charged), paidInMonth: ils(inMonth), fromCredit: ils(fromCredit), open: ils(left), surplus: ils(Math.max(paid - charged, 0)) })
  }
  return out
}
