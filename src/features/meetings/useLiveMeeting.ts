import { useCallback, useMemo, useState } from 'react'
import { saveAttendance, saveItem, type AttendanceValue, type ItemPatch } from './api'
import { useAutosave } from './autosave'
import { voteError } from './votes'
import { ABSENT, attKey, attendanceFrom, itemKey, itemPatchFrom, itemPatchOf, mergeAttendance, mergeItems } from './liveDraft'
import { attendingCount } from './quorum'
import { votesOf, type AgendaItem, type MeetingDetail } from './types'

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
  const items = useMemo(() => meeting.items.map((i) => edited[i.id] ?? i), [meeting.items, edited])
  const attending = useMemo(() => attendingCount(Object.values(attendance)), [attendance])

  const setApartment = (apartmentId: string, v: AttendanceValue) => {
    const next = { ...attendance, [apartmentId]: v }
    setAttendance(next)
    push(attKey(apartmentId), { ...v })
    // A held vote that now fits the attendee count goes to the server.
    const count = attendingCount(Object.values(next))
    for (const i of Object.values(edited)) {
      const votes = votesOf(i)
      if (votes && !voteError(votes, count)) push(itemKey(i.id), { ...itemPatchOf(i) })
    }
  }
  const setItem = (id: string, patch: ItemPatch) => {
    const cur = items.find((i) => i.id === id)
    if (!cur) return
    const next = { ...cur, ...patch }
    setEdited((cur) => ({ ...cur, [id]: next }))
    const votes = votesOf(next)
    // Always kept on the device; sent once the vote fits the attendee count (the server would refuse it).
    const save = votes && voteError(votes, attending) ? hold : push
    save(itemKey(id), { ...itemPatchOf(next) })
  }
  return { attendance, items, attending, setApartment, setItem, flush, status, absent: ABSENT }
}
