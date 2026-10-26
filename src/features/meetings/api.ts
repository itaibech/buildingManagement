// Meetings data access (the only place the feature touches supabase). RLS and the 0021 RPCs enforce every rule.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { he } from '../../lib/he'
import { supabase } from '../../lib/supabase'
import { notifyError } from '../../ui/notify'
import { meetingError } from './errors'
import { toDetail, toMeeting, type DetailRow } from './rows'
import type { AgendaItem, Attendance, MeetingDetail, MeetingKind, MeetingListItem, QuorumMode, SignatureRole } from './types'

export const MEETING_BUCKET = 'meeting-files'
export const MAX_FILE_BYTES = 10 * 1024 * 1024
const SIGNED_URL_SECONDS = 60 * 60
const KEY = ['meetings'] as const

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message)
}

/** Every meeting the user may see (RLS: residents get invited and published ones), newest first, with decisions. */
export function useMeetings() {
  return useQuery({
    queryKey: [...KEY, 'list'],
    queryFn: async (): Promise<MeetingListItem[]> => {
      const { data, error } = await supabase.from('meetings').select('*, meeting_agenda_items(decision)').order('scheduled_at', { ascending: false })
      fail(error)
      return (data ?? []).map(({ meeting_agenda_items, ...m }) => ({
        ...toMeeting(m), decisions: meeting_agenda_items.map((i) => i.decision).filter(Boolean),
      }))
    },
  })
}

/** One meeting with its agenda, attendance, signatures and addenda (null when missing or not visible). */
export function useMeeting(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'detail', id],
    enabled: !!id,
    queryFn: async (): Promise<MeetingDetail | null> => {
      const { data, error } = await supabase.from('meetings')
        .select('*, meeting_agenda_items(*), meeting_attendance(*), meeting_signatures(*), meeting_addenda(*)')
        .eq('id', id ?? '').maybeSingle()
      fail(error)
      if (!data) return null
      const detail = toDetail(data satisfies DetailRow)
      return detail.status === 'invited' && detail.items.length === 0 ? { ...detail, items: await agendaTitles(detail.id) } : detail
    },
  })
}

/**
 * Residents don't read agenda rows before publication (RLS); an invited meeting's agenda comes as order and titles
 * only, from meeting_agenda_titles().
 */
async function agendaTitles(meetingId: string): Promise<AgendaItem[]> {
  const { data, error } = await supabase.rpc('meeting_agenda_titles', { p_meeting: meetingId })
  fail(error)
  return (data ?? []).map((r) => ({
    id: r.id, meeting_id: meetingId, position: r.item_position, title: r.title, discussion: '', votes_for: null, votes_against: null,
    votes_abstain: null, decision: '', decision_number: null, item_status: 'open', added_during_meeting: false, attendees_at_vote: null, created_at: '',
  }))
}

export interface MeetingEvent { id: string; kind: string; created_at: string }

/** Admin: the meeting's audit log (RLS: admins only). */
export function useMeetingEvents(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'events', id],
    enabled,
    queryFn: async (): Promise<MeetingEvent[]> => {
      const { data, error } = await supabase.from('meeting_events').select('id, kind, created_at').eq('meeting_id', id).order('created_at')
      fail(error)
      return data ?? []
    },
  })
}

export interface MeetingInput {
  kind: MeetingKind
  title: string
  scheduled_at: string
  location: string
  quorum_mode: QuorumMode
  quorum_value: number | null
  quorum_note: string
  /** In order; `id` for items that already exist. */
  agenda: { id?: string; title: string; discussion: string }[]
}

async function syncAgenda(meetingId: string, agenda: MeetingInput['agenda'], existing: readonly AgendaItem[]): Promise<void> {
  const keep = new Set(agenda.flatMap((a) => (a.id ? [a.id] : [])))
  const gone = existing.filter((i) => !keep.has(i.id)).map((i) => i.id)
  if (gone.length) fail((await supabase.from('meeting_agenda_items').delete().in('id', gone)).error)
  for (const [i, a] of agenda.entries()) {
    const row = { title: a.title.trim(), discussion: a.discussion, position: i + 1 }
    const old = existing.find((e) => e.id === a.id)
    if (old && old.title === row.title && old.discussion === row.discussion && old.position === row.position) continue
    const q = supabase.from('meeting_agenda_items')
    fail((await (a.id ? q.update(row).eq('id', a.id) : q.insert({ ...row, meeting_id: meetingId }))).error)
  }
}

/** Creates or updates a draft / invited meeting and its agenda; returns the meeting id. */
export function useSaveMeeting() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, existing, input }: { id?: string; existing: readonly AgendaItem[]; input: MeetingInput }): Promise<string> => {
      const { agenda, ...fields } = input
      const table = supabase.from('meetings')
      const res = await (id ? table.update(fields).eq('id', id).select('id').single() : table.insert(fields).select('id').single())
      fail(res.error)
      const meetingId = res.data?.id ?? id ?? ''
      await syncAgenda(meetingId, agenda, existing)
      return meetingId
    },
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

