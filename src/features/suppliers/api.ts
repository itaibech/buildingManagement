import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Database } from '../../lib/db.types'
import { he } from '../../lib/he'
import { supabase } from '../../lib/supabase'
import { notifyError } from '../../ui/notify'
import { removeSupplierFiles, uploadSupplierFile } from './files'
import type { ContractPeriod } from './logic'

type Tables = Database['public']['Tables']
export type Supplier = Tables['suppliers']['Row']
export type Contract = Omit<Tables['supplier_contracts']['Row'], 'period'> & { period: ContractPeriod }
export type ContractFile = Tables['supplier_contract_files']['Row']
/** What a group with 'suppliers' reads (supplier_directory): names and contacts only. */
export type SupplierContact = Pick<Supplier, 'id' | 'name' | 'category' | 'contact_name' | 'phone' | 'email'>
export type SupplierInput = Omit<Tables['suppliers']['Insert'], 'id' | 'building_id' | 'created_at'>
export type ContractInput = Omit<Tables['supplier_contracts']['Insert'], 'id' | 'created_at' | 'period'> & { period: ContractPeriod }
export interface SupplierExpense { id: string; spent_on: string; amount: number; vendor: string; note: string }

const KEY = ['suppliers'] as const
const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message)
}

/** Admin: every supplier row (drafts and notes included). */
export function useSuppliers(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'all'],
    enabled,
    queryFn: async (): Promise<Supplier[]> => {
      const { data, error } = await supabase.from('suppliers').select('*').order('category').order('name')
      fail(error)
      return data ?? []
    },
  })
}

/** Anyone with 'suppliers': names and contacts (RPC; no notes, contracts or files). */
export function useSupplierDirectory(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'directory'],
    enabled,
    queryFn: async (): Promise<SupplierContact[]> => {
      const { data, error } = await supabase.rpc('supplier_directory')
      fail(error)
      return data ?? []
    },
  })
}

/** Admin: all contracts (amounts included), for the list chips and the home reminders. */
export function useContracts(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'contracts'],
    enabled,
    queryFn: async (): Promise<Contract[]> => {
      const { data, error } = await supabase.from('supplier_contracts').select('*').order('ends_on', { ascending: false, nullsFirst: true })
      fail(error)
      return (data ?? []) as Contract[]
    },
  })
}

export function useContractFiles(contractId: string) {
  return useQuery({
    queryKey: [...KEY, 'files', contractId],
    queryFn: async (): Promise<ContractFile[]> => {
      const { data, error } = await supabase.from('supplier_contract_files').select('*').eq('contract_id', contractId).order('created_at')
      fail(error)
      return data ?? []
    },
  })
}

/** The latest expenses in the supplier's linked category (admin; raw expenses are admin-only). */
export function useSupplierExpenses(categoryId: string | null) {
  return useQuery({
    queryKey: [...KEY, 'expenses', categoryId],
    enabled: Boolean(categoryId),
    queryFn: async (): Promise<SupplierExpense[]> => {
      const { data, error } = await supabase.from('expenses').select('id, spent_on, amount, vendor, note')
        .eq('category_id', categoryId ?? '').order('spent_on', { ascending: false }).limit(50)
      fail(error)
      return data ?? []
    },
  })
}

/** Any supplier change, then refresh the feature (and maintenance, whose tasks show the supplier). */
function useSupplierMutation<T>(fn: (input: T) => Promise<void>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => Promise.all([client.invalidateQueries({ queryKey: KEY }), client.invalidateQueries({ queryKey: ['maintenance'] })]),
  })
}

/** Saving a draft completes it. A rename also renames the supplier on its linked maintenance tasks. */
export function useSaveSupplier() {
  return useSupplierMutation(async ({ id, ...values }: SupplierInput & { id?: string }) => {
    const row = { ...values, is_draft: false }
    if (!id) return fail((await supabase.from('suppliers').insert(row)).error)
    fail((await supabase.from('suppliers').update(row).eq('id', id)).error)
    fail((await supabase.from('maintenance_tasks').update({ vendor: row.name }).eq('supplier_id', id)).error)
  })
}

/** Deletes the row (contracts and file rows cascade), then its files; a failed cleanup leaves only unreachable files. */
export function useDeleteSupplier() {
  return useSupplierMutation(async (id: string) => {
    const { data, error } = await supabase.from('supplier_contracts').select('supplier_contract_files(file_path)').eq('supplier_id', id)
    fail(error)
    fail((await supabase.from('suppliers').delete().eq('id', id)).error)
    await removeSupplierFiles((data ?? []).flatMap((c) => c.supplier_contract_files.map((f) => f.file_path))).catch(() => undefined)
  })
}

export function useSaveContract() {
  return useSupplierMutation(async ({ id, ...values }: ContractInput & { id?: string }) => {
    const table = supabase.from('supplier_contracts')
    fail((await (id ? table.update(values).eq('id', id) : table.insert(values))).error)
  })
}

export function useDeleteContract() {
  return useSupplierMutation(async (id: string) => {
    const { data, error } = await supabase.from('supplier_contract_files').select('file_path').eq('contract_id', id)
    fail(error)
    fail((await supabase.from('supplier_contracts').delete().eq('id', id)).error)
    await removeSupplierFiles((data ?? []).map((f) => f.file_path)).catch(() => undefined)
  })
}

/** Uploads a contract file and records it; the file is removed again if the row fails. */
export function useAddContractFile() {
  return useSupplierMutation(async ({ contractId, file }: { contractId: string; file: File }) => {
    const path = await uploadSupplierFile(contractId, file)
    const row = { contract_id: contractId, file_path: path, file_name: file.name.slice(0, 200) || path, size_bytes: file.size }
    const { error } = await supabase.from('supplier_contract_files').insert(row)
    if (error) await removeSupplierFiles([path])
    fail(error)
  })
}

export function useRemoveContractFile() {
  return useSupplierMutation(async (f: Pick<ContractFile, 'id' | 'file_path'>) => {
    fail((await supabase.from('supplier_contract_files').delete().eq('id', f.id)).error)
    await removeSupplierFiles([f.file_path]).catch(() => undefined)
  })
}

/** "הוספת ספקים נפוצים": drafts of the usual categories and their inspections; returns how many were added. */
export function useSeedSuppliers() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('seed_common_suppliers')
      fail(error)
      return data ?? 0
    },
    onSettled: () => Promise.all([client.invalidateQueries({ queryKey: KEY }), client.invalidateQueries({ queryKey: ['maintenance'] })]),
    onError: () => notifyError(he.suppliers.errors.seed),
  })
}
