import { Alert, Button, NumberInput, Select, Stack, TextInput } from '@mantine/core'
import { useForm, type UseFormReturnType } from '@mantine/form'
import type { ChangeEvent } from 'react'
import { he } from '../../lib/he'
import { DateInput, focusFirstError, notifySuccess } from '../../ui'
import { useSuppliers, type Supplier } from '../suppliers/api'
import { supplierFields, useSaveTask, type Task } from './api'
import { defaultRemindDays, frequencyMonths, nextDue, type Frequency } from './nextDue'

interface Values {
  title: string
  vendor: string
  supplier_id: string | null
  frequency: Frequency
  next_due: string
  last_done: string
  remind_days: number | string
}

const M = he.maintenance
const OPTIONS = (Object.keys(M.frequencies) as Frequency[]).map((value) => ({ value, label: M.frequencies[value] }))

const initial = (task?: Task): Values => ({
  title: task?.title ?? '', vendor: task?.vendor ?? '', supplier_id: task?.supplier_id ?? null, frequency: task?.frequency ?? 'yearly',
  next_due: task?.next_due ?? '', last_done: '', remind_days: task?.remind_days ?? defaultRemindDays(frequencyMonths(task?.frequency ?? 'yearly')),
})

/** Frequency select: a reminder still at the old frequency's default follows the new one (7 days for monthly). */
function FrequencySelect({ form }: { form: UseFormReturnType<Values> }) {
  const onChange = (v: string | null) => {
    if (!v) return
    const next = v as Frequency
    if (form.values.remind_days === defaultRemindDays(frequencyMonths(form.values.frequency))) {
      form.setFieldValue('remind_days', defaultRemindDays(frequencyMonths(next)))
    }
    form.setFieldValue('frequency', next)
  }
  return <Select label={M.frequency} data={OPTIONS} allowDeselect={false} value={form.values.frequency} onChange={onChange} />
}


/** The supplier from the suppliers list, or a free-text vendor when none is picked. */
function SupplierFields({ form, suppliers }: { form: UseFormReturnType<Values>; suppliers: Supplier[] }) {
  return (
    <>
      <Select label={M.supplier} description={M.supplierHint} clearable searchable
        data={suppliers.map((s) => ({ value: s.id, label: s.category ? `${s.name} (${s.category})` : s.name }))} {...form.getInputProps('supplier_id')} />
      {!form.values.supplier_id && <TextInput label={M.vendor} {...form.getInputProps('vendor')} />}
    </>
  )
}

/** "בוצע לאחרונה" (new tasks): fills the next due date from the frequency. */
function LastDone({ form }: { form: UseFormReturnType<Values> }) {
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.currentTarget.value
    form.setFieldValue('last_done', v)
    const due = v ? nextDue(v, form.values.frequency) : null
    if (due) form.setFieldValue('next_due', due)
  }
  return <DateInput label={M.lastDone} description={M.lastDoneHint} value={form.values.last_done} onChange={onChange} />
}

/** Admin form to create or edit a task (an inspection: supplier, frequency, reminder window). */
export function TaskForm({ task, onDone }: { task?: Task; onDone: () => void }) {
  const save = useSaveTask()
  const suppliersQuery = useSuppliers()
  const suppliers = suppliersQuery.data ?? []
  const form = useForm<Values>({
    initialValues: initial(task),
    validate: {
      title: (v) => (v.trim() ? null : M.errors.title),
      remind_days: (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 365 ? null : M.errors.remindDays),
    },
  })
  const submit = form.onSubmit((v) => {
    const values = { title: v.title.trim(), ...supplierFields(v, suppliersQuery.data), frequency: v.frequency,
      next_due: v.next_due || null, remind_days: Number(v.remind_days) }
    save.mutate(task ? { id: task.id, ...values } : { ...values, lastDone: v.last_done || null }, {
      onSuccess: () => { notifySuccess(task ? M.updated : M.created); onDone() },
    })
  }, focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <TextInput label={M.title} withAsterisk data-autofocus {...form.getInputProps('title')} />
        <SupplierFields form={form} suppliers={suppliers} />
        <FrequencySelect form={form} />
        {!task && <LastDone form={form} />}
        <DateInput label={M.nextDue} description={M.nextDueHint} {...form.getInputProps('next_due')} />
        <NumberInput label={M.remindDays} description={M.remindHint} min={0} max={365} allowDecimal={false} dir="ltr" {...form.getInputProps('remind_days')} />
        {save.isError && <Alert color="debt">{M.errors.save}</Alert>}
        <Button type="submit" fullWidth loading={save.isPending}>{task ? M.save : M.create}</Button>
      </Stack>
    </form>
  )
}
