import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { ImportPayload } from './buildImport'

const COUNT_KEYS = ['apartments', 'residents', 'fees', 'payments', 'charges', 'categories', 'expenses', 'budgets'] as const
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
