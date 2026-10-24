import { Alert, Autocomplete, Button, Card, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core'
import { useEffect, useState } from 'react'
import { he } from '../../lib/he'
import { fromInputs, meetingTime, toInputs } from './fmt'
import { isTooEarly } from './lifecycle'
import type { QuorumState } from './quorum'
import type { Meeting } from './types'

const L = he.meetings.live

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

/** Minutes until the postponed time (0 once it has passed), refreshed every 15 seconds. */
function useMinutesUntil(iso: string | null): number {
  const left = () => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000)) : 0)
  const [minutes, setMinutes] = useState(left)
  useEffect(() => {
    if (!iso) return
    const t = setInterval(() => setMinutes(Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60_000))), 15_000)
    return () => clearInterval(t)
  }, [iso])
  return minutes
}

/** After a postponement: the earliest opening time, a countdown until then, and whether the chosen time is too early. */
function EarliestNote({ postponedTo, chosen }: { postponedTo: string; chosen: string }) {
  const minutes = useMinutesUntil(postponedTo)
  const early = isTooEarly(postponedTo, chosen)
  return (
    <Stack gap={2}>
      <Text size="sm" c="dimmed" className="bm-num">{L.earliest(meetingTime(postponedTo))}</Text>
      {minutes > 0 && <Text size="sm" c="signal.9" className="bm-num" aria-live="polite">{L.opensIn(minutes)}</Text>}
      {early && <Text size="sm" c="debt.7" role="alert" className="bm-num">{L.tooEarly(meetingTime(postponedTo))}</Text>}
    </Stack>
  )
}

export interface OpeningValues { openedAt: string; chair: string; secretary: string }

interface OpeningProps { meeting: Meeting; q: QuorumState; names: string[]; busy: boolean; onOpen: (v: OpeningValues) => void }

/** Opening time (default now, or the postponed time), chair and recorder from the attendees or typed. */
export function Opening({ meeting, q, names, busy, onOpen }: OpeningProps) {
  const [start] = useState(() => toInputs(meeting.postponed_to ?? new Date()))
  const [time, setTime] = useState(start.time)
  const [chair, setChair] = useState(meeting.chair_name)
  const [secretary, setSecretary] = useState(meeting.secretary_name)
  const [tried, setTried] = useState(false)
  const missing = !chair.trim() || !secretary.trim()
  const openedAt = fromInputs(start.date, time || start.time)
  const early = isTooEarly(meeting.postponed_to, openedAt)
  const submit = () => {
    setTried(true)
    if (!missing && !early) onOpen({ openedAt, chair: chair.trim(), secretary: secretary.trim() })
  }
  return (
    <Card>
      <Stack gap="sm">
        <Title order={2} size="h4">{L.opening}</Title>
        <TextInput label={L.openingTime} type="time" dir="ltr" value={time} onChange={(e) => setTime(e.currentTarget.value)} maw={200} />
        {meeting.postponed_to && <EarliestNote postponedTo={meeting.postponed_to} chosen={openedAt} />}
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Autocomplete label={L.chair} placeholder={L.roleHint} data={names} value={chair} onChange={setChair} />
          <Autocomplete label={L.secretary} placeholder={L.roleHint} data={names} value={secretary} onChange={setSecretary} />
        </SimpleGrid>
        {tried && missing && <Text c="debt.7" size="sm">{L.roleRequired}</Text>}
        <Button size="md" onClick={submit} loading={busy} disabled={!q.valid || early}>{L.open}</Button>
      </Stack>
    </Card>
  )
}
