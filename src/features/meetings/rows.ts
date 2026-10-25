// Narrowing DB rows (text columns) to the app's meeting types. Pure.
import type { Database } from '../../lib/db.types'
import {
  ATTENDANCE_STATUSES, ITEM_STATUSES, MEETING_KINDS, MEETING_STATUSES, QUORUM_MODES,
  type Addendum, type AgendaItem, type Attendance, type Meeting, type MeetingDetail, type Signature,
} from './types'

type T = Database['public']['Tables']
export type MeetingRow = T['meetings']['Row']
type ItemRow = T['meeting_agenda_items']['Row']
type AttendanceRow = T['meeting_attendance']['Row']
type SignatureRow = T['meeting_signatures']['Row']
type AddendumRow = T['meeting_addenda']['Row']

const pick = <V extends string>(list: readonly V[], v: string, fallback: V): V => list.find((x) => x === v) ?? fallback

export const toMeeting = (r: MeetingRow): Meeting => ({
  id: r.id, kind: pick(MEETING_KINDS, r.kind, 'committee'), title: r.title, scheduled_at: r.scheduled_at, location: r.location,
  quorum_mode: pick(QUORUM_MODES, r.quorum_mode, 'majority'), quorum_value: r.quorum_value, quorum_note: r.quorum_note,
  status: pick(MEETING_STATUSES, r.status, 'draft'), invited_at: r.invited_at, postponed_at: r.postponed_at,
  postponed_to: r.postponed_to, opened_at: r.opened_at, chair_name: r.chair_name, secretary_name: r.secretary_name,
  closed_at: r.closed_at, published_at: r.published_at, quick_started: r.quick_started, opened_without_quorum: r.opened_without_quorum,
})

export const toItem = (r: ItemRow): AgendaItem => ({ ...r, item_status: pick(ITEM_STATUSES, r.item_status, 'open') })

export const toAttendance = (r: AttendanceRow): Attendance => ({
  id: r.id, meeting_id: r.meeting_id, apartment_id: r.apartment_id, apartment_number: r.apartment_number,
  status: pick(ATTENDANCE_STATUSES, r.status, 'absent'), attendee_name: r.attendee_name, proxy_name: r.proxy_name,
  proxy_file_path: r.proxy_file_path, arrived_at: r.arrived_at, left_at: r.left_at,
})

export const toSignature = (r: SignatureRow): Signature => ({
  id: r.id, role: pick(['chair', 'secretary', 'attendee'] as const, r.role, 'attendee'),
  method: r.method === 'scan' ? 'scan' : 'drawn', signer_name: r.signer_name, image_path: r.image_path, signed_at: r.signed_at,
})

export const toAddendum = (r: AddendumRow): Addendum => ({ id: r.id, body: r.body, created_at: r.created_at })

export interface DetailRow extends MeetingRow {
  meeting_agenda_items: ItemRow[]
  meeting_attendance: AttendanceRow[]
  meeting_signatures: SignatureRow[]
  meeting_addenda: AddendumRow[]
}

export const toDetail = (r: DetailRow): MeetingDetail => ({
  ...toMeeting(r),
  items: r.meeting_agenda_items.map(toItem),
  attendance: r.meeting_attendance.map(toAttendance),
  signatures: r.meeting_signatures.map(toSignature),
  addenda: [...r.meeting_addenda].sort((a, b) => a.created_at.localeCompare(b.created_at)).map(toAddendum),
})
