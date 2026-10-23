import { Button, NumberInput, Select, Stack, Text, type NumberInputProps } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useMemo } from 'react'
import { todayISO } from '../../lib/dates'
import { he } from '../../lib/he'
import { notifySuccess } from '../../ui'
import { MonthField } from '../finance/fields'
import { useApartmentOptions } from '../finance/hooks'
import { monthOf } from '../finance/ledger'
import { useAddCharger, useChargers, useSaveRate } from './api'

const nonNegative = (v: number | string): string | null => (typeof v === 'number' && v >= 0 ? null : he.ev.errors.nonNegative)
const positive = (v: number | string): string | null => (typeof v === 'number' && v > 0 ? null : he.ev.errors.positive)

/** kWh / meter input: LTR digits, 2 decimals, the decimal keypad on phones. */
export function KwhInput(props: NumberInputProps) {
  return <NumberInput decimalScale={2} thousandSeparator="," dir="ltr" inputMode="decimal" hideControls min={0} {...props} />
}

/** "הוספת עמדת טעינה": an apartment without a charger, and the meter's reading before the first billed month. */
export function ChargerForm({ onDone }: { onDone: () => void }) {
  const add = useAddCharger()
  const chargers = useChargers()
  const options = useApartmentOptions()
  const free = useMemo(() => {
    const taken = new Set((chargers.data ?? []).map((c) => c.apartment_id))
    return options.filter((o) => !taken.has(o.value))
  }, [chargers.data, options])
  const form = useForm<{ apartmentId: string | null; initial: number | string }>({
    initialValues: { apartmentId: null, initial: 0 },
    validate: { apartmentId: (v) => (v ? null : he.ev.errors.required), initial: nonNegative },
  })
  const submit = form.onSubmit((v) => {
    if (!v.apartmentId || typeof v.initial !== 'number') return
    add.mutate({ apartment_id: v.apartmentId, initial_reading: v.initial }, { onSuccess: () => { notifySuccess(he.ev.chargerAdded); onDone() } })
  })
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        {chargers.isSuccess && free.length === 0 && <Text c="dimmed">{he.ev.noFreeApartments}</Text>}
        <Select label={he.finance.apartment} withAsterisk searchable data={free} data-autofocus {...form.getInputProps('apartmentId')} />
        <KwhInput label={he.ev.initialReading} description={he.ev.initialHint} withAsterisk {...form.getInputProps('initial')} />
        <Button type="submit" fullWidth loading={add.isPending} disabled={!chargers.isSuccess || free.length === 0}>{he.ev.addCharger}</Button>
      </Stack>
    </form>
  )
}

/** "הוספת תעריף": the per-kWh rate from a month on (saving the same month again replaces it). */
export function RateForm({ onDone }: { onDone: () => void }) {
  const save = useSaveRate()
  const form = useForm<{ month: string; rate: number | string }>({ initialValues: { month: monthOf(todayISO()), rate: '' }, validate: { rate: positive } })
  const submit = form.onSubmit((v) => {
    if (typeof v.rate !== 'number') return
    save.mutate({ rate: v.rate, effective_from: v.month }, { onSuccess: (n) => { notifySuccess(he.ev.rateSaved(n)); onDone() } })
  })
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <NumberInput label={he.ev.rateInput} prefix="₪" decimalScale={4} dir="ltr" inputMode="decimal" hideControls min={0} withAsterisk data-autofocus
          {...form.getInputProps('rate')} />
        <MonthField label={he.ev.effectiveFrom} value={form.values.month} onChange={(m) => form.setFieldValue('month', m)} />
        <Text size="sm" c="dimmed">{he.ev.rateHint}</Text>
        <Button type="submit" fullWidth loading={save.isPending}>{he.ev.addRate}</Button>
      </Stack>
    </form>
  )
}
