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
 * The months the balance is made of, oldest first. Payments settle the oldest charges first, so what is still owed
 * sits on the latest charges: walk back from the newest month until the balance is covered.
 */
export function openMonths(rows: readonly LedgerRow[], balance: number): { month: string; amount: number }[] {
  let left = cents(balance)
  const out: { month: string; amount: number }[] = []
  for (const row of [...rows].sort((a, b) => b.month.localeCompare(a.month))) {
    if (left <= 0) break
    const take = Math.min(cents(row.charged), left)
    if (take <= 0) continue
    out.push({ month: row.month, amount: take / 100 })
    left -= take
  }
  return out.reverse()
}