/**
 * Runs one meeting action (an RPC or a write), then refreshes the meetings; failures toast the Hebrew reason.
 * Also invalidates announcements, since invitations and publications post there.
 */
export function useMeetingCall() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (call: () => Promise<void>) => call(),
    onError: (e) => notifyError(meetingError(e)),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: KEY })
      await client.invalidateQueries({ queryKey: ['announcements'] })
    },
  })
}

/** Removes files from the bucket; throws 'meeting:files_kept' when any of them is still there. */
async function removeFiles(paths: readonly string[]): Promise<void> {
  if (!paths.length) return
  const { data, error } = await supabase.storage.from(MEETING_BUCKET).remove([...paths])
  fail(error)
  if ((data ?? []).length < paths.length) throw new Error('meeting:files_kept')
}

const rpcDone = ({ error }: { error: { message: string } | null }): void => fail(error)

export const meetingRpc = {
  /** details: each topic's details under its title in the announcement. */
  invite: async (id: string, confirm: boolean, details = false) =>
    rpcDone(await supabase.rpc('invite_meeting', { p_meeting: id, p_confirm_short_notice: confirm, p_include_details: details })),
  updateInvite: async (id: string, details = false) =>
    rpcDone(await supabase.rpc('update_meeting_invitation', { p_meeting: id, p_include_details: details })),
  postpone: async (id: string) => rpcDone(await supabase.rpc('postpone_meeting', { p_meeting: id })),
  /** openedAt null: the server records now(). override: "פתיחה ללא מניין". */
  open: async (id: string, openedAt: string | null, chair: string, secretary: string, override = false) =>
    rpcDone(await supabase.rpc('open_meeting', {
      p_meeting: id, p_chair: chair, p_secretary: secretary, p_override_quorum: override, ...(openedAt ? { p_opened_at: openedAt } : {}),
    })),
  /** Draft → in progress now, without an invitation. */
  quickStart: async (id: string, chair: string, secretary: string, override: boolean) =>
    rpcDone(await supabase.rpc('quick_start_meeting', { p_meeting: id, p_chair: chair, p_secretary: secretary, p_override_quorum: override })),
  cancelPostpone: async (id: string) => rpcDone(await supabase.rpc('cancel_postponement', { p_meeting: id })),
  close: async (id: string, closedAt: string) => rpcDone(await supabase.rpc('close_meeting', { p_meeting: id, p_closed_at: closedAt })),
  sign: async (id: string, role: SignatureRole, name: string, path: string, method: 'drawn' | 'scan') =>
    rpcDone(await supabase.rpc('sign_meeting', { p_meeting: id, p_role: role, p_signer_name: name, p_image_path: path, p_method: method })),
  publish: async (id: string) => rpcDone(await supabase.rpc('publish_meeting', { p_meeting: id })),
  addendum: async (id: string, body: string) => rpcDone(await supabase.rpc('add_addendum', { p_meeting: id, p_body: body })),
  /**
   * Deletes a draft; its documents' files first (the rows go with the meeting). Re-reads the state, since only a draft
   * may lose its files, and checks every file was really removed (storage skips what RLS forbids without an error).
   */
  remove: async (id: string) => {
    const m = await supabase.from('meetings').select('status, meeting_documents(file_path)').eq('id', id).maybeSingle()
    fail(m.error)
    if (m.data?.status !== 'draft') throw new Error('meeting:state')
    await removeFiles(m.data.meeting_documents.map((d) => d.file_path))
    rpcDone(await supabase.from('meetings').delete().eq('id', id))
  },
}

export type ItemPatch = Partial<Pick<AgendaItem, 'discussion' | 'decision' | 'item_status' | 'votes_for' | 'votes_against' | 'votes_abstain'>>

/** Autosave of one agenda item during the meeting. */
export async function saveItem(id: string, patch: ItemPatch): Promise<void> {
  fail((await supabase.from('meeting_agenda_items').update(patch).eq('id', id)).error)
}

/** "שונות": an item added during the meeting (the DB marks it so). */
export async function addItem(meetingId: string, title: string, position: number): Promise<void> {
  fail((await supabase.from('meeting_agenda_items').insert({ meeting_id: meetingId, title, position })).error)
}

export type AttendanceValue = Pick<Attendance, 'status' | 'attendee_name' | 'proxy_name' | 'proxy_file_path'>

/** Autosave of one apartment's attendance (one row per meeting and apartment). */
export async function saveAttendance(meetingId: string, apartmentId: string, v: AttendanceValue): Promise<void> {
  const row = { meeting_id: meetingId, apartment_id: apartmentId, ...v }
  fail((await supabase.from('meeting_attendance').upsert(row, { onConflict: 'meeting_id,apartment_id' })).error)
}

const MIME_EXT: Readonly<Record<string, string>> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf',
}

