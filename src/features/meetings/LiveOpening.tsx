import { Alert, Autocomplete, Button, Card, Checkbox, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core'
import { useEffect, useState } from 'react'
import { he } from '../../lib/he'
import { fromInputs, meetingTime, toInputs, waitText, whenText } from './fmt'
import { isTooEarly } from './lifecycle'
import type { QuorumState } from './quorum'
import type { Meeting } from './types'

const L = he.meetings.live
/** Mirrors open_meeting: an opening time at most 5 minutes ahead of the clock. */
const FUTURE_LEEWAY_MS = 5 * 60_000

interface PostponementProps { meeting: Meeting; q: QuorumState; busy: boolean; onPostpone: () => void; onCancel: () => void }

/** No quorum: "דחיית האסיפה בשעה"; once postponed, when it opens with whoever is present, and "ביטול הדחייה". */
export function Postponement({ meeting, q, busy, onPostpone, onCancel }: PostponementProps) {
  if (meeting.postponed_to) {
    return (
      <Alert color="enamel">
        <Stack gap="xs">
          <Text size="sm" className="bm-num">{L.postponed(whenText(meeting.postponed_to))}</Text>
          <Button variant="default" onClick={onCancel} loading={busy} style={{ alignSelf: 'flex-start' }}>{L.cancelPostpone}</Button>
        </Stack>
      </Alert>
    )
  }
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

interface NoteProps { postponedTo: string | null; left: number; early: boolean; future: boolean }

/** After a postponement: the earliest opening time and a countdown; and why the chosen time can't be used. */
function TimeNotes({ postponedTo, left, early, future }: NoteProps) {
  return (
    <Stack gap={2}>
      {postponedTo && <Text size="sm" c="dimmed" className="bm-num">{L.earliest(whenText(postponedTo))}</Text>}
      {left > 0 && <Text size="sm" c="signal.9" className="bm-num" aria-live="polite">{L.opensIn(waitText(left))}</Text>}
      {early && postponedTo && <Text size="sm" c="debt.7" role="alert" className="bm-num">{L.tooEarly(meetingTime(postponedTo))}</Text>}
      {future && <Text size="sm" c="debt.7" role="alert">{L.future}</Text>}
    </Stack>
  )
}

/**
 * Mirrors open_meeting. The override applies only without a quorum and before the postponed time (after it any
 * attendance is valid), so a box ticked before the quorum arrived is ignored. After a postponement without a quorum
 * (and without the override) the meeting waits for the postponed time.
 */
function openingRules(postponedTo: string | null, met: boolean, override: boolean, now: Date, openedAt: string | null) {
  const until = postponedTo ? new Date(postponedTo).getTime() - now.getTime() : 0
  const offerOverride = !met && !(postponedTo && until <= 0)
  const overriding = override && offerOverride
  const waits = !overriding && !met
  const left = waits && postponedTo ? Math.max(0, until) : 0
  const early = waits && openedAt !== null && isTooEarly(postponedTo, openedAt)
  return { offerOverride, overriding, waits, left, early }
}

/** openedAt null = now, by the server's clock (the recorder didn't type a time). override: "פתיחה ללא מניין". */
export interface OpeningValues { openedAt: string | null; chair: string; secretary: string; override: boolean }

/** "פתיחה ללא מניין": opening now without a legal quorum (also skips a postponement's wait), once confirmed. */
export function OverrideQuorum({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Alert color="signal" title={L.override}>
      <Stack gap="xs">
        <Text size="sm">{L.overrideBody}</Text>
        <Checkbox label={L.overrideConfirm} checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      </Stack>
    </Alert>
  )
}

interface OpeningProps { meeting: Meeting; q: QuorumState; names: string[]; busy: boolean; onOpen: (v: OpeningValues) => void }

/**
 * Opening time (live "now" until the recorder types one), chair and recorder from the attendees or typed. After a
 * postponement the button stays disabled until the postponed time has passed (open_meeting checks the real clock too).
 */
export function Opening({ meeting, q, names, busy, onOpen }: OpeningProps) {
  const now = useNow(meeting.postponed_to)
  // One person can attend for one apartment and hold a proxy for another; Autocomplete rejects duplicate options.
  const options = [...new Set(names.map((n) => n.trim()))]
  const [day] = useState(() => toInputs(new Date()).date)
  const [typed, setTyped] = useState<string | null>(null)
  const [chair, setChair] = useState(meeting.chair_name)
  const [secretary, setSecretary] = useState(meeting.secretary_name)
  const [tried, setTried] = useState(false)
  const [override, setOverride] = useState(false)
  const missing = !chair.trim() || !secretary.trim()
  const openedAt = typed ? fromInputs(day, typed) : null
  const { offerOverride, overriding, waits, left, early } = openingRules(meeting.postponed_to, q.met, override, now, openedAt)
  const future = openedAt !== null && new Date(openedAt).getTime() > now.getTime() + FUTURE_LEEWAY_MS
  const blocked = left > 0 || early || future || !(q.valid || overriding)
  const submit = () => {
    setTried(true)
    if (!missing && !blocked) onOpen({ openedAt, chair: chair.trim(), secretary: secretary.trim(), override: overriding })
  }
  return (
    <Card>
      <Stack gap="sm">
        <Title order={2} size="h4">{L.opening}</Title>
        <TextInput label={L.openingTime} type="time" dir="ltr" value={typed ?? meetingTime(now)}
          onChange={(e) => setTyped(e.currentTarget.value || null)} maw={200} />
        <TimeNotes postponedTo={waits ? meeting.postponed_to : null} left={left} early={early} future={future} />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Autocomplete label={L.chair} placeholder={L.roleHint} data={options} value={chair} onChange={setChair} />
          <Autocomplete label={L.secretary} placeholder={L.roleHint} data={options} value={secretary} onChange={setSecretary} />
        </SimpleGrid>
        {offerOverride && <OverrideQuorum checked={override} onChange={setOverride} />}
        {tried && missing && <Text c="debt.7" size="sm">{L.roleRequired}</Text>}
        <Button size="md" onClick={submit} loading={busy} disabled={blocked}>{L.open}</Button>
      </Stack>
    </Card>
  )
}
