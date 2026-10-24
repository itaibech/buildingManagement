import { Button, SegmentedControl, Stack, Text, Title } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { useState } from 'react'
import { he } from '../../lib/he'
import { notifySuccess } from '../../ui'
import { useApartments, useResidents } from '../tenants/api'
import { addItem, meetingRpc, useMeetingCall } from './api'
import type { SaveStatus } from './autosave'
import { CloseMeeting } from './CloseMeeting'
import { decisionNumbers, sortAgenda } from './decisions'
import { meetingTime } from './fmt'
import { LiveAttendance, type ApartmentLine } from './LiveAttendance'
import { LiveItem } from './LiveItem'
import { Opening, Postponement, type OpeningValues } from './LiveOpening'
import { QuorumMeter } from './QuorumMeter'
import { quorumState } from './quorum'
import { ruleOf, type MeetingDetail } from './types'
import { useLiveMeeting } from './useLiveMeeting'

const L = he.meetings.live
const STATUS_TEXT: Partial<Record<SaveStatus, string>> = { saving: L.saving, saved: L.saved, offline: L.offline, error: L.saveFailed }

function useApartmentLines(): ApartmentLine[] {
  const apartments = useApartments()
  const residents = useResidents()
  return (apartments.data ?? []).map((a) => ({
    id: a.id, number: a.number, residents: (residents.data ?? []).filter((r) => r.apartment_id === a.id).map((r) => r.full_name),
  }))
}

function Agenda({ live, meetingId }: { live: ReturnType<typeof useLiveMeeting>; meetingId: string }) {
  const call = useMeetingCall()
  const items = sortAgenda(live.items)
  const numbers = decisionNumbers(items)
  const next = (items.at(-1)?.position ?? 0) + 1
  return (
    <Stack gap="sm">
      {items.map((i, n) => <LiveItem key={i.id} item={i} index={n + 1} number={numbers.get(i.id)} attending={live.attending} onChange={(p) => live.setItem(i.id, p)} />)}
      <Button variant="light" leftSection={<IconPlus size={18} stroke={1.75} />} loading={call.isPending} style={{ alignSelf: 'flex-start' }}
        onClick={() => call.mutate(() => addItem(meetingId, L.otherDefault, next))}>{L.addOther}</Button>
    </Stack>
  )
}

/** Mobile-first live screen: attendance with the quorum meter, postponement and opening; then the agenda and closing. */
export function LiveMeeting({ meeting }: { meeting: MeetingDetail }) {
  const lines = useApartmentLines()
  const live = useLiveMeeting(meeting)
  const call = useMeetingCall()
  const [view, setView] = useState<'attendance' | 'agenda'>(meeting.status === 'in_progress' ? 'agenda' : 'attendance')
  const q = quorumState(ruleOf(meeting), lines.length, Object.values(live.attendance), meeting.postponed_at !== null)
  const names = lines.flatMap((l) => [live.attendance[l.id]?.attendee_name, live.attendance[l.id]?.proxy_name]).filter((n): n is string => !!n?.trim())
  const run = (fn: () => Promise<void>, done: string) => call.mutate(async () => { await live.flush(); await fn() }, { onSuccess: () => notifySuccess(done) })
  const open = (v: OpeningValues) => run(() => meetingRpc.open(meeting.id, v.openedAt, v.chair, v.secretary), L.opened)
  const inProgress = meeting.status === 'in_progress'
  return (
    <Stack gap="md">
      <Title order={2} size="h3">{L.title}</Title>
      {STATUS_TEXT[live.status] && <Text size="sm" c={live.status === 'saved' ? 'dimmed' : 'signal.9'} aria-live="polite">{STATUS_TEXT[live.status]}</Text>}
      <QuorumMeter q={q} />
      {inProgress && meeting.opened_at && <Text size="sm" c="dimmed" className="bm-num">{L.openedAt(meetingTime(meeting.opened_at))}</Text>}
      {inProgress && (
        <SegmentedControl fullWidth size="md" value={view} onChange={(v) => setView(v === 'agenda' ? 'agenda' : 'attendance')}
          data={[{ value: 'agenda', label: L.agenda }, { value: 'attendance', label: L.attendance }]} />
      )}
      {!inProgress && <Postponement meeting={meeting} q={q} busy={call.isPending} onPostpone={() => run(() => meetingRpc.postpone(meeting.id), L.postponedToast)} />}
      {(view === 'attendance' || !inProgress) && (
        <LiveAttendance meetingId={meeting.id} apartments={lines} values={live.attendance} absent={live.absent} onChange={live.setApartment} />
      )}
      {!inProgress && <Opening meeting={meeting} q={q} names={names} busy={call.isPending} onOpen={open} />}
      {inProgress && view === 'agenda' && <Agenda live={live} meetingId={meeting.id} />}
      {inProgress && <CloseMeeting busy={call.isPending} onClose={(at) => run(() => meetingRpc.close(meeting.id, at), L.closed)} />}
    </Stack>
  )
}
