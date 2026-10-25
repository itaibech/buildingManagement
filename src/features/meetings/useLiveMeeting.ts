import { useCallback, useMemo, useRef, useState } from 'react'
import { saveAttendance, saveItem, type AttendanceValue, type ItemPatch } from './api'
import { useAutosave } from './autosave'
import { voteError, voteLimit } from './votes'
import { ABSENT, attKey, attendanceFrom, heldIds, itemKey, itemPatchFrom, itemPatchOf, mergeAttendance, mergeItems, releasable } from './liveDraft'
import { attendingCount } from './quorum'
import { votesOf, type AgendaItem, type MeetingDetail } from './types'

const VOTE_KEYS = ['votes_for', 'votes_against', 'votes_abstain'] as const
/** The item after a patch; new counts are checked against the attendance now (the server stores it with the vote). */
const applyPatch = (cur: AgendaItem, patch: ItemPatch): AgendaItem =>
  ({ ...cur, ...patch, ...(VOTE_KEYS.some((k) => k in patch) ? { attendees_at_vote: null } : {}) })

/**
 * The live meeting's editable state (attendance and agenda items), autosaved row by row with a device draft.
 * Votes over the attendee count are kept in the device draft but not sent (the item shows a warning) until fixed.
 */
export function useLiveMeeting(meeting: MeetingDetail) {
  const save = useCallback((key: string, value: Record<string, unknown>) =>
    key.startsWith('att:') ? saveAttendance(meeting.id, key.slice(4), attendanceFrom(value)) : saveItem(key.slice(5), itemPatchFrom(value)), [meeting.id])
  const { push, hold, flush, status, restored } = useAutosave(`bm-meeting-draft:${meeting.id}`, save)
  const [attendance, setAttendance] = useState(() => mergeAttendance(meeting.attendance, restored))
  // Local edits by item id over the server's items (items added during the meeting appear as they are fetched).
  const [edited, setEdited] = useState<Record<string, AgendaItem>>(() =>
    Object.fromEntries(mergeItems(meeting.items, restored).filter((i) => restored[itemKey(i.id)]).map((i) => [i.id, i])))
  // Items whose votes are held on the device (over the attendee count), so a later attendance change can send them.
  const held = useRef<Set<string>>(heldIds(restored))
  const items = useMemo(() => meeting.items.map((i) => edited[i.id] ?? i), [meeting.items, edited])
  const attending = useMemo(() => attendingCount(Object.values(attendance)), [attendance])

  const setApartment = (apartmentId: string, v: AttendanceValue) => {
    const next = { ...attendance, [apartmentId]: v }
    setAttendance(next)
    push(attKey(apartmentId), { ...v })
    // A held vote that now fits the attendee count goes to the server.
    for (const i of releasable(held.current, items, attendingCount(Object.values(next)))) {
      held.current.delete(i.id)
      push(itemKey(i.id), { ...itemPatchOf(i) })
    }
  }
  const setItem = (id: string, patch: ItemPatch) => {
    const cur = items.find((i) => i.id === id)
    if (!cur) return
    const next = applyPatch(cur, patch)
    setEdited((cur) => ({ ...cur, [id]: next }))
    const votes = votesOf(next)
    // Always kept on the device; sent once the vote fits the attendee count (the server would refuse it).
    const over = !!votes && !!voteError(votes, voteLimit(next, attending))
    if (over) {
      held.current.add(id)
      hold(itemKey(id), { ...itemPatchOf(next) })
    } else {
      held.current.delete(id)
      push(itemKey(id), { ...itemPatchOf(next) })
    }
  }
  return { attendance, items, attending, setApartment, setItem, flush, status, absent: ABSENT }
}
