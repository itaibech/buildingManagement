import { Button, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { he } from '../../lib/he'
import { notifySuccess } from '../../ui'
import { todayISO } from '../../lib/dates'
import { formatDate } from '../../lib/format'
import { useMarkDone, type Task } from './api'
import { nextDue } from './nextDue'

/** "בוצע": done date (default today) and a note. The cost field arrives with the finance feature. */
export function DoneForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const markDone = useMarkDone()
  const form = useForm({
    initialValues: { doneOn: todayISO(), note: '' },
    validate: { doneOn: (v) => (v ? null : he.maintenance.errors.required) },
  })
  const preview = form.values.doneOn ? nextDue(form.values.doneOn, task.frequency) : null
  const submit = form.onSubmit((v) =>
    markDone.mutate({ task, doneOn: v.doneOn, note: v.note.trim() }, {
      onSuccess: () => {
        notifySuccess(he.maintenance.markedDone)
        onDone()
      },
    }),
  )
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <TextInput label={he.maintenance.doneOn} withAsterisk type="date" dir="ltr" data-autofocus {...form.getInputProps('doneOn')} />
        {preview && <Text size="sm" c="dimmed" className="bm-num">{he.maintenance.nextDuePreview(formatDate(preview))}</Text>}
        <Textarea label={he.maintenance.note} autosize minRows={2} maxRows={6} {...form.getInputProps('note')} />
        <Button type="submit" fullWidth loading={markDone.isPending}>{he.maintenance.markDone}</Button>
      </Stack>
    </form>
  )
}
