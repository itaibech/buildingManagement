// "ניהול התקלה" data (0039): the admin-only details (cost, supplier), the linked expenses, and the attachments.
// RLS decides who reads what: residents get no admin_details rows, no expenses, and only files visible to them.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Database } from '../../lib/db.types'
import { supabase } from '../../lib/supabase'
import { useSuppliers } from '../suppliers/api'
import { queueTicketFile, sweepTicketFiles } from './fileSweep'
import { FILE_BUCKET, fileType, filePath, isImagePath, MAX_FILES } from './files'

type Tables = Database['public']['Tables']
export type TicketFile = Pick<Tables['ticket_files']['Row'], 'id' | 'path' | 'file_name' | 'size_bytes' | 'visible_to_residents' | 'created_at'>
export type AdminDetails = Pick<Tables['ticket_admin_details']['Row'], 'cost' | 'supplier_id' | 'updated_at'>
export interface LinkedExpense { id: string; amount: number; spent_on: string }
export interface DetailsInput {
  ticketId: string
  vendor: string
  supplierId: string | null
  suggestedSolution: string
  fixDetails: string
  cost: number | null
  /** The edit dialog also saves the text, in the same call. */
  text?: { title: string; description: string; location: string }
}

const KEY = ['tickets'] as const
const SIGN_SECONDS = 60
const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message)
}

/** Admin: the cost / supplier row (null before the first save). */
export function useAdminDetails(ticketId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'admin-details', ticketId],
    enabled,
    queryFn: async (): Promise<AdminDetails | null> => {
      const { data, error } = await supabase.from('ticket_admin_details').select('cost, supplier_id, updated_at').eq('ticket_id', ticketId).maybeSingle()
      fail(error)
      return data
    },
  })
}

/** Admin: expenses recorded for the ticket, newest first. Under the finance key, so saving an expense refreshes it. */
export function useLinkedExpenses(ticketId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['finance', 'ticket-expenses', ticketId],
    enabled,
    queryFn: async (): Promise<LinkedExpense[]> => {
      const { data, error } = await supabase.from('expenses').select('id, amount, spent_on').eq('ticket_id', ticketId)
        .order('spent_on', { ascending: false }).limit(10)
      fail(error)
      return data ?? []
    },
  })
}

/** Admin: suppliers that aren't drafts, for the supplier Select. */
export function useActiveSuppliers(enabled: boolean) {
  const query = useSuppliers(enabled)
  return (query.data ?? []).filter((s) => !s.is_draft)
}

export function useSaveTicketDetails() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (v: DetailsInput) => {
      const { error } = await supabase.rpc('save_ticket_details', {
        p_ticket_id: v.ticketId, p_vendor: v.vendor, p_suggested_solution: v.suggestedSolution, p_fix_details: v.fixDetails,
        p_supplier_id: v.supplierId ?? undefined, p_cost: v.cost ?? undefined,
        p_title: v.text?.title, p_description: v.text?.description, p_location: v.text?.location,
      })
      fail(error)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

/** The ticket's files the caller may read (admins: all), oldest first. */
export function useTicketFiles(ticketId: string, enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'files', ticketId],
    enabled,
    queryFn: async (): Promise<TicketFile[]> => {
      const { data, error } = await supabase.from('ticket_files')
        .select('id, path, file_name, size_bytes, visible_to_residents, created_at').eq('ticket_id', ticketId).order('created_at').limit(MAX_FILES)
      fail(error)
      return data ?? []
    },
  })
}

/** Short-lived (60 s) thumbnail links for the image files, by path. */
export function useThumbnails(files: readonly TicketFile[]) {
  const paths = files.map((f) => f.path).filter(isImagePath).sort()
  return useQuery({
    queryKey: [...KEY, 'file-thumbs', paths],
    enabled: paths.length > 0,
    staleTime: (SIGN_SECONDS - 10) * 1000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.storage.from(FILE_BUCKET).createSignedUrls(paths, SIGN_SECONDS)
      fail(error)
      return Object.fromEntries((data ?? []).flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl]] : [])))
    },
  })
}

/** Signs one file for a minute; `download` saves it under its own name instead of showing it. */
export async function signTicketFile(file: Pick<TicketFile, 'path' | 'file_name'>, download: boolean): Promise<string> {
  const { data, error } = await supabase.storage.from(FILE_BUCKET).createSignedUrl(file.path, SIGN_SECONDS, download ? { download: file.file_name } : undefined)
  fail(error)
  if (!data?.signedUrl) throw new Error('No signed URL')
  return data.signedUrl
}

export interface PickedFile { file: File; visible: boolean }

/** Uploads one file and records its row. A refused row's object is removed again, or queued when that fails too. */
async function uploadOne(ticketId: string, { file, visible }: PickedFile): Promise<boolean> {
  const path = filePath(ticketId, file)
  const bucket = supabase.storage.from(FILE_BUCKET)
  if ((await bucket.upload(path, file, { contentType: fileType(file) ?? file.type })).error) return false
  const { error } = await supabase.from('ticket_files')
    .insert({ ticket_id: ticketId, path, file_name: file.name.slice(0, 200), size_bytes: file.size, visible_to_residents: visible })
  if (error) {
    const removed = await bucket.remove([path])
    if (removed.error || (removed.data?.length ?? 0) === 0) await queueTicketFile(path)
  }
  return !error
}

/** Admin: attaches the files one by one (the DB caps a ticket at 10); returns how many failed. */
export function useUploadTicketFiles() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, files }: { ticketId: string; files: readonly PickedFile[] }) => {
      let failed = 0
      for (const f of files) if (!(await uploadOne(ticketId, f).catch(() => false))) failed += 1
      return failed
    },
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export function useSetFileVisibility() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, visible }: { id: string; visible: boolean }) => {
      const { data, error } = await supabase.from('ticket_files').update({ visible_to_residents: visible }).eq('id', id).select('id')
      fail(error)
      if (!data?.length) throw new Error('File was not updated')
    },
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

/** Admin: removes the row (so no one can read it any more; the DB queues its object), then sweeps the queue. */
export function useDeleteTicketFile() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (file: Pick<TicketFile, 'id'>) => {
      fail((await supabase.from('ticket_files').delete().eq('id', file.id)).error)
      await sweepTicketFiles()
    },
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  })
}
