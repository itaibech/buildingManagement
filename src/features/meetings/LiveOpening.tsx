import { Alert, Autocomplete, Button, Card, Group, Stack, Text, TextInput, Title } from '@mantine/core'
import { useState } from 'react'
import { he } from '../../lib/he'
import { fromInputs, meetingISODate, meetingTime, toInputs } from './fmt'
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

export interface OpeningValues { openedAt: string; chair: string; secretary: string }

interface OpeningProps { meeting: Meeting; q: QuorumState; names: string[]; busy: boolean; onOpen: (v: OpeningValues) => void }

/** Opening time (default now, or the postponed time), chair and recorder from the attendees or typed. */
export function Opening({ meeting, q, names, busy, onOpen }: OpeningProps) {
  const [time, setTime] = useState(() => toInputs(meeting.postponed_to ?? new Date()).time)
  const [chair, setChair] = useState(meeting.chair_name)
  const [secretary, setSecretary] = useState(meeting.secretary_name)
  const [tried, setTried] = useState(false)
  const missing = !chair.trim() || !secretary.trim()
  const submit = () => {
    setTried(true)
    if (!missing) onOpen({ openedAt: fromInputs(meetingISODate(new Date()), time), chair: chair.trim(), secretary: secretary.trim() })
  }
  return (
    <Card>
      <Stack gap="sm">
        <Title order={2} size="h4">{L.opening}</Title>
        <TextInput label={L.openingTime} type="time" dir="ltr" value={time} onChange={(e) => setTime(e.currentTarget.value)} maw={200} />
        <Group grow align="flex-start" wrap="wrap">
          <Autocomplete label={L.chair} placeholder={L.roleHint} data={names} value={chair} onChange={setChair} />
          <Autocomplete label={L.secretary} placeholder={L.roleHint} data={names} value={secretary} onChange={setSecretary} />
        </Group>
        {tried && missing && <Text c="debt.7" size="sm">{L.roleRequired}</Text>}
        <Button size="md" onClick={submit} loading={busy} disabled={!q.valid}>{L.open}</Button>
      </Stack>
    </Card>
  )
}
