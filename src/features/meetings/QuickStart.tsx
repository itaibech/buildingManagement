import { Alert, Button, Input, SegmentedControl, SimpleGrid, Stack, Text, TextInput } from '@mantine/core'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { he } from '../../lib/he'
import { notifySuccess } from '../../ui'
import { FormModal } from '../tenants/dialogs'
import { meetingRpc, useMeetingCall, useSaveMeeting } from './api'
import { meetingDate } from './fmt'
import { defaultQuorum } from './formModel'
import { OverrideQuorum } from './LiveOpening'
import { MEETING_KINDS, type Meeting, type MeetingKind } from './types'

const Q = he.meetings.quick
const L = he.meetings.live

interface Values { kind: MeetingKind; title: string; chair: string; secretary: string; override: boolean }

/** Whether the quick start needs "פתיחה ללא מניין": no attendance exists yet, so any rule but 'none' isn't met. */
const needsOverride = (mode: Meeting['quorum_mode']): boolean => mode !== 'none'

function Fields({ v, set, meeting }: { v: Values; set: (p: Partial<Values>) => void; meeting?: Meeting }) {
  const mode = meeting?.quorum_mode ?? defaultQuorum(v.kind)
  const [today] = useState(() => meetingDate(new Date()))
  return (
    <>
      {!meeting && (
        <>
          <Input.Wrapper label={he.meetings.form.kind}>
            <SegmentedControl fullWidth size="md" mt={4} value={v.kind} onChange={(k) => set({ kind: k === 'general' ? 'general' : 'committee', override: false })}
              data={MEETING_KINDS.map((k) => ({ value: k, label: he.meetings.kinds[k] }))} />
          </Input.Wrapper>
          <TextInput label={he.meetings.form.title} placeholder={Q.defaultTitle(he.meetings.kinds[v.kind], today)}
            value={v.title} onChange={(e) => set({ title: e.currentTarget.value })} />
        </>
      )}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <TextInput label={L.chair} value={v.chair} onChange={(e) => set({ chair: e.currentTarget.value })} withAsterisk />
        <TextInput label={L.secretary} value={v.secretary} onChange={(e) => set({ secretary: e.currentTarget.value })} withAsterisk />
      </SimpleGrid>
      {(meeting?.kind ?? v.kind) === 'general' && <Alert color="signal">{Q.generalWarning}</Alert>}
      {needsOverride(mode) && <OverrideQuorum checked={v.override} onChange={(override) => set({ override })} />}
    </>
  )
}

/** Creates the draft (from the list) when needed, then quick_start_meeting; resolves to the meeting id. */
function useQuickStart(meeting: Meeting | undefined) {
  const save = useSaveMeeting()
  const call = useMeetingCall()
  const start = (v: Values, onDone: (id: string) => void) => call.mutate(async () => {
    const id = meeting?.id ?? await save.mutateAsync({ existing: [], input: {
      kind: v.kind, title: v.title.trim() || Q.defaultTitle(he.meetings.kinds[v.kind], meetingDate(new Date())),
      scheduled_at: new Date().toISOString(), location: '', quorum_mode: defaultQuorum(v.kind), quorum_value: null, quorum_note: '', agenda: [],
    } })
    await meetingRpc.quickStart(id, v.chair.trim(), v.secretary.trim(), v.override)
    onDone(id)
  })
  return { start, busy: call.isPending || save.isPending }
}

/** "פתיחת ישיבה מיידית": no invitation, opened now. From the list (type and subject asked) or from a draft. */
export function QuickStartDialog({ opened, meeting, onClose }: { opened: boolean; meeting?: Meeting; onClose: () => void }) {
  const navigate = useNavigate()
  const [v, setV] = useState<Values>({ kind: 'committee', title: '', chair: '', secretary: '', override: false })
  const { start, busy } = useQuickStart(meeting)
  const set = (p: Partial<Values>) => setV((cur) => ({ ...cur, ...p }))
  const mode = meeting?.quorum_mode ?? defaultQuorum(v.kind)
  const ready = v.chair.trim() !== '' && v.secretary.trim() !== '' && (!needsOverride(mode) || v.override)
  const go = () => start(v, (id) => { notifySuccess(Q.started); onClose(); navigate(`/meetings/${id}`) })
  return (
    <FormModal opened={opened} title={Q.title} onClose={onClose}>
      <Stack>
        <Text size="sm">{Q.body}</Text>
        <Fields v={v} set={set} meeting={meeting} />
        <Button size="md" onClick={go} loading={busy} disabled={!ready}>{Q.start}</Button>
      </Stack>
    </FormModal>
  )
}
