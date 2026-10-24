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

/** The current time: every second while counting down to `until`, every 15 seconds otherwise. */
function useNow(until: string | null): Date {
  const [now, setNow] = useState(() => new Date())
  const fast = until !== null && now.getTime() < new Date(until).getTime()
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), fast ? 1000 : 15_000)
    return () => clearInterval(t)
  }, [fast])
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

/** openedAt null = now, by the server's clock (the recorder didn't type a time). */
export interface OpeningValues { openedAt: string | null; chair: string; secretary: string }

interface OpeningProps { meeting: Meeting; q: QuorumState; names: string[]; busy: boolean; onOpen: (v: OpeningValues) => void }

/**
 * Opening time (live "now" until the recorder types one), chair and recorder from the attendees or typed. After a
 * postponement the button stays disabled until the postponed time has passed (open_meeting checks the real clock too).
 */
export function Opening({ meeting, q, names, busy, onOpen }: OpeningProps) {
  const now = useNow(meeting.postponed_to)
  const [day] = useState(() => toInputs(new Date()).date)
  const [typed, setTyped] = useState<string | null>(null)
  const [chair, setChair] = useState(meeting.chair_name)
  const [secretary, setSecretary] = useState(meeting.secretary_name)
  const [tried, setTried] = useState(false)
  const missing = !chair.trim() || !secretary.trim()
  const openedAt = typed ? fromInputs(day, typed) : null
  const left = meeting.postponed_to ? new Date(meeting.postponed_to).getTime() - now.getTime() : 0
  const minutes = Math.max(0, Math.ceil(left / 60_000))
  const early = openedAt !== null && isTooEarly(meeting.postponed_to, openedAt)
  const future = openedAt !== null && new Date(openedAt).getTime() > now.getTime() + FUTURE_LEEWAY_MS
  const blocked = left > 0 || early || future
  const submit = () => {
    setTried(true)
    if (!missing && !blocked) onOpen({ openedAt, chair: chair.trim(), secretary: secretary.trim() })
  }
  return (
    <Card>
      <Stack gap="sm">
        <Title order={2} size="h4">{L.opening}</Title>
        <TextInput label={L.openingTime} type="time" dir="ltr" value={typed ?? meetingTime(now)}
          onChange={(e) => setTyped(e.currentTarget.value || null)} maw={200} />
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
