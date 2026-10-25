import { Alert, Autocomplete, Button, Group, Input, NumberInput, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core'
import { he } from '../../lib/he'
import { DateInput, focusFirstError, notifySuccess } from '../../ui'
import { useApartments } from '../tenants/api'
import { AgendaEditor } from './AgendaEditor'
import { useSaveMeeting } from './api'
import { meetingError } from './errors'
import { defaultQuorum, toInput, useMeetingForm, type MeetingFormApi } from './formModel'
import { requiredQuorum } from './quorum'
import { MEETING_KINDS, QUORUM_MODES, type MeetingDetail, type MeetingKind } from './types'

const F = he.meetings.form

function QuorumFields({ form, total }: { form: MeetingFormApi; total: number }) {
  const { quorum_mode: mode, quorum_value: value } = form.getValues()
  const rule = { mode, value: typeof value === 'number' ? value : null }
  return (
    <Input.Wrapper label={F.quorum}>
      <Stack gap="xs" mt={4}>
        {/* Four options don't fit a segmented control at 375px: a select. */}
        <Select aria-label={F.quorum} data={QUORUM_MODES.map((q) => ({ value: q, label: F.quorumModes[q] }))} allowDeselect={false}
          {...form.getInputProps('quorum_mode')} />
        {(mode === 'percent' || mode === 'fixed') && (
          <NumberInput label={mode === 'percent' ? F.quorumPercent : F.quorumFixed} min={1} max={mode === 'percent' ? 100 : 10000}
            allowDecimal={false} {...form.getInputProps('quorum_value')} />
        )}
        <Text size="sm" c="dimmed" className="bm-num">
          {mode === 'none' ? F.quorumNoneHint : mode === 'majority' ? F.quorumMajorityHint(requiredQuorum(rule, total), total) : F.quorumRequired(requiredQuorum(rule, total), total)}
        </Text>
        <TextInput label={F.quorumNote} placeholder={F.quorumNoteHint} {...form.getInputProps('quorum_note')} />
      </Stack>
    </Input.Wrapper>
  )
}

/** Admin: a meeting's type, subject, time, place, quorum rule and agenda (draft, or after the invitation). */
export function MeetingForm({ meeting, onDone }: { meeting?: MeetingDetail; onDone: (id: string) => void }) {
  const save = useSaveMeeting()
  const apartments = useApartments()
  const form = useMeetingForm(meeting)
  const submit = form.onSubmit((v) => save.mutate({ id: meeting?.id, existing: meeting?.items ?? [], input: toInput(v) }, {
    onSuccess: (id) => { notifySuccess(F.saved); onDone(id) },
  }), focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        {meeting?.status === 'invited' && <Alert color="enamel">{F.invitedHint}</Alert>}
        <Input.Wrapper label={F.kind}>
          <SegmentedControl fullWidth size="md" mt={4} data={MEETING_KINDS.map((k) => ({ value: k, label: he.meetings.kinds[k] }))} {...form.getInputProps('kind')}
            onChange={(v) => {
              const kind: MeetingKind = v === 'general' ? 'general' : 'committee'
              form.setFieldValue('kind', kind)
              // A new meeting follows the type's default rule until the admin picks one.
              if (!meeting && form.getValues().quorum_mode === defaultQuorum(kind === 'general' ? 'committee' : 'general')) form.setFieldValue('quorum_mode', defaultQuorum(kind))
            }} />
        </Input.Wrapper>
        <TextInput label={F.title} withAsterisk data-autofocus {...form.getInputProps('title')} />
        <Group grow align="flex-start">
          <DateInput label={F.date} withAsterisk {...form.getInputProps('date')} />
          <TextInput label={F.time} type="time" dir="ltr" withAsterisk {...form.getInputProps('time')} />
        </Group>
        <Autocomplete label={F.location} description={F.locationHint} data={[...F.locations]} {...form.getInputProps('location')} />
        <QuorumFields form={form} total={apartments.data?.length ?? 0} />
        <AgendaEditor form={form} />
        {save.isError && <Alert color="debt">{meetingError(save.error)}</Alert>}
        <Button type="submit" fullWidth loading={save.isPending}>{meeting ? F.saveChanges : F.saveDraft}</Button>
      </Stack>
    </form>
  )
}
