import { Button, Select, Stack, Text, Textarea } from '@mantine/core'
import { useForm, type UseFormReturnType } from '@mantine/form'
import { he } from '../../lib/he'
import { DateInput, focusFirstError, notifySuccess } from '../../ui'
import { todayISO } from '../../lib/dates'
import { formatDate } from '../../lib/format'
import { useExpenseCategories, useMarkDone, type Task } from './api'
import { nextDue } from './nextDue'
import { MoneyInput } from '../finance/fields'

interface DoneValues {
  doneOn: string
  note: string
  cost: number | string
  categoryId: string | null
}

const costOf = (v: DoneValues): number | null => (typeof v.cost === 'number' && v.cost > 0 ? v.cost : null)

/** Optional cost; when entered it's posted as a building expense in the chosen category. */
function CostFields({ form }: { form: UseFormReturnType<DoneValues> }) {
  const categories = useExpenseCategories()
  const data = (categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))
  return (
    <>
      <MoneyInput label={he.maintenance.cost} description={he.maintenance.costHint} min={0} {...form.getInputProps('cost')} />
      <Select label={he.maintenance.category} data={data} searchable withAsterisk={costOf(form.values) !== null}
        {...form.getInputProps('categoryId')} />
    </>
  )
}

/** "בוצע": done date (default today), a note, and an optional cost that becomes an expense. */
export function DoneForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const markDone = useMarkDone()
  const form = useForm<DoneValues>({
    initialValues: { doneOn: todayISO(), note: '', cost: '', categoryId: null },
    validate: {
      doneOn: (v) => (v ? null : he.maintenance.errors.required),
      cost: (v) => (typeof v === 'number' && v < 0 ? he.maintenance.errors.cost : null),
      categoryId: (v, values) => (costOf(values) !== null && !v ? he.maintenance.errors.category : null),
    },
  })
  const preview = form.values.doneOn ? nextDue(form.values.doneOn, task.frequency) : null
  const submit = form.onSubmit((v) => {
    const cost = costOf(v)
    markDone.mutate({ task, doneOn: v.doneOn, note: v.note.trim(), cost, categoryId: cost === null ? null : v.categoryId }, {
      onSuccess: () => {
        notifySuccess(he.maintenance.markedDone)
        onDone()
      },
    })
  }, focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <DateInput label={he.maintenance.doneOn} withAsterisk data-autofocus {...form.getInputProps('doneOn')} />
        {preview && <Text size="sm" c="dimmed" className="bm-num">{he.maintenance.nextDuePreview(formatDate(preview))}</Text>}
        <Textarea label={he.maintenance.note} autosize minRows={2} maxRows={6} {...form.getInputProps('note')} />
        <CostFields form={form} />
        <Button type="submit" fullWidth loading={markDone.isPending}>{he.maintenance.markDone}</Button>
      </Stack>
    </form>
  )
}
