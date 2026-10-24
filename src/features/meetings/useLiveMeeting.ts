import { useCallback, useMemo, useState } from 'react'
import { saveAttendance, saveItem, type AttendanceValue, type ItemPatch } from './api'
import { useAutosave } from './autosave'
import { voteError } from './votes'
import { ABSENT, attKey, attendanceFrom, itemKey, itemPatchFrom, itemPatchOf, mergeAttendance, mergeItems } from './liveDraft'
import { attendingCount } from './quorum'
import { votesOf, type AgendaItem, type MeetingDetail } from './types'

/**
 * The live meeting's editable state (attendance and agenda items), autosaved row by row with a device draft.
 * Votes over the attendee count stay local (shown as an error) until fixed, since the server would refuse them.
 */
export function useLiveMeeting(meeting: MeetingDetail) {
  const save = useCallback((key: string, value: Record<string, unknown>) =>
    key.startsWith('att:') ? saveAttendance(meeting.id, key.slice(4), attendanceFrom(value)) : saveItem(key.slice(5), itemPatchFrom(value)), [meeting.id])
  const { push, flush, status, restored } = useAutosave(`bm-meeting-draft:${meeting.id}`, save)
  const [attendance, setAttendance] = useState(() => mergeAttendance(meeting.attendance, restored))
  // Local edits by item id over the server's items (items added during the meeting appear as they are fetched).
  const [edited, setEdited] = useState<Record<string, AgendaItem>>(() =>
    Object.fromEntries(mergeItems(meeting.items, restored).filter((i) => restored[itemKey(i.id)]).map((i) => [i.id, i])))
  const items = useMemo(() => meeting.items.map((i) => edited[i.id] ?? i), [meeting.items, edited])
  const attending = useMemo(() => attendingCount(Object.values(attendance)), [attendance])

  const setApartment = (apartmentId: string, v: AttendanceValue) => {
    setAttendance((cur) => ({ ...cur, [apartmentId]: v }))
    push(attKey(apartmentId), { ...v })
  }
  const setItem = (id: string, patch: ItemPatch) => {
    const cur = items.find((i) => i.id === id)
    if (!cur) return
    const next = { ...cur, ...patch }
    setEdited((cur) => ({ ...cur, [id]: next }))
    const votes = votesOf(next)
    if (!votes || !voteError(votes, attending)) push(itemKey(id), { ...itemPatchOf(next) })
  }
  return { attendance, items, attending, setApartment, setItem, flush, status, absent: ABSENT }
}
