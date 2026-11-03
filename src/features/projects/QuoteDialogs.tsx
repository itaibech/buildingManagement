import { Alert, Button, CloseButton, FileButton, Group, Select, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconPaperclip } from '@tabler/icons-react'
import { useState } from 'react'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { focusFirstError, notifyError, notifySuccess } from '../../ui'
import { MoneyInput } from '../finance/fields'
import { RECEIPT_ACCEPT, receiptError } from '../finance/ledger'
import { useMeetings } from '../meetings/api'
import { meetingDate } from '../meetings/fmt'
import { useChooseQuote, useSaveQuote } from './mutations'
import type { Project, Quote } from './types'

const Q = he.projects.quotes
const C = he.projects.choose
const ICON = { size: 18, stroke: 1.75 } as const

/** The quote file: keep the current one, drop it, or pick a new one (image, PDF or Word, 10 MB). */
function FileField({ current, file, onFile, onDrop }: { current: string | null; file: File | null; onFile: (f: File | null) => void; onDrop: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const pick = (f: File | null) => {
    const err = f ? receiptError(f) : null
    setError(err)
    if (!err) onFile(f)
  }
  const name = file?.name ?? current
  return (
    <Stack gap={4}>
      <Text size="sm" fw={600}>{Q.file}</Text>
      {name ? (
        <Group gap="xs" wrap="nowrap">
          <IconPaperclip {...ICON} aria-hidden="true" />
          <Text size="sm" truncate="end" style={{ flex: 1 }}>{file ? name : Q.keepFile(name)}</Text>
          <CloseButton size={44} aria-label={Q.removeFile} onClick={() => { onFile(null); onDrop() }} />
        </Group>
      ) : (
        <FileButton accept={RECEIPT_ACCEPT} onChange={pick}>
          {(props) => <Button variant="default" leftSection={<IconPaperclip {...ICON} />} style={{ alignSelf: 'flex-start' }} {...props}>{Q.attach}</Button>}
        </FileButton>
      )}
      <Text size="xs" c={error ? 'debt.7' : 'dimmed'}>{error ?? Q.fileHint}</Text>
    </Stack>
  )
}

interface QuoteValues { vendor: string; amount: number | string; notes: string }

/** Admin: add or edit a quote (vendor, amount, notes, file). */
export function QuoteForm({ projectId, quote, onDone }: { projectId: string; quote?: Quote; onDone: () => void }) {
  const save = useSaveQuote(Q.failed)
  const [file, setFile] = useState<File | null>(null)
  const [dropFile, setDropFile] = useState(false)
  const form = useForm<QuoteValues>({
    initialValues: { vendor: quote?.vendor ?? '', amount: quote?.amount ?? '', notes: quote?.notes ?? '' },
    validate: {
      vendor: (v) => (v.trim() ? null : he.projects.form.required),
      amount: (v) => (typeof v === 'number' && v >= 0 && v <= 100_000_000 ? null : he.projects.form.positive),
      notes: (v) => (v.length > 2000 ? he.projects.form.tooLong(2000) : null),
    },
  })
  const submit = form.onSubmit((v) => {
    if (typeof v.amount !== 'number') return
    const input = { vendor: v.vendor.trim(), amount: v.amount, notes: v.notes.trim() }
    save.mutate({ projectId, existing: quote, input, file, dropFile }, {
      onSuccess: ({ fileFailed }) => { if (fileFailed) notifyError(Q.fileFailed); else notifySuccess(Q.saved); onDone() },
    })
  }, focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <TextInput label={Q.vendor} withAsterisk data-autofocus maxLength={200} {...form.getInputProps('vendor')} />
        <MoneyInput label={Q.amount} withAsterisk min={0} {...form.getInputProps('amount')} />
        <Textarea label={Q.notes} placeholder={Q.notesPlaceholder} autosize minRows={2} maxRows={6} {...form.getInputProps('notes')} />
        <FileField current={dropFile ? null : quote?.file_name ?? null} file={file} onFile={setFile} onDrop={() => setDropFile(true)} />
        {save.isError && <Alert color="debt">{Q.failed}</Alert>}
        <Button type="submit" fullWidth loading={save.isPending}>{Q.save}</Button>
      </Stack>
    </form>
  )
}

const NO_MEETING = '__none'

/** Admin: choose this quote with the decision note and (optionally) the meeting; or undo the choice. */
export function ChooseForm({ project, quote, onDone }: { project: Project; quote: Quote; onDone: () => void }) {
  const choose = useChooseQuote(C.failed)
  const meetings = useMeetings()
  const [note, setNote] = useState(quote.is_chosen ? project.decision_note : '')
  const [meeting, setMeeting] = useState(quote.is_chosen ? project.decision_meeting_id ?? NO_MEETING : NO_MEETING)
  const data = [{ value: NO_MEETING, label: C.meetingHint },
    ...(meetings.data ?? []).map((m) => ({ value: m.id, label: he.projects.decision.meetingDate(m.title, meetingDate(m.scheduled_at)) }))]
  const run = (quoteId: string | null, message: string) => choose.mutate(
    { projectId: project.id, quoteId, note: note.trim(), meetingId: meeting === NO_MEETING ? null : meeting },
    { onSuccess: () => { notifySuccess(message); onDone() } })
  return (
    <Stack>
      <Text fw={600} className="bm-num">{C.summary(quote.vendor, formatILS(quote.amount))}</Text>
      <Textarea label={C.note} placeholder={C.notePlaceholder} autosize minRows={2} maxLength={1000} data-autofocus
        value={note} onChange={(e) => setNote(e.currentTarget.value)} />
      <Select label={C.meeting} data={data} value={meeting} allowDeselect={false} searchable onChange={(v) => setMeeting(v ?? NO_MEETING)} />
      {(project.status === 'planning' || project.status === 'quotes') && <Text size="sm" c="dimmed">{C.approves}</Text>}
      {choose.isError && <Alert color="debt">{C.failed}</Alert>}
      <Button fullWidth loading={choose.isPending} onClick={() => run(quote.id, C.done)}>{C.confirm}</Button>
      {quote.is_chosen && <Button variant="subtle" color="debt" onClick={() => run(null, Q.unchosen)}>{Q.unchoose}</Button>}
    </Stack>
  )
}
