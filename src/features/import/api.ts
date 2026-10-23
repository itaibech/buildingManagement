import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
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

/** rpc('import_year'): one transaction on the server; replaces that year's previously imported rows. */
export function useImportYear() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (payload: ImportPayload): Promise<ImportCounts> => {
      const { data, error } = await supabase.rpc('import_year', { payload })
      if (error) throw new Error(error.message)
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
    queryFn: async (): Promise<{ payments: ExistingPayment[]; charges: ExistingCharge[] }> => {
      const [p, c] = await Promise.all([
        supabase.from('payments').select('paid_on, amount, source, apartments(number)').gte('paid_on', `${year}-01-01`).lt('paid_on', `${year + 1}-01-01`),
        supabase.from('charges').select('month, kind, source, apartments(number)').gte('month', `${year}-01-01`).lt('month', `${year + 1}-01-01`),
      ])
      if (p.error) throw new Error(p.error.message)
      if (c.error) throw new Error(c.error.message)
      return {
        payments: (p.data ?? []).map((r) => ({ apartment: numberOf(r), paid_on: r.paid_on, amount: Number(r.amount), source: r.source })),
        charges: (c.data ?? []).map((r) => ({ apartment: numberOf(r), month: r.month, kind: r.kind, source: r.source })),
      }
    },
  })
}
