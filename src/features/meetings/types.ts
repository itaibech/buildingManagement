// Meeting shapes used by the app (narrowed from the DB rows in api.ts). Mirrors 0021_meetings.sql.

export const MEETING_STATUSES = ['draft', 'invited', 'in_progress', 'closed', 'published'] as const
export type MeetingStatus = (typeof MEETING_STATUSES)[number]
export const MEETING_KINDS = ['committee', 'general'] as const
export type MeetingKind = (typeof MEETING_KINDS)[number]
export const QUORUM_MODES = ['majority', 'percent', 'fixed'] as const
export type QuorumMode = (typeof QUORUM_MODES)[number]
export const ATTENDANCE_STATUSES = ['present', 'proxy', 'absent'] as const
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]
export const ITEM_STATUSES = ['open', 'removed', 'deferred'] as const
export type ItemStatus = (typeof ITEM_STATUSES)[number]
export type SignatureRole = 'chair' | 'secretary' | 'attendee'

export interface QuorumRule { mode: QuorumMode; value: number | null }
export interface Votes { for: number; against: number; abstain: number }

export interface Meeting {
  id: string
  kind: MeetingKind
  title: string
  scheduled_at: string
  location: string
  quorum_mode: QuorumMode
  quorum_value: number | null
  quorum_note: string
  status: MeetingStatus
  invited_at: string | null
  postponed_at: string | null
  postponed_to: string | null
  opened_at: string | null
  chair_name: string
  secretary_name: string
  closed_at: string | null
  published_at: string | null
}

export interface AgendaItem {
  id: string
  meeting_id: string
  position: number
  title: string
  discussion: string
  votes_for: number | null
  votes_against: number | null
  votes_abstain: number | null
  decision: string
  decision_number: number | null
  item_status: ItemStatus
  added_during_meeting: boolean
  created_at: string
}

export interface Attendance {
  id: string
  meeting_id: string
  apartment_id: string | null
  apartment_number: number
  status: AttendanceStatus
  attendee_name: string
  proxy_name: string
  proxy_file_path: string | null
}

export interface Signature {
  id: string
  role: SignatureRole
  method: 'drawn' | 'scan'
  signer_name: string
  image_path: string
  signed_at: string
}

export interface Addendum { id: string; body: string; created_at: string }

export interface MeetingDetail extends Meeting {
  items: AgendaItem[]
  attendance: Attendance[]
  signatures: Signature[]
  addenda: Addendum[]
}

/** Archive / list row: the meeting plus its decision texts (for search). */
export interface MeetingListItem extends Meeting { decisions: string[] }

export const ruleOf = (m: Pick<Meeting, 'quorum_mode' | 'quorum_value'>): QuorumRule => ({ mode: m.quorum_mode, value: m.quorum_value })
export const votesOf = (i: Pick<AgendaItem, 'votes_for' | 'votes_against' | 'votes_abstain'>): Votes | null =>
  i.votes_for === null ? null : { for: i.votes_for, against: i.votes_against ?? 0, abstain: i.votes_abstain ?? 0 }