/** Why a file can't be stored (type or size), or null. */
export function fileProblem(file: Blob): 'type' | 'size' | null {
  if (!Object.hasOwn(MIME_EXT, file.type)) return 'type'
  return file.size > MAX_FILE_BYTES ? 'size' : null
}

/** Stores a file under `<meeting_id>/<uuid>.<ext>` in the private bucket; returns its path. */
export async function uploadMeetingFile(meetingId: string, file: Blob): Promise<string> {
  const path = `${meetingId}/${crypto.randomUUID()}.${MIME_EXT[file.type] ?? 'png'}`
  fail((await supabase.storage.from(MEETING_BUCKET).upload(path, file, { contentType: file.type })).error)
  return path
}

/** Short-lived links to the meeting's files (signatures, proxy forms, scans) by path. */
export function useMeetingFileUrls(paths: readonly string[]) {
  const sorted = [...new Set(paths)].sort()
  return useQuery({
    queryKey: [...KEY, 'files', sorted],
    enabled: sorted.length > 0,
    staleTime: (SIGNED_URL_SECONDS / 2) * 1000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.storage.from(MEETING_BUCKET).createSignedUrls(sorted, SIGNED_URL_SECONDS)
      fail(error)
      return Object.fromEntries((data ?? []).flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl]] : [])))
    },
  })
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const DOCUMENT_EXT: Readonly<Record<string, string>> = { ...MIME_EXT, [DOCX_MIME]: 'docx' }

export interface MeetingDocument { id: string; file_path: string; file_name: string; size_bytes: number; created_at: string; url: string | null }

/** A document's content type: the browser's, or .docx by name (some browsers leave Word files untyped). */
export function documentType(file: File): string | null {
  if (Object.hasOwn(DOCUMENT_EXT, file.type)) return file.type
  return !file.type && file.name.toLowerCase().endsWith('.docx') ? DOCX_MIME : null
}

/** Why a file can't be attached as a meeting document (PDF / Word / image, 1 byte to 10 MB), or null. */
export function documentProblem(file: File): 'type' | 'empty' | 'size' | null {
  if (!documentType(file)) return 'type'
  if (file.size === 0) return 'empty'
  return file.size > MAX_FILE_BYTES ? 'size' : null
}

/** A signed URL that downloads under the document's own name (the storage `download` query parameter). */
const withDownloadName = (url: string, name: string): string => `${url}&download=${encodeURIComponent(name)}`

/** The meeting's documents (RLS: residents only once published), with short-lived download links signed in one call. */
export function useMeetingDocuments(meetingId: string) {
  return useQuery({
    queryKey: [...KEY, 'documents', meetingId],
    staleTime: (SIGNED_URL_SECONDS / 2) * 1000,
    queryFn: async (): Promise<MeetingDocument[]> => {
      const { data, error } = await supabase.from('meeting_documents').select('id, file_path, file_name, size_bytes, created_at')
        .eq('meeting_id', meetingId).order('created_at')
      fail(error)
      const docs = data ?? []
      if (!docs.length) return []
      const signed = await supabase.storage.from(MEETING_BUCKET).createSignedUrls(docs.map((d) => d.file_path), SIGNED_URL_SECONDS)
      fail(signed.error)
      const urls = new Map((signed.data ?? []).flatMap((u) => (u.path && u.signedUrl ? [[u.path, u.signedUrl]] : [])))
      return docs.map((d) => {
        const url = urls.get(d.file_path)
        return { ...d, url: url ? withDownloadName(url, d.file_name) : null }
      })
    },
  })
}

/** Uploads a document under `<meeting_id>/<uuid>.<ext>` and records it; the file is removed again if the row fails. */
export async function addMeetingDocument(meetingId: string, file: File): Promise<void> {
  const type = documentType(file) ?? ''
  const path = `${meetingId}/${crypto.randomUUID()}.${DOCUMENT_EXT[type] ?? 'pdf'}`
  const bucket = supabase.storage.from(MEETING_BUCKET)
  fail((await bucket.upload(path, file, { contentType: type })).error)
  const row = { meeting_id: meetingId, file_path: path, file_name: file.name.slice(0, 200) || path, size_bytes: file.size }
  const { error } = await supabase.from('meeting_documents').insert(row)
  if (error) await bucket.remove([path])
  fail(error)
}

/** Removes a document: its file first (checked, so a refused removal changes nothing), then the row. */
export async function removeMeetingDocument(doc: Pick<MeetingDocument, 'id' | 'file_path'>): Promise<void> {
  await removeFiles([doc.file_path])
  fail((await supabase.from('meeting_documents').delete().eq('id', doc.id)).error)
}

/** Runs a document change, then refreshes the meeting's documents; failures toast the reason, or `failMessage`. */
export function useDocumentCall(meetingId: string, failMessage: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (call: () => Promise<void>) => call(),
    onError: (e) => {
      const reason = meetingError(e)
      notifyError(reason === he.meetings.errors.generic ? failMessage : reason)
    },
    onSettled: () => client.invalidateQueries({ queryKey: [...KEY, 'documents', meetingId] }),
  })
}
