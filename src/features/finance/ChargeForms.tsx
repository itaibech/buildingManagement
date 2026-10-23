import { Button, MultiSelect, SegmentedControl, Select, Stack, Text, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { todayISO } from '../../lib/dates'
import { he } from '../../lib/he'
import { focusFirstError, notifySuccess } from '../../ui'
import { useSaveCharge, useSaveFee } from './api'
import { MonthField, MoneyInput } from './fields'
import { useApartmentOptions } from './hooks'
import { monthOf } from './ledger'

const thisMonth = (): string => monthOf(todayISO())
const positive = (v: number | string): string | null => (typeof v === 'number' && v > 0 ? null : he.finance.errors.positive)
const nonNegative = (v: number | string): string | null => (typeof v === 'number' && v >= 0 ? null : he.finance.errors.nonNegative)
const required = (v: string | null): string | null => (v && v.trim() ? null : he.finance.errors.required)

/** "שינוי לכל הדירות": the building fee from a month on (apartments in building mode). Saving the same month again replaces it. */
export function FeeForm({ onDone }: { onDone: () => void }) {
  const save = useSaveFee()
  const form = useForm<{ month: string; amount: number | string }>({ initialValues: { month: thisMonth(), amount: '' }, validate: { amount: nonNegative } })
  const submit = form.onSubmit((v) => {
    if (typeof v.amount !== 'number') return
    save.mutate({ effective_from: v.month, amount: v.amount }, { onSuccess: () => { notifySuccess(he.finance.feeSaved); onDone() } })
  }, focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <MonthField label={he.finance.effectiveFrom} value={form.values.month} onChange={(m) => form.setFieldValue('month', m)} />
        <MoneyInput label={he.finance.monthlyFee} withAsterisk min={0} data-autofocus {...form.getInputProps('amount')} />
        <Text size="sm" c="dimmed">{he.finance.feeHint}</Text>
        <Button type="submit" fullWidth loading={save.isPending}>{he.finance.save}</Button>
      </Stack>
    </form>
  )
}

interface LevyValues { month: string; amount: number | string; label: string; target: 'all' | 'some'; apartmentIds: string[] }

/** A levy for every apartment or for chosen ones: one charge row each. */
export function LevyForm({ onDone }: { onDone: () => void }) {
  const save = useSaveCharge()
  const options = useApartmentOptions()
  const form = useForm<LevyValues>({
    initialValues: { month: thisMonth(), amount: '', label: '', target: 'all', apartmentIds: [] },
    validate: { amount: positive, label: required, apartmentIds: (v, all) => (all.target === 'some' && v.length === 0 ? he.finance.errors.pickApartments : null) },
  })
  const submit = form.onSubmit((v) => {
    const ids = v.target === 'all' ? options.map((o) => o.value) : v.apartmentIds
    if (typeof v.amount !== 'number' || ids.length === 0) return
    save.mutate({ apartment_ids: ids, month: v.month, amount: v.amount, kind: 'levy', label: v.label.trim() }, {
      onSuccess: () => { notifySuccess(he.finance.chargeAdded); onDone() },
    })
  }, focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <TextInput label={he.finance.levyLabel} placeholder={he.finance.levyPlaceholder} withAsterisk data-autofocus {...form.getInputProps('label')} />
        <MoneyInput label={he.finance.amountPerApartment} withAsterisk min={0} {...form.getInputProps('amount')} />
        <MonthField label={he.finance.chargeMonth} value={form.values.month} onChange={(m) => form.setFieldValue('month', m)} />
        <SegmentedControl fullWidth data={[{ value: 'all', label: he.finance.allApartments(options.length) }, { value: 'some', label: he.finance.someApartments }]}
          value={form.values.target} onChange={(t) => form.setFieldValue('target', t === 'some' ? 'some' : 'all')} />
        {form.values.target === 'some' && (
          <MultiSelect label={he.finance.apartments} searchable data={options} {...form.getInputProps('apartmentIds')} />
        )}
        <Button type="submit" fullWidth loading={save.isPending} disabled={options.length === 0}>{he.finance.addCharge}</Button>
      </Stack>
    </form>
  )
}

interface ChargeValues { kind: 'extra' | 'opening'; apartmentId: string | null; month: string; amount: number | string; label: string }

/** A one-off charge for one apartment, or its opening balance (negative = credit carried over). */
export function ChargeForm({ onDone }: { onDone: () => void }) {
  const save = useSaveCharge()
  const options = useApartmentOptions()
  const form = useForm<ChargeValues>({
    initialValues: { kind: 'extra', apartmentId: null, month: thisMonth(), amount: '', label: '' },
    validate: { apartmentId: required, amount: (v, all) => (all.kind === 'opening' ? (typeof v === 'number' && v !== 0 ? null : he.finance.errors.nonZero) : positive(v)) },
  })
  const opening = form.values.kind === 'opening'
  const submit = form.onSubmit((v) => {
    if (!(v.apartmentId && typeof v.amount === 'number')) return
    save.mutate({ apartment_ids: [v.apartmentId], month: v.month, amount: v.amount, kind: v.kind, label: v.label.trim() || he.finance.kinds[v.kind] }, {
      onSuccess: () => { notifySuccess(he.finance.chargeAdded); onDone() },
    })
  }, focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <SegmentedControl fullWidth data={[{ value: 'extra', label: he.finance.kinds.extra }, { value: 'opening', label: he.finance.kinds.opening }]}
          value={form.values.kind} onChange={(k) => form.setFieldValue('kind', k === 'opening' ? 'opening' : 'extra')} />
        <Select label={he.finance.apartment} withAsterisk searchable data={options} {...form.getInputProps('apartmentId')} />
        <MoneyInput label={he.finance.amount} withAsterisk min={opening ? undefined : 0} allowNegative={opening}
          description={opening ? he.finance.openingHint : undefined} {...form.getInputProps('amount')} />
        <MonthField label={he.finance.chargeMonth} value={form.values.month} onChange={(m) => form.setFieldValue('month', m)} />
        <TextInput label={he.finance.chargeLabel} placeholder={opening ? he.finance.kinds.opening : he.finance.extraPlaceholder} {...form.getInputProps('label')} />
        <Button type="submit" fullWidth loading={save.isPending}>{he.finance.addCharge}</Button>
      </Stack>
    </form>
  )
}
