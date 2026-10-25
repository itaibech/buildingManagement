/**
 * The month's collection count (Task 26): one rule, shared with public.collection_summary (0023). An apartment counts
 * when its fee this month is above 0 (exempt and zero-fee apartments are out; archived ones are never in the list);
 * it has paid when it owes nothing. Debtors and the amount owed cover every apartment, exempt ones included.
 */
export interface CollectionCounts { total: number; paidUp: number; debtors: number; owed: number }

export function collectionCounts(rows: readonly { balance: number; fee: number }[]): CollectionCounts {
  const paying = rows.filter((r) => r.fee > 0)
  const debtors = rows.filter((r) => r.balance > 0)
  return {
    total: paying.length,
    paidUp: paying.filter((r) => r.balance <= 0).length,
    debtors: debtors.length,
    owed: Math.round(debtors.reduce((t, r) => t + r.balance * 100, 0)) / 100,
  }
}
