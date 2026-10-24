// Meetings data access (the only place the feature touches supabase). RLS and the 0021 RPCs enforce every rule.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
    votes_abstain: null, decision: '', decision_number: null, item_status: 'open', added_during_meeting: false, created_at: '',
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
  agenda: { id?: string; title: string }[]
}

async function syncAgenda(meetingId: string, agenda: MeetingInput['agenda'], existing: readonly AgendaItem[]): Promise<void> {
  const keep = new Set(agenda.flatMap((a) => (a.id ? [a.id] : [])))
  const gone = existing.filter((i) => !keep.has(i.id)).map((i) => i.id)
  if (gone.length) fail((await supabase.from('meeting_agenda_items').delete().in('id', gone)).error)
  for (const [i, a] of agenda.entries()) {
    const row = { title: a.title.trim(), position: i + 1 }
    const old = existing.find((e) => e.id === a.id)
    if (old && old.title === row.title && old.position === row.position) continue
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

const rpcDone = ({ error }: { error: { message: string } | null }): void => fail(error)

export const meetingRpc = {
  invite: async (id: string, confirm: boolean) => rpcDone(await supabase.rpc('invite_meeting', { p_meeting: id, p_confirm_short_notice: confirm })),
  updateInvite: async (id: string) => rpcDone(await supabase.rpc('update_meeting_invitation', { p_meeting: id })),
  postpone: async (id: string) => rpcDone(await supabase.rpc('postpone_meeting', { p_meeting: id })),
  /** openedAt null: the server records now(). */
  open: async (id: string, openedAt: string | null, chair: string, secretary: string) =>
    rpcDone(await supabase.rpc('open_meeting', { p_meeting: id, p_chair: chair, p_secretary: secretary, ...(openedAt ? { p_opened_at: openedAt } : {}) })),
  close: async (id: string, closedAt: string) => rpcDone(await supabase.rpc('close_meeting', { p_meeting: id, p_closed_at: closedAt })),
  sign: async (id: string, role: SignatureRole, name: string, path: string, method: 'drawn' | 'scan') =>
    rpcDone(await supabase.rpc('sign_meeting', { p_meeting: id, p_role: role, p_signer_name: name, p_image_path: path, p_method: method })),
  publish: async (id: string) => rpcDone(await supabase.rpc('publish_meeting', { p_meeting: id })),
  addendum: async (id: string, body: string) => rpcDone(await supabase.rpc('add_addendum', { p_meeting: id, p_body: body })),
  remove: async (id: string) => rpcDone(await supabase.from('meetings').delete().eq('id', id)),
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
