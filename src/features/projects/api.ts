// Projects data access, reads (the writes are in mutations.ts). RLS and the 0030 RPCs enforce every rule: residents get
// the chosen quote only (all quotes and files when show_quotes), aggregates only from project_progress, no expense rows.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { groupLevies } from './logic'
import {
  isProjectStatus, type LevyOption, type Progress, type Project, type ProjectEvent, type Quote,
} from './types'

export const PROJECTS_KEY = ['projects'] as const
export const PROJECT_BUCKET = 'project-files'
const SIGNED_URL_SECONDS = 60 * 60
// Explicit columns: created_by is not readable by API users (0030 column privileges).
const PROJECT_COLUMNS = 'id, title, description, status, estimated_cost, final_cost, start_date, end_date, levy_label, levy_month, show_quotes, decision_note, decision_meeting_id, created_at, project_quotes(amount, is_chosen)'

export const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message)
}
const num = (v: number | string | null): number | null => (v === null ? null : Number(v))

interface ProjectRow {
  id: string; title: string; description: string; status: string; estimated_cost: number | null; final_cost: number | null
  start_date: string | null; end_date: string | null; levy_label: string | null; levy_month: string | null
  show_quotes: boolean; decision_note: string; decision_meeting_id: string | null; created_at: string
  project_quotes: { amount: number; is_chosen: boolean }[]
}

export function toProject({ project_quotes, ...r }: ProjectRow): Project {
  const chosen = project_quotes.find((q) => q.is_chosen)
  return {
    id: r.id, title: r.title, description: r.description, status: isProjectStatus(r.status) ? r.status : 'planning',
    estimated_cost: num(r.estimated_cost), final_cost: num(r.final_cost), start_date: r.start_date, end_date: r.end_date,
    levy_label: r.levy_label, levy_month: r.levy_month, show_quotes: r.show_quotes, decision_note: r.decision_note,
    decision_meeting_id: r.decision_meeting_id, created_at: r.created_at, chosen_amount: chosen ? Number(chosen.amount) : null,
  }
}

/** Every project the user may see, newest first. */
export function useProjects() {
  return useQuery({
    queryKey: [...PROJECTS_KEY, 'list'],
    queryFn: async (): Promise<Project[]> => {
      const { data, error } = await supabase.from('projects').select(PROJECT_COLUMNS).order('created_at', { ascending: false })
      fail(error)
      return (data ?? []).map(toProject)
    },
  })
}

/** One project (null when missing or not visible). */
export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: [...PROJECTS_KEY, 'detail', id],
    enabled: !!id,
    queryFn: async (): Promise<Project | null> => {
      const { data, error } = await supabase.from('projects').select(PROJECT_COLUMNS).eq('id', id ?? '').maybeSingle()
      fail(error)
      return data ? toProject(data) : null
    },
  })
}

/** Signed links for the files the user may read; a file storage refuses just gets no link. */
async function signFiles(paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map()
  const { data } = await supabase.storage.from(PROJECT_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)
  return new Map((data ?? []).flatMap((u) => (u.path && u.signedUrl && !u.error ? [[u.path, u.signedUrl]] : [])))
}

/** The quotes the user may see, with download links. */
export function useQuotes(projectId: string) {
  return useQuery({
    queryKey: [...PROJECTS_KEY, 'quotes', projectId],
    staleTime: (SIGNED_URL_SECONDS / 2) * 1000,
    queryFn: async (): Promise<Quote[]> => {
      const { data, error } = await supabase.from('project_quotes')
        .select('id, project_id, vendor, amount, notes, file_path, file_name, is_chosen, created_at').eq('project_id', projectId)
      fail(error)
      const rows = data ?? []
      const urls = await signFiles(rows.flatMap((q) => (q.file_path ? [q.file_path] : [])))
      return rows.map((q) => ({ ...q, amount: Number(q.amount), url: q.file_path ? urls.get(q.file_path) ?? null : null }))
    },
  })
}

/** The project's status changes, oldest first. */
export function useProjectEvents(projectId: string) {
  return useQuery({
    queryKey: [...PROJECTS_KEY, 'events', projectId],
    queryFn: async (): Promise<ProjectEvent[]> => {
      const { data, error } = await supabase.from('project_events').select('status, created_at').eq('project_id', projectId).order('created_at')
      fail(error)
      return (data ?? []).flatMap((e) => (isProjectStatus(e.status) ? [{ status: e.status, created_at: e.created_at }] : []))
    },
  })
}

/** project_progress(): every project's aggregates by id. */
export function useProjectProgress() {
  return useQuery({
    queryKey: [...PROJECTS_KEY, 'progress'],
    queryFn: async (): Promise<Map<string, Progress>> => {
      const { data, error } = await supabase.rpc('project_progress')
      fail(error)
      return new Map((data ?? []).map((r) => [r.project_id, {
        levyTotal: Number(r.levy_total), levyDue: Number(r.levy_due), levyCollected: Number(r.levy_collected),
        levyWrittenOff: Number(r.levy_written_off), apartmentsCharged: r.apartments_charged, apartmentsOpen: r.apartments_open,
        countsHidden: r.counts_hidden, spent: Number(r.spent), expenseCount: r.expense_count,
      }]))
    },
  })
}

/** Admin: the levies a project can be linked to (label → months), from the levy charges. */
export function useLevyOptions(enabled: boolean) {
  return useQuery({
    queryKey: [...PROJECTS_KEY, 'levies'],
    enabled,
    queryFn: async (): Promise<LevyOption[]> => {
      const { data, error } = await supabase.from('charges').select('label, month').eq('kind', 'levy')
      fail(error)
      return groupLevies(data ?? [])
    },
  })
}

export interface ProjectExpense { id: string; spent_on: string; amount: number; vendor: string; note: string; category: string }

const EXPENSE_COLUMNS = 'id, spent_on, amount, vendor, note, expense_categories(name)'
const toExpense = ({ expense_categories, ...e }: { id: string; spent_on: string; amount: number; vendor: string; note: string; expense_categories: { name: string } | null }): ProjectExpense =>
  ({ ...e, amount: Number(e.amount), category: expense_categories?.name ?? '' })

/** Admin: the expenses linked to the project (`projectId`), or the latest unlinked ones (null) to pick from. */
export function useProjectExpenses(projectId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...PROJECTS_KEY, 'expenses', projectId],
    enabled,
    queryFn: async (): Promise<ProjectExpense[]> => {
      const base = supabase.from('expenses').select(EXPENSE_COLUMNS)
      const q = projectId ? base.eq('project_id', projectId) : base.is('project_id', null).limit(200)
      const { data, error } = await q.order('spent_on', { ascending: false }).order('created_at', { ascending: false })
      fail(error)
      return (data ?? []).map(toExpense)
    },
  })
}
