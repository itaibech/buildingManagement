// Live-meeting state: the server rows merged with any draft left on the device, and the autosave keys. Pure.
import type { AttendanceValue, ItemPatch } from './api'
import type { Draft } from './autosave'
import { ATTENDANCE_STATUSES, ITEM_STATUSES, type AgendaItem, type Attendance } from './types'

export const attKey = (apartmentId: string): string => `att:${apartmentId}`
export const itemKey = (itemId: string): string => `item:${itemId}`

const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback)
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)

export const ABSENT: AttendanceValue = { status: 'absent', attendee_name: '', proxy_name: '', proxy_file_path: null }

/** A stored attendance draft, checked field by field (anything unexpected falls back to `base`). */
export function attendanceFrom(v: Record<string, unknown>, base: AttendanceValue = ABSENT): AttendanceValue {
  return {
    status: ATTENDANCE_STATUSES.find((s) => s === v.status) ?? base.status,
    attendee_name: str(v.attendee_name, base.attendee_name),
    proxy_name: str(v.proxy_name, base.proxy_name),
    proxy_file_path: typeof v.proxy_file_path === 'string' ? v.proxy_file_path : v.proxy_file_path === null ? null : base.proxy_file_path,
  }
}

/** The editable fields of an item from a stored draft. Votes are all three counts or none. */
export function itemPatchFrom(v: Record<string, unknown>): ItemPatch {
  const votes = [count(v.votes_for), count(v.votes_against), count(v.votes_abstain)]
  const hasVotes = votes.every((n) => n !== null)
  return {
    discussion: str(v.discussion, ''),
    decision: str(v.decision, ''),
    item_status: ITEM_STATUSES.find((s) => s === v.item_status) ?? 'open',
    votes_for: hasVotes ? votes[0] : null,
    votes_against: hasVotes ? votes[1] : null,
    votes_abstain: hasVotes ? votes[2] : null,
  }
}

export const itemPatchOf = (i: AgendaItem): ItemPatch => ({
  discussion: i.discussion, decision: i.decision, item_status: i.item_status,
  votes_for: i.votes_for, votes_against: i.votes_against, votes_abstain: i.votes_abstain,
})

/** Attendance by apartment id: the server's rows, then the device's drafts on top. */
export function mergeAttendance(rows: readonly Attendance[], draft: Draft): Record<string, AttendanceValue> {
  const out: Record<string, AttendanceValue> = {}
  for (const r of rows) {
    if (r.apartment_id) out[r.apartment_id] = { status: r.status, attendee_name: r.attendee_name, proxy_name: r.proxy_name, proxy_file_path: r.proxy_file_path }
  }
  for (const [k, v] of Object.entries(draft)) {
    if (k.startsWith('att:')) out[k.slice(4)] = attendanceFrom(v, out[k.slice(4)])
  }
  return out
}

/** Items with the device's drafts applied. */
export const mergeItems = (items: readonly AgendaItem[], draft: Draft): AgendaItem[] =>
  items.map((i) => (draft[itemKey(i.id)] ? { ...i, ...itemPatchFrom(draft[itemKey(i.id)] ?? {}) } : i))

/** Held items (votes over the attendee count, kept on the device) whose votes now fit: these may be sent. */
export function releasable(held: ReadonlySet<string>, items: readonly AgendaItem[], attending: number): AgendaItem[] {
  return items.filter((i) => {
    const v = held.has(i.id) && i.votes_for !== null ? { for: i.votes_for, against: i.votes_against ?? 0, abstain: i.votes_abstain ?? 0 } : null
    return v !== null && v.for + v.against + v.abstain <= attending
  })
}

/** Item ids a stored draft holds back (marked by the autosaver's hold). */
export const heldIds = (draft: Draft): Set<string> =>
  new Set(Object.entries(draft).filter(([k, v]) => k.startsWith('item:') && v.__held === true).map(([k]) => k.slice(5)))
