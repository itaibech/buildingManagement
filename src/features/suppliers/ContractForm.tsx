import { Alert, Button, Group, NumberInput, SegmentedControl, Stack, Switch, Text, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { he } from '../../lib/he'
import { DateInput, focusFirstError, notifySuccess } from '../../ui'
import { MoneyInput } from '../finance/fields'
import { defaultRemindDays } from '../maintenance/nextDue'
import { useSaveContract, type Contract } from './api'
import { periodMonths, type ContractPeriod } from './logic'

const C = he.suppliers.contract
const E = he.suppliers.errors

interface Values {
  title: string; starts_on: string; ends_on: string; amount: number | string; period: ContractPeriod
  remind_days: number | string; auto_renews: boolean; notes: string
}

const initial = (c?: Contract): Values => ({
  title: c?.title ?? '', starts_on: c?.starts_on ?? '', ends_on: c?.ends_on ?? '', amount: c?.amount ?? '', period: c?.period ?? 'yearly',
  remind_days: c?.remind_days ?? defaultRemindDays(periodMonths(c?.period ?? 'yearly')), auto_renews: c?.auto_renews ?? false, notes: c?.notes ?? '',
})

const validate = {
  title: (v: string) => (v.trim() ? null : E.title),
  ends_on: (v: string, values: Values) => (v && values.starts_on && v < values.starts_on ? E.dates : null),
  amount: (v: number | string) => (typeof v === 'number' && v < 0 ? E.amount : null),
  remind_days: (v: number | string) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 365 ? null : E.remindDays),
}

function toRow(v: Values) {
  return {
    title: v.title.trim(), starts_on: v.starts_on || null, ends_on: v.ends_on || null,
    amount: typeof v.amount === 'number' ? v.amount : null, period: v.period,
    remind_days: Number(v.remind_days), auto_renews: v.auto_renews, notes: v.notes.trim(),
  }
}

/** Admin: a contract's dates, amount per month or year, reminder window and auto-renewal. */
export function ContractForm({ supplierId, contract, onDone }: { supplierId: string; contract?: Contract; onDone: () => void }) {
  const save = useSaveContract()
  const form = useForm<Values>({ initialValues: initial(contract), validate })
  const submit = form.onSubmit((v) => {
    const row = { supplier_id: supplierId, ...toRow(v) }
    save.mutate(contract ? { id: contract.id, ...row } : row, {
      onSuccess: () => { notifySuccess(contract ? C.updated : C.created); onDone() },
    })
  }, focusFirstError)
  const periods = (['monthly', 'yearly'] as const).map((value) => ({ value, label: C.periods[value] }))
  // A reminder still at the old period's default follows the new one (7 days for monthly).
  const setPeriod = (p: ContractPeriod) => {
    if (form.values.remind_days === defaultRemindDays(periodMonths(form.values.period))) form.setFieldValue('remind_days', defaultRemindDays(periodMonths(p)))
    form.setFieldValue('period', p)
  }
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <TextInput label={C.title} placeholder={C.titlePlaceholder} withAsterisk data-autofocus maxLength={200} {...form.getInputProps('title')} />
        <Group grow align="flex-start">
          <DateInput label={C.startsOn} {...form.getInputProps('starts_on')} />
          <DateInput label={C.endsOn} description={C.endsOnHint} {...form.getInputProps('ends_on')} />
        </Group>
        <Group grow align="flex-end">
          <MoneyInput label={C.amount} min={0} {...form.getInputProps('amount')} />
          <Stack gap={4}>
            <Text size="sm" fw={500}>{C.period}</Text>
            <SegmentedControl data={periods} aria-label={C.period} value={form.values.period} onChange={(v) => setPeriod(v as ContractPeriod)} />
          </Stack>
        </Group>
        <NumberInput label={C.remindDays} min={0} max={365} allowDecimal={false} dir="ltr" {...form.getInputProps('remind_days')} />
        <Switch label={C.autoRenews} description={C.autoRenewsHint} {...form.getInputProps('auto_renews', { type: 'checkbox' })} />
        <Textarea label={C.notes} autosize minRows={2} maxRows={6} maxLength={2000} {...form.getInputProps('notes')} />
        {save.isError && <Alert color="debt">{E.save}</Alert>}
        <Button type="submit" fullWidth loading={save.isPending}>{C.save}</Button>
      </Stack>
    </form>
  )
}
