// Projects writes (admin only under RLS). Every mutation refreshes the projects queries; failures toast `failMessage`.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { notifyError } from '../../ui/notify'
import { receiptMime, receiptPath } from '../finance/ledger'
import { fail, PROJECT_BUCKET, PROJECTS_KEY } from './api'
import type { ProjectInput, Quote, QuoteInput } from './types'

function useProjectMutation<A, R>(fn: (args: A) => Promise<R>, failMessage: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onError: () => notifyError(failMessage),
    onSettled: () => client.invalidateQueries({ queryKey: PROJECTS_KEY }),
  })
}

/** Removes stored files; storage skips what it refuses without an error, so this never throws. */
async function removeFiles(paths: string[]): Promise<void> {
  if (paths.length) await supabase.storage.from(PROJECT_BUCKET).remove(paths)
}

/** Creates (no id) or updates a project; returns its id. */
export function useSaveProject(failMessage: string) {
  return useProjectMutation(async ({ id, input }: { id?: string; input: ProjectInput }): Promise<string> => {
    if (id) {
      fail((await supabase.from('projects').update(input).eq('id', id)).error)
      return id
    }
    const { data, error } = await supabase.from('projects').insert(input).select('id').single()
    fail(error)
    return data?.id ?? ''
  }, failMessage)
}

/** "הצג הצעות לדיירים". */
export function useShowQuotes(failMessage: string) {
  return useProjectMutation(async ({ id, show }: { id: string; show: boolean }) =>
    fail((await supabase.from('projects').update({ show_quotes: show }).eq('id', id)).error), failMessage)
}

/** Deletes the project (its quotes cascade) after removing the quote files; linked expenses are unlinked by the FK. */
export function useDeleteProject(failMessage: string) {
  return useProjectMutation(async ({ id, files }: { id: string; files: string[] }) => {
    await removeFiles(files)
    fail((await supabase.from('projects').delete().eq('id', id)).error)
  }, failMessage)
}

/** Uploads a quote file under `<project_id>/<uuid>.<ext>` and links it; false (and nothing left behind) on failure. */
async function attachFile(quote: { id: string; project_id: string }, file: File): Promise<boolean> {
  const mime = receiptMime(file)
  const path = mime ? receiptPath(quote.project_id, mime) : null
  if (!mime || !path) return false
  const bucket = supabase.storage.from(PROJECT_BUCKET)
  if ((await bucket.upload(path, file, { contentType: mime })).error) return false
  const row = { file_path: path, file_name: file.name.slice(0, 255) || path, file_size: file.size }
  const { error } = await supabase.from('project_quotes').update(row).eq('id', quote.id)
  if (error) await bucket.remove([path])
  return !error
}

export interface SaveQuoteArgs { projectId: string; existing?: Quote; input: QuoteInput; file: File | null; dropFile: boolean }

/** Saves a quote; a new file (or dropFile) replaces the old one, removed only after the change. `fileFailed` on upload failure. */
export function useSaveQuote(failMessage: string) {
  return useProjectMutation(async ({ projectId, existing, input, file, dropFile }: SaveQuoteArgs) => {
    let id = existing?.id ?? ''
    if (existing) fail((await supabase.from('project_quotes').update(input).eq('id', id)).error)
    else {
      const { data, error } = await supabase.from('project_quotes').insert({ ...input, project_id: projectId }).select('id').single()
      fail(error)
      id = data?.id ?? ''
    }
    const old = existing?.file_path ?? null
    if (file) {
      const ok = await attachFile({ id, project_id: projectId }, file)
      if (ok && old) await removeFiles([old])
      return { fileFailed: !ok }
    }
    if (dropFile && old) {
      fail((await supabase.from('project_quotes').update({ file_path: null, file_name: null, file_size: null }).eq('id', id)).error)
      await removeFiles([old])
    }
    return { fileFailed: false }
  }, failMessage)
}

export function useDeleteQuote(failMessage: string) {
  return useProjectMutation(async (quote: Pick<Quote, 'id' | 'file_path'>) => {
    fail((await supabase.from('project_quotes').delete().eq('id', quote.id)).error)
    if (quote.file_path) await removeFiles([quote.file_path])
  }, failMessage)
}

export interface ChooseArgs { projectId: string; quoteId: string | null; note: string; meetingId: string | null }

/** choose_project_quote(): the chosen quote (or none), the decision note and meeting. */
export function useChooseQuote(failMessage: string) {
  return useProjectMutation(async ({ projectId, quoteId, note, meetingId }: ChooseArgs) =>
    fail((await supabase.rpc('choose_project_quote', {
      p_project: projectId, p_note: note, ...(quoteId ? { p_quote: quoteId } : {}), ...(meetingId ? { p_meeting: meetingId } : {}),
    })).error), failMessage)
}

/** Links an expense to a project, or unlinks it (null). */
export function useLinkExpense(failMessage: string) {
  return useProjectMutation(async ({ expenseId, projectId }: { expenseId: string; projectId: string | null }) =>
    fail((await supabase.from('expenses').update({ project_id: projectId }).eq('id', expenseId)).error), failMessage)
}
