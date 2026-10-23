import { Alert, Button, Select, Stack, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { he } from '../../lib/he'
import { notifySuccess } from '../../ui'
import { useSaveTask, type Task } from './api'
import type { Frequency } from './nextDue'

interface Values {
  title: string
  vendor: string
  frequency: Frequency
  next_due: string
}

const OPTIONS = (Object.keys(he.maintenance.frequencies) as Frequency[]).map((value) => ({ value, label: he.maintenance.frequencies[value] }))

/** Admin form to create or edit a task. */
export function TaskForm({ task, onDone }: { task?: Task; onDone: () => void }) {
  const save = useSaveTask()
  const form = useForm<Values>({
    initialValues: { title: task?.title ?? '', vendor: task?.vendor ?? '', frequency: task?.frequency ?? 'yearly', next_due: task?.next_due ?? '' },
    validate: { title: (v) => (v.trim() ? null : he.maintenance.errors.required) },
  })
  const submit = form.onSubmit((v) => {
    const values = { title: v.title.trim(), vendor: v.vendor.trim(), frequency: v.frequency, next_due: v.next_due || null }
    save.mutate(task ? { id: task.id, ...values } : values, {
      onSuccess: () => {
        notifySuccess(task ? he.maintenance.updated : he.maintenance.created)
        onDone()
      },
    })
  })
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <TextInput label={he.maintenance.title} withAsterisk data-autofocus {...form.getInputProps('title')} />
        <TextInput label={he.maintenance.vendor} {...form.getInputProps('vendor')} />
        <Select label={he.maintenance.frequency} data={OPTIONS} allowDeselect={false} {...form.getInputProps('frequency')} />
        <TextInput label={he.maintenance.nextDue} description={he.maintenance.nextDueHint} type="date" dir="ltr" {...form.getInputProps('next_due')} />
        {save.isError && <Alert color="debt">{he.maintenance.errors.save}</Alert>}
        <Button type="submit" fullWidth loading={save.isPending}>{task ? he.maintenance.save : he.maintenance.create}</Button>
      </Stack>
    </form>
  )
}
