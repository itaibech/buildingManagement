import { Button, Checkbox, Select, Stack, Switch, Text, TextInput } from '@mantine/core'
import { useForm, type UseFormReturnType } from '@mantine/form'
import { useEffect } from 'react'
import { todayISO } from '../../lib/dates'
import { he } from '../../lib/he'
import { focusFirstError, notifySuccess } from '../../ui'
import { useExpenseCategories } from '../maintenance/api'
import { SETTLE_METHODS, useAddSpecialCharge, type PaymentMethod } from './api'
import { MoneyInput, MonthField } from './fields'
import { monthOf } from './ledger'

interface SpecialValues {
  label: string
  amount: number | string
  month: string
  note: string
  paid: boolean
  method: PaymentMethod
  today: boolean
  expense: boolean
  categoryId: string | null
}

const S = he.finance.special
const METHOD_DATA = SETTLE_METHODS.map((m) => ({ value: m, label: he.finance.methods[m] }))
const isMethod = (v: string | null): v is PaymentMethod => SETTLE_METHODS.some((m) => m === v)
const MISC_CATEGORY = 'שונות'

/** "התשלום כבר התקבל": method and the date (the month's first day, or today). */
function PaidFields({ form }: { form: UseFormReturnType<SpecialValues> }) {
  return (
    <Stack gap="sm" ps="xl">
      <Text size="sm" c="dimmed">{S.paidHint}</Text>
      <Select label={he.finance.method} data={METHOD_DATA} allowDeselect={false} value={form.values.method}
        onChange={(v) => isMethod(v) && form.setFieldValue('method', v)} />
      <Switch label={he.finance.settle.datedToday} {...form.getInputProps('today', { type: 'checkbox' })}
        styles={{ body: { alignItems: 'center', minHeight: 44 } }} />
    </Stack>
  )
}

/** "לרשום גם כהוצאת בניין": the expense category, "שונות" unless chosen otherwise. */
function ExpenseFields({ form }: { form: UseFormReturnType<SpecialValues> }) {
  const categories = useExpenseCategories()
  const misc = categories.data?.find((c) => c.name === MISC_CATEGORY)?.id ?? categories.data?.[0]?.id ?? null
  const { categoryId } = form.values
  useEffect(() => {
    if (!categoryId && misc) form.setFieldValue('categoryId', misc)
  }, [categoryId, misc, form])
  return (
    <Stack gap="sm" ps="xl">
      <Text size="sm" c="dimmed">{S.expenseHint}</Text>
      <Select label={S.category} data={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} allowDeselect={false}
        searchable {...form.getInputProps('categoryId')} />
    </Stack>
  )
}

function useSpecialForm(apartmentId: string, onDone: () => void) {
  const add = useAddSpecialCharge()
  const form = useForm<SpecialValues>({
    initialValues: { label: '', amount: '', month: monthOf(todayISO()), note: '', paid: false, method: 'transfer', today: false, expense: false, categoryId: null },
    validate: {
      label: (v) => (v.trim() ? null : he.finance.errors.chargeLabel),
      amount: (v) => (typeof v === 'number' && v > 0 ? null : he.finance.errors.positive),
      month: (v) => (v <= monthOf(todayISO()) ? null : S.futureMonth),
      categoryId: (v, all) => (!all.expense || v ? null : he.finance.errors.category),
    },
  })
  const submit = form.onSubmit((v) => {
    if (typeof v.amount !== 'number') return
    add.mutate({ apartmentId, month: v.month, amount: v.amount, label: v.label.trim(), note: v.note.trim(), paid: v.paid, method: v.method,
      dateMode: v.today ? 'today' : 'debt_month', expense: v.expense, categoryId: v.categoryId },
    { onSuccess: () => { notifySuccess(S.added); onDone() } })
  }, focusFirstError)
  return { form, submit, pending: add.isPending }
}

/** "חיוב מיוחד": a one-off charge on the apartment, optionally already paid and/or also a building expense. */
export function SpecialChargeForm({ apartmentId, onDone }: { apartmentId: string; onDone: () => void }) {
  const { form, submit, pending } = useSpecialForm(apartmentId, onDone)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <TextInput label={S.label} placeholder={S.labelPlaceholder} withAsterisk data-autofocus {...form.getInputProps('label')} />
        <MoneyInput label={S.amount} withAsterisk min={0} {...form.getInputProps('amount')} />
        <MonthField label={S.month} value={form.values.month} onChange={(m) => form.setFieldValue('month', m)} error={form.errors.month} />
        <TextInput label={he.finance.note} {...form.getInputProps('note')} />
        <Checkbox label={S.paid} description={S.paidDescription} size="md" {...form.getInputProps('paid', { type: 'checkbox' })} />
        {form.values.paid && <PaidFields form={form} />}
        <Checkbox label={S.expense} size="md" {...form.getInputProps('expense', { type: 'checkbox' })} />
        {form.values.expense && <ExpenseFields form={form} />}
        <Button type="submit" fullWidth loading={pending}>{S.save}</Button>
      </Stack>
    </form>
  )
}
