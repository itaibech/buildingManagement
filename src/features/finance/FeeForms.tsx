import { Alert, Button, Input, SegmentedControl, Stack, Text } from '@mantine/core'
import { useState, type FormEvent } from 'react'
import { he } from '../../lib/he'
import { FEE_MODES, isFeeMode, notifySuccess, type FeeMode } from '../../ui'
import { useSetApartmentFee } from './api'
import { affectsPast, currentMonth } from './feeTimeline'
import { MonthField, MoneyInput } from './fields'
import { shiftMonth } from './ledger'

/** "שינוי זה ישפיע על חיובים של חודשים קודמים" when `month` is before the current one. */
export function PastWarning({ month }: { month: string }) {
  if (!affectsPast(month, currentMonth())) return null
  return <Alert color="signal">{he.fees.pastWarning}</Alert>
}

const saved = (changed: boolean): void => notifySuccess(changed ? he.fees.saved : he.fees.noChange)

/** A new timeline row for one apartment: from month (next month by default), mode, and the amount for custom. */
export function FeeChangeForm({ apartmentId, onDone }: { apartmentId: string; onDone: () => void }) {
  const save = useSetApartmentFee()
  const [month, setMonth] = useState(() => shiftMonth(currentMonth(), 1))
  const [mode, setMode] = useState<FeeMode>('custom')
  const [amount, setAmount] = useState<number | string>('')
  const [error, setError] = useState<string | null>(null)
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (mode === 'custom' && !(typeof amount === 'number' && amount >= 0)) { setError(he.finance.errors.nonNegative); return }
    save.mutate({ apartment_id: apartmentId, effective_from: month, mode, amount: mode === 'custom' && typeof amount === 'number' ? amount : null },
      { onSuccess: (changed) => { saved(changed); onDone() } })
  }
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <MonthField label={he.fees.fromMonth} value={month} onChange={setMonth} />
        <Input.Wrapper label={he.fees.mode}>
          <SegmentedControl fullWidth mt={4} value={mode} onChange={(v) => isFeeMode(v) && setMode(v)}
            data={FEE_MODES.map((m) => ({ value: m, label: he.fees.modeOptions[m] }))} />
        </Input.Wrapper>
        {mode === 'custom' && (
          <MoneyInput label={he.fees.amount} withAsterisk min={0} value={amount} error={error}
            onChange={(v) => { setAmount(v); setError(null) }} />
        )}
        <PastWarning month={month} />
        <Button type="submit" fullWidth loading={save.isPending}>{he.fees.save}</Button>
      </Stack>
    </form>
  )
}

/** Quick toggle: exempt from a month on (default this month), or back to the building fee. */
export function ExemptToggleForm({ apartmentId, exempt, onDone }: { apartmentId: string; exempt: boolean; onDone: () => void }) {
  const save = useSetApartmentFee()
  const [month, setMonth] = useState(currentMonth)
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    save.mutate({ apartment_id: apartmentId, effective_from: month, mode: exempt ? 'building' : 'exempt', amount: null },
      { onSuccess: (changed) => { saved(changed); onDone() } })
  }
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <Text>{exempt ? he.fees.unmarkHint : he.fees.markHint}</Text>
        <MonthField label={he.fees.fromMonth} value={month} onChange={setMonth} />
        <PastWarning month={month} />
        <Button type="submit" fullWidth loading={save.isPending}>{exempt ? he.fees.unmarkExempt : he.fees.markExempt}</Button>
      </Stack>
    </form>
  )
}
