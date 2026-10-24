import { Alert, Autocomplete, Button, Card, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core'
import { useEffect, useState } from 'react'
import { he } from '../../lib/he'
import { fromInputs, meetingTime, toInputs } from './fmt'
import { isTooEarly } from './lifecycle'
import type { QuorumState } from './quorum'
import type { Meeting } from './types'

const L = he.meetings.live
/** Mirrors open_meeting: an opening time at most 5 minutes ahead of the clock. */
const FUTURE_LEEWAY_MS = 5 * 60_000

/** No quorum: "דחיית האסיפה בשעה"; once postponed, says when it opens with whoever is present. */
export function Postponement({ meeting, q, busy, onPostpone }: { meeting: Meeting; q: QuorumState; busy: boolean; onPostpone: () => void }) {
  if (meeting.postponed_to) return <Alert color="enamel">{L.postponed(meetingTime(meeting.postponed_to))}</Alert>
  if (q.met) return null
  return (
    <Alert color="signal" title={L.noQuorumTitle}>
      <Stack gap="xs">
        <Text size="sm">{L.noQuorumBody}</Text>
        <Button color="signal" onClick={onPostpone} loading={busy} style={{ alignSelf: 'flex-start' }}>{L.postpone}</Button>
      </Stack>
    </Alert>
  )
}

/** The current time, refreshed every 15 seconds (drives the countdown). */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])
  return now
}

interface NoteProps { postponedTo: string | null; minutes: number; early: boolean; future: boolean }

/** After a postponement: the earliest opening time and a countdown; and why the chosen time can't be used. */
function TimeNotes({ postponedTo, minutes, early, future }: NoteProps) {
  return (
    <Stack gap={2}>
      {postponedTo && <Text size="sm" c="dimmed" className="bm-num">{L.earliest(meetingTime(postponedTo))}</Text>}
      {minutes > 0 && <Text size="sm" c="signal.9" className="bm-num" aria-live="polite">{L.opensIn(minutes)}</Text>}
      {early && postponedTo && <Text size="sm" c="debt.7" role="alert" className="bm-num">{L.tooEarly(meetingTime(postponedTo))}</Text>}
      {future && <Text size="sm" c="debt.7" role="alert">{L.future}</Text>}
    </Stack>
  )
}

export interface OpeningValues { openedAt: string; chair: string; secretary: string }

interface OpeningProps { meeting: Meeting; q: QuorumState; names: string[]; busy: boolean; onOpen: (v: OpeningValues) => void }

/**
 * Opening time (default now), chair and recorder from the attendees or typed. After a postponement the button stays
 * disabled until the postponed time has passed (open_meeting checks the real clock too).
 */
export function Opening({ meeting, q, names, busy, onOpen }: OpeningProps) {
  const now = useNow()
  const [start] = useState(() => toInputs(new Date()))
  const [time, setTime] = useState(start.time)
  const [chair, setChair] = useState(meeting.chair_name)
  const [secretary, setSecretary] = useState(meeting.secretary_name)
  const [tried, setTried] = useState(false)
  const missing = !chair.trim() || !secretary.trim()
  const openedAt = fromInputs(start.date, time || start.time)
  const minutes = meeting.postponed_to ? Math.max(0, Math.ceil((new Date(meeting.postponed_to).getTime() - now.getTime()) / 60_000)) : 0
  const early = isTooEarly(meeting.postponed_to, openedAt)
  const future = new Date(openedAt).getTime() > now.getTime() + FUTURE_LEEWAY_MS
  const blocked = minutes > 0 || early || future
  const submit = () => {
    setTried(true)
    if (!missing && !blocked) onOpen({ openedAt, chair: chair.trim(), secretary: secretary.trim() })
  }
  return (
    <Card>
      <Stack gap="sm">
        <Title order={2} size="h4">{L.opening}</Title>
        <TextInput label={L.openingTime} type="time" dir="ltr" value={time} onChange={(e) => setTime(e.currentTarget.value)} maw={200} />
        <TimeNotes postponedTo={meeting.postponed_to} minutes={minutes} early={early} future={future} />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Autocomplete label={L.chair} placeholder={L.roleHint} data={names} value={chair} onChange={setChair} />
          <Autocomplete label={L.secretary} placeholder={L.roleHint} data={names} value={secretary} onChange={setSecretary} />
        </SimpleGrid>
        {tried && missing && <Text c="debt.7" size="sm">{L.roleRequired}</Text>}
        <Button size="md" onClick={submit} loading={busy} disabled={!q.valid || blocked}>{L.open}</Button>
      </Stack>
    </Card>
  )
}
