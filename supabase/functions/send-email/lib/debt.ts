import type { Balance, LedgerRow } from './types.ts'

/** Apartments that owe (balance > 0) and the ids of those skipped (nothing to pay). */
export function splitDebtors(balances: readonly Balance[]): { debtors: Balance[]; skipped: string[] } {
  return {
    debtors: balances.filter((b) => b.balance > 0),
    skipped: balances.filter((b) => !(b.balance > 0)).map((b) => b.apartmentId),
  }
}

const cents = (n: number): number => Math.round(n * 100)

/**
 * The months the balance is made of, oldest first, the same way the app's ledger and debt settlement
 * (public.settlement_plan, 0017) see them: every month with charged > paid takes its open amount until the balance
 * is used up (credit from overpaid months is spent first).
 */
export function openMonths(rows: readonly LedgerRow[], balance: number): { month: string; amount: number }[] {
  let left = cents(balance)
  const out: { month: string; amount: number }[] = []
  for (const row of [...rows].sort((a, b) => a.month.localeCompare(b.month))) {
    if (left <= 0) break
    const open = cents(row.charged) - cents(row.paid)
    if (open <= 0) continue
    const take = Math.min(open, left)
    out.push({ month: row.month, amount: take / 100 })
    left -= take
  }
  return out
}
