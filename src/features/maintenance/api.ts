import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Database } from '../../lib/db.types'
import { he } from '../../lib/he'
import { fetchAll } from '../../lib/fetchAll'
import { supabase } from '../../lib/supabase'
import { notifyError } from '../../ui/notify'
import { removeSupplierFiles, uploadSupplierFile } from '../suppliers/files'
import type { Frequency } from './nextDue'

export type Task = Omit<Database['public']['Tables']['maintenance_tasks']['Row'], 'frequency'> & { frequency: Frequency }
export type LogEntry = Database['public']['Tables']['maintenance_log']['Row']

export interface TaskInput {
  title: string
  vendor: string
  frequency: Frequency
  next_due: string | null
  supplier_id: string | null
  remind_days: number
  /** New tasks only: an earlier completion, recorded in the log (next_due is already computed from it). */
  lastDone?: string | null
}

export interface MarkDoneInput {
  task: Task
  doneOn: string
  note: string
  /** Posted as a building expense in `categoryId` when > 0. */
  cost: number | null
  categoryId: string | null
  /** The inspection report, stored privately (admin only) and linked to the log entry. */
  report?: File | null
}

/**
 * The supplier and vendor a task saves. Until the suppliers list loads (or if it failed) the picked id is kept as is;
 * a draft supplier's placeholder name never becomes the vendor.
 */
export function supplierFields(
  v: { supplier_id: string | null; vendor: string },
  suppliers: readonly { id: string; name: string; is_draft: boolean }[] | undefined,
): { supplier_id: string | null; vendor: string } {
  const supplier = suppliers?.find((s) => s.id === v.supplier_id)
  const vendor = supplier && !supplier.is_draft ? supplier.name : v.vendor.trim()
  return { supplier_id: suppliers ? supplier?.id ?? null : v.supplier_id, vendor }
}

export type ExpenseCategory = Pick<Database['public']['Tables']['expense_categories']['Row'], 'id' | 'name'>

const KEY = ['maintenance'] as const
const logKey = (taskId: string) => [...KEY, 'log', taskId] as const

/** All tasks, soonest due first (undated last). */
export function useTasks(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'tasks'],
    enabled,
    queryFn: async (): Promise<Task[]> => {
      const { data, error } = await supabase.from('maintenance_tasks').select('*').order('next_due', { nullsFirst: false }).order('title')
      if (error) throw new Error(error.message)
      return data as Task[]
    },
  })
}

/** Task id to its most recent done date, read on demand for the export (same table the task detail reads). */
export async function fetchLastDone(): Promise<Map<string, string>> {
  const data = await fetchAll((f, t) => supabase.from('maintenance_log').select('task_id, done_on').order('done_on', { ascending: false }).order('id').range(f, t))
  const last = new Map<string, string>()
  for (const row of data) if (!last.has(row.task_id)) last.set(row.task_id, row.done_on)
  return last
}

/** Done log for one task, newest first. */
export function useTaskLog(taskId: string | undefined) {
  return useQuery({
    queryKey: logKey(taskId ?? ''),
    enabled: Boolean(taskId),
    queryFn: async (): Promise<LogEntry[]> => {
      return fetchAll((f, t) => supabase
        .from('maintenance_log').select('*').eq('task_id', taskId ?? '')
        .order('done_on', { ascending: false }).order('created_at', { ascending: false }).order('id').range(f, t))
    },
  })
}

/**
 * Uploads the report (if any), then logs the completion with it in one RPC: either both are recorded or neither is
 * (a failed call removes the upload), so retrying never duplicates a log entry.
 */
async function markDone({ task, doneOn, note, cost, categoryId, report }: MarkDoneInput): Promise<void> {
  const path = report ? await uploadSupplierFile(task.id, report) : null
  const { error } = await supabase.rpc('mark_task_done', {
    p_task_id: task.id, p_done_on: doneOn, p_note: note, p_cost: cost ?? undefined, p_category_id: categoryId ?? undefined,
    p_report_path: path ?? undefined, p_report_name: path && report ? report.name.slice(0, 200) : undefined,
  })
  if (!error) return
  if (path) await removeSupplierFiles([path]).catch(() => undefined)
  throw new Error(error.message)
}

/** Logs a completion atomically (RPC); the server moves `next_due` from the latest done date. */
export function useMarkDone() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: markDone,
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
    onError: () => notifyError(he.toast.failed),
  })
}

/** Expense categories for the cost field, in the building's order. */
export function useExpenseCategories() {
  return useQuery({
    queryKey: ['expense_categories'],
    queryFn: async (): Promise<ExpenseCategory[]> => {
      const { data, error } = await supabase.from('expense_categories').select('id, name').order('sort_order').order('name')
      if (error) throw new Error(error.message)
      return data
    },
  })
}

export function useSaveTask() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, lastDone, ...values }: TaskInput & { id?: string }) => {
      const table = supabase.from('maintenance_tasks')
      if (id) {
        const { error } = await table.update(values).eq('id', id)
        if (error) throw new Error(error.message)
        return
      }
      const { data, error } = await table.insert(values).select('id').single()
      if (error) throw new Error(error.message)
      // The task exists now: a failed history entry only warns (throwing would invite a retry that duplicates the task).
      if (!lastDone) return
      const logged = await supabase.from('maintenance_log').insert({ task_id: data.id, done_on: lastDone })
      if (logged.error) notifyError(he.maintenance.lastDoneFailed)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteTask() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      // The row first (its log cascades), then the inspection reports: storage doesn't cascade, and a failed cleanup
      // only leaves an unreachable file in the admin-only bucket, never a task pointing at a missing report.
      const reports = await fetchAll((f, t) => supabase.from('maintenance_log').select('report_path').eq('task_id', id).not('report_path', 'is', null)
        .order('id').range(f, t))
      const { error } = await supabase.from('maintenance_tasks').delete().eq('id', id)
      if (error) throw new Error(error.message)
      await removeSupplierFiles(reports.flatMap((r) => (r.report_path ? [r.report_path] : []))).catch(() => undefined)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}
