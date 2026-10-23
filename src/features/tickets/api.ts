import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Database } from '../../lib/db.types'
import { supabase } from '../../lib/supabase'
import { PHOTO_BUCKET, photoPath } from './photos'

type Row = Database['public']['Tables']['tickets']['Row']
export type TicketStatus = 'open' | 'in_progress' | 'closed'
export const TICKET_STATUSES: readonly TicketStatus[] = ['open', 'in_progress', 'closed']
export type Ticket = Omit<Row, 'status'> & { status: TicketStatus }
export type TicketListItem = Ticket & { photoCount: number }

export interface TicketComment {
  id: string
  body: string
  created_at: string
  author_id: string | null
  authorName: string | null
}
export interface TicketPhoto {
  id: string
  path: string
  url: string | null
}
export interface TicketDetail extends Ticket {
  openerName: string | null
  comments: TicketComment[]
  photos: TicketPhoto[]
}
export interface TicketInput {
  title: string
  description: string
  location: string
}
export type TicketPatch = Partial<TicketInput & { status: TicketStatus; vendor: string | null }>

const KEY = ['tickets'] as const
const SIGNED_URL_SECONDS = 60 * 60

const asStatus = (s: string): TicketStatus => (TICKET_STATUSES.find((t) => t === s) ?? 'open')
const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message)
}

async function fetchTickets(statuses: readonly TicketStatus[] | undefined): Promise<TicketListItem[]> {
  let query = supabase.from('tickets').select('*, ticket_photos(count)').order('created_at', { ascending: false })
  if (statuses) query = query.in('status', [...statuses])
  const { data, error } = await query
  fail(error)
  return (data ?? []).map(({ ticket_photos, ...t }) => ({ ...t, status: asStatus(t.status), photoCount: ticket_photos[0]?.count ?? 0 }))
}

/** Tickets, newest first. `statuses` undefined means all. */
export function useTickets(statuses?: readonly TicketStatus[]) {
  return useQuery({ queryKey: [...KEY, 'list', statuses ? [...statuses].sort() : 'all'], queryFn: () => fetchTickets(statuses) })
}

async function namesFor(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))]
  if (unique.length === 0) return new Map()
  const { data, error } = await supabase.rpc('user_names', { ids: unique })
  fail(error)
  return new Map((data ?? []).map((r) => [r.user_id, r.full_name]))
}

async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map()
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)
  fail(error)
  return new Map((data ?? []).flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])))
}

async function fetchTicket(id: string): Promise<TicketDetail | null> {
  const { data, error } = await supabase
    .from('tickets')
    .select('*, ticket_photos(id, path, created_at), ticket_comments(id, body, created_at, author_id)')
    .eq('id', id)
    .maybeSingle()
  fail(error)
  if (!data) return null
  const { ticket_photos, ticket_comments, ...t } = data
  const [names, urls] = await Promise.all([
    namesFor([t.opened_by, ...ticket_comments.map((c) => c.author_id)]),
    signedUrls(ticket_photos.map((p) => p.path)),
  ])
  const comments = [...ticket_comments]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((c) => ({ ...c, authorName: (c.author_id && names.get(c.author_id)) || null }))
  const photos = [...ticket_photos]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((p) => ({ id: p.id, path: p.path, url: urls.get(p.path) ?? null }))
  return { ...t, status: asStatus(t.status), openerName: (t.opened_by && names.get(t.opened_by)) || null, comments, photos }
}

/** One ticket with its photos (signed URLs, 1 hour), comments (oldest first) and display names. */
export function useTicket(id: string) {
  return useQuery({ queryKey: [...KEY, 'detail', id], queryFn: () => fetchTicket(id) })
}

async function uploadPhotos(ticketId: string, files: readonly File[]): Promise<void> {
  const paths = files.map((f) => photoPath(ticketId, f))
  const bucket = supabase.storage.from(PHOTO_BUCKET)
  const results = await Promise.all(files.map((f, i) => bucket.upload(paths[i], f, { contentType: f.type })))
  results.forEach((r) => fail(r.error))
  const { error } = await supabase.from('ticket_photos').insert(paths.map((path) => ({ ticket_id: ticketId, path })))
  fail(error)
}

/** Opens a ticket, then uploads its photos and records them. `photosFailed` when only the photos failed. */
export function useCreateTicket() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ values, files }: { values: TicketInput; files: readonly File[] }) => {
      const { data, error } = await supabase.from('tickets').insert(values).select('id').single()
      fail(error)
      if (!data) throw new Error('Ticket was not created')
      if (files.length === 0) return { id: data.id, photosFailed: false }
      const photosFailed = await uploadPhotos(data.id, files).then(() => false, () => true)
      return { id: data.id, photosFailed }
    },
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

/** Admins: status/vendor (and text). Openers: title/description/location while open (enforced by RLS). */
export function useUpdateTicket() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TicketPatch }) => {
      const { data, error } = await supabase.from('tickets').update(patch).eq('id', id).select('id')
      fail(error)
      if (!data?.length) throw new Error('Ticket was not updated')
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export function useAddComment() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ ticketId, body }: { ticketId: string; body: string }) => {
      const { error } = await supabase.from('ticket_comments').insert({ ticket_id: ticketId, body })
      fail(error)
    },
    onSuccess: (_d, v) => client.invalidateQueries({ queryKey: [...KEY, 'detail', v.ticketId] }),
  })
}

/** Admin: removes the ticket's storage objects, then the ticket (comments and photo rows cascade). */
export function useDeleteTicket() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, paths }: { id: string; paths: string[] }) => {
      if (paths.length > 0) fail((await supabase.storage.from(PHOTO_BUCKET).remove(paths)).error)
      const { error } = await supabase.from('tickets').delete().eq('id', id)
      fail(error)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}
