import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Database } from '../../lib/db.types'
import { he } from '../../lib/he'
import { supabase } from '../../lib/supabase'
import { notifyError } from '../../ui/notify'
import type { Frequency } from './nextDue'

export type Task = Omit<Database['public']['Tables']['maintenance_tasks']['Row'], 'frequency'> & { frequency: Frequency }
export type LogEntry = Database['public']['Tables']['maintenance_log']['Row']

export interface TaskInput {
  title: string
  vendor: string
  frequency: Frequency
  next_due: string | null
}

export interface MarkDoneInput {
  task: Task
  doneOn: string
  note: string
  /** Posted as a building expense in `categoryId` when > 0. */
  cost: number | null
  categoryId: string | null
}

export type ExpenseCategory = Pick<Database['public']['Tables']['expense_categories']['Row'], 'id' | 'name'>

const KEY = ['maintenance'] as const
const logKey = (taskId: string) => [...KEY, 'log', taskId] as const

/** All tasks, soonest due first (undated last). */
export function useTasks() {
  return useQuery({
    queryKey: [...KEY, 'tasks'],
    queryFn: async (): Promise<Task[]> => {
      const { data, error } = await supabase.from('maintenance_tasks').select('*').order('next_due', { nullsFirst: false }).order('title')
      if (error) throw new Error(error.message)
      return data as Task[]
    },
  })
}

/** Task id to its most recent done date, read on demand for the export (same table the task detail reads). */
export async function fetchLastDone(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('maintenance_log').select('task_id, done_on').order('done_on', { ascending: false })
  if (error) throw new Error(error.message)
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
      const { data, error } = await supabase
        .from('maintenance_log').select('*').eq('task_id', taskId ?? '')
        .order('done_on', { ascending: false }).order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return data
    },
  })
}

/** Logs a completion atomically (RPC); the server moves `next_due` from the latest done date. */
export function useMarkDone() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ task, doneOn, note, cost, categoryId }: MarkDoneInput) => {
      const { error } = await supabase.rpc('mark_task_done', {
        p_task_id: task.id, p_done_on: doneOn, p_note: note, p_cost: cost ?? undefined, p_category_id: categoryId ?? undefined,
      })
      if (error) throw new Error(error.message)
    },
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
    mutationFn: async ({ id, ...values }: TaskInput & { id?: string }) => {
      const table = supabase.from('maintenance_tasks')
      const { error } = await (id ? table.update(values).eq('id', id) : table.insert(values))
      if (error) throw new Error(error.message)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteTask() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('maintenance_tasks').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}
