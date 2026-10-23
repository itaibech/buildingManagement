import { Button, Select, Stack, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { todayISO } from '../../lib/dates'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { notifySuccess } from '../../ui'
import { PAYMENT_METHODS, useBalances, useSavePayment, type PaymentMethod } from './api'
import { MoneyInput } from './fields'
import { useApartmentOptions } from './hooks'

interface PaymentValues {
  apartmentId: string | null
  paidOn: string
  amount: number | string
  method: PaymentMethod
  note: string
}

const METHOD_DATA = PAYMENT_METHODS.map((m) => ({ value: m, label: he.finance.methods[m] }))
const isMethod = (v: string | null): v is PaymentMethod => PAYMENT_METHODS.some((m) => m === v)

/** "רישום תשלום": apartment, date (today), amount (defaults to what it owes), method and a note. */
export function PaymentForm({ apartmentId, note, onDone }: { apartmentId?: string; note?: string; onDone: () => void }) {
  const save = useSavePayment()
  const options = useApartmentOptions()
  const balances = useBalances()
  const owed = (id: string | null) => balances.data?.find((b) => b.apartmentId === id)?.balance ?? 0
  const form = useForm<PaymentValues>({
    initialValues: { apartmentId: apartmentId ?? null, paidOn: todayISO(), amount: '', method: 'transfer', note: note ?? '' },
    validate: {
      apartmentId: (v) => (v ? null : he.finance.errors.required),
      paidOn: (v) => (v ? null : he.finance.errors.required),
      amount: (v) => (typeof v === 'number' && v > 0 ? null : he.finance.errors.positive),
    },
  })
  const current = owed(form.values.apartmentId)
  const submit = form.onSubmit((v) => {
    if (!v.apartmentId || typeof v.amount !== 'number') return
    save.mutate({ apartment_id: v.apartmentId, paid_on: v.paidOn, amount: v.amount, method: v.method, note: v.note.trim() }, {
      onSuccess: () => { notifySuccess(he.finance.paymentRecorded); onDone() },
    })
  })
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <Select label={he.finance.apartment} withAsterisk searchable data={options} {...form.getInputProps('apartmentId')}
          description={form.values.apartmentId ? he.finance.currentBalance(formatILS(current)) : undefined} />
        <MoneyInput label={he.finance.amount} withAsterisk min={0} data-autofocus={apartmentId ? true : undefined} {...form.getInputProps('amount')} />
        {current > 0 && (
          <Button variant="subtle" size="sm" style={{ alignSelf: 'flex-start' }} onClick={() => form.setFieldValue('amount', current)}>
            {he.finance.payFull(formatILS(current))}
          </Button>
        )}
        <TextInput label={he.finance.paidOn} withAsterisk type="date" dir="ltr" {...form.getInputProps('paidOn')} />
        <Select label={he.finance.method} data={METHOD_DATA} allowDeselect={false} value={form.values.method}
          onChange={(v) => isMethod(v) && form.setFieldValue('method', v)} />
        <TextInput label={he.finance.note} {...form.getInputProps('note')} />
        <Button type="submit" fullWidth loading={save.isPending}>{he.finance.recordPayment}</Button>
      </Stack>
    </form>
  )
}
