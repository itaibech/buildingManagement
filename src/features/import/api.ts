import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAll } from '../../lib/fetchAll'
import { he } from '../../lib/he'
import { supabase } from '../../lib/supabase'
import { notifyError } from '../../ui'
import { receiptsOf, removeReceiptFiles } from '../finance/api'
import { sweepProofs } from '../finance/proofSweep'
import type { ExistingCharge, ExistingPayment, ImportPayload } from './buildImport'

const COUNT_KEYS = ['apartments', 'residents', 'fees', 'payments', 'charges', 'categories', 'expenses', 'budgets', 'ev_skipped'] as const
export type ImportCounts = Partial<Record<(typeof COUNT_KEYS)[number], number>>

function toCounts(data: unknown): ImportCounts {
  const out: ImportCounts = {}
  if (typeof data !== 'object' || data === null) return out
  for (const k of COUNT_KEYS) {
    const v: unknown = Reflect.get(data, k)
    if (typeof v === 'number') out[k] = v
  }
  return out
}

/**
 * rpc('import_year'): one transaction on the server; replaces that year's previously imported rows. Then removes the
 * receipt files of the imported expenses it deleted, and the proofs of the imported payments it replaced (queued by
 * 0037). The rows are gone either way; the admin hears if files stayed.
 */
export function useImportYear() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (payload: ImportPayload): Promise<ImportCounts> => {
      const { data, error } = await supabase.rpc('import_year', { payload })
      if (error) throw new Error(error.message)
      if (await removeReceiptFiles(receiptsOf(data))) notifyError(he.finance.receiptRemoveFailed)
      if (await sweepProofs()) notifyError(he.finance.proof.fileStayed)
      return toCounts(data)
    },
    onSettled: () => client.invalidateQueries(),
  })
}

type WithApartment = { apartments: { number: number } | null }
const numberOf = (r: WithApartment): number => r.apartments?.number ?? 0

/** The year's payments and charges already in the system (all sources), for the re-import guards. */
export function useYearMoney(year: number) {
  return useQuery({
    queryKey: ['import-year-money', year],
    queryFn: async (): Promise<{ payments: ExistingPayment[]; charges: ExistingCharge[]; settled: number; proofs: number }> => {
      const [p, c, s] = await Promise.all([
        fetchAll((f, t) => supabase.from('payments').select('paid_on, amount, source, proof_path, apartments(number)')
          .gte('paid_on', `${year}-01-01`).lt('paid_on', `${year + 1}-01-01`).order('id').range(f, t)),
        fetchAll((f, t) => supabase.from('charges').select('month, kind, source, apartments(number)')
          .gte('month', `${year}-01-01`).lt('month', `${year + 1}-01-01`).order('id').range(f, t)),
        // Payments that settle a month of this year (settlements dated today still carry the debt month here).
        fetchAll((f, t) => supabase.from('payments').select('settlement_id')
          .gte('for_month', `${year}-01-01`).lt('for_month', `${year + 1}-01-01`).order('id').range(f, t)),
      ])
      const writeOffs = c.filter((r) => r.kind === 'adjustment').length
      return {
        settled: writeOffs + s.filter((r) => Boolean(r.settlement_id)).length,
        // import_year deletes the year's 'import' payments: their proofs go with them.
        proofs: p.filter((r) => r.source === 'import' && r.proof_path).length,
        payments: p.map((r) => ({ apartment: numberOf(r), paid_on: r.paid_on, amount: Number(r.amount), source: r.source })),
        charges: c.map((r) => ({ apartment: numberOf(r), month: r.month, kind: r.kind, source: r.source })),
      }
    },
  })
}
