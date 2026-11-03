import { Alert, Button, Group, Input, SegmentedControl, Select, Stack, Switch, Textarea, TextInput } from '@mantine/core'
import { useForm, type UseFormReturnType } from '@mantine/form'
import { he } from '../../lib/he'
import { DateInput, focusFirstError, notifySuccess } from '../../ui'
import { useSaveEvent } from './api'
import { toInput, toValues, validateEvent, type EventValues } from './formModel'
import { CATEGORIES, RECURRENCES, VISIBILITIES, type CalendarEventRow } from './types'

const C = he.calendar
const F = C.form

function WhenFields({ form }: { form: UseFormReturnType<EventValues> }) {
  const v = form.getValues()
  return (
    <>
      <Switch label={F.allDay} size="md" {...form.getInputProps('all_day', { type: 'checkbox' })} />
      <Group grow align="flex-start">
        <DateInput label={F.startDate} withAsterisk {...form.getInputProps('date')} />
        {!v.all_day && <TextInput label={F.startTime} type="time" dir="ltr" withAsterisk {...form.getInputProps('time')} />}
      </Group>
      <Group grow align="flex-start">
        <DateInput label={F.endDate} description={F.endHint} {...form.getInputProps('end_date')} />
        {!v.all_day && <TextInput label={F.endTime} description={F.endHint} type="time" dir="ltr" {...form.getInputProps('end_time')} />}
      </Group>
    </>
  )
}

function RepeatFields({ form }: { form: UseFormReturnType<EventValues> }) {
  return (
    <>
      <Input.Wrapper label={F.recurrence}>
        <SegmentedControl fullWidth mt={4} data={RECURRENCES.map((r) => ({ value: r, label: C.recurrences[r] }))} {...form.getInputProps('recurrence')} />
      </Input.Wrapper>
      {form.getValues().recurrence !== 'none' && <DateInput label={F.until} description={F.untilHint} {...form.getInputProps('until')} />}
    </>
  )
}

/** Admin: create or edit an event (title, type, when, repeat, place, details, who sees it). */
export function EventForm({ row, onDone }: { row?: CalendarEventRow; onDone: () => void }) {
  const save = useSaveEvent()
  const form = useForm<EventValues>({ mode: 'controlled', initialValues: toValues(row), validate: validateEvent })
  const submit = form.onSubmit((v) => save.mutate({ id: row?.id, values: toInput(v) }, {
    onSuccess: () => { notifySuccess(C.saved); onDone() },
  }), focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <TextInput label={F.title} withAsterisk data-autofocus {...form.getInputProps('title')} />
        <Select label={F.category} allowDeselect={false} data={CATEGORIES.map((c) => ({ value: c, label: C.categories[c] }))} {...form.getInputProps('category')} />
        <WhenFields form={form} />
        <RepeatFields form={form} />
        <TextInput label={F.location} placeholder={F.locationHint} {...form.getInputProps('location')} />
        <Textarea label={F.description} autosize minRows={3} maxRows={10} {...form.getInputProps('description')} />
        <Input.Wrapper label={F.visibility}>
          <SegmentedControl fullWidth mt={4} data={VISIBILITIES.map((x) => ({ value: x, label: C.visibilities[x] }))} {...form.getInputProps('visibility')} />
        </Input.Wrapper>
        {save.isError && <Alert color="debt">{F.errors.save}</Alert>}
        <Button type="submit" fullWidth loading={save.isPending}>{row ? F.save : F.create}</Button>
      </Stack>
    </form>
  )
}
