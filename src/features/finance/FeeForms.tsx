import { Alert, Button, Group, Input, SegmentedControl, Stack, Text } from '@mantine/core'
import { useState, type FormEvent } from 'react'
import { he } from '../../lib/he'
import { FEE_MODES, isFeeMode, notifyInfo, notifySuccess, type FeeMode } from '../../ui'
import { useSetApartmentFee } from './api'
import { affectsPast, currentMonth, restoreAfterExempt, restoreLabel, type TimelineRow } from './feeTimeline'
import { MonthField, MoneyInput } from './fields'
import { shiftMonth } from './ledger'

/** "שינוי זה ישפיע על חיובים של חודשים קודמים" when `month` is before the current one. */
export function PastWarning({ month }: { month: string }) {
  if (!affectsPast(month, currentMonth())) return null
  return <Alert color="signal">{he.fees.pastWarning}</Alert>
}

const saved = (changed: boolean): void => (changed ? notifySuccess(he.fees.saved) : notifyInfo(he.fees.noChange))

/** A new timeline row for one apartment: from month (next month by default), mode, and the amount for custom. */
export function FeeChangeForm({ apartmentId, onDone, onCancel }: { apartmentId: string; onDone: () => void; onCancel?: () => void }) {
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
        <Group grow>
          {onCancel && <Button variant="default" onClick={onCancel}>{he.tenants.cancel}</Button>}
          <Button type="submit" loading={save.isPending}>{he.fees.save}</Button>
        </Group>
      </Stack>
    </form>
  )
}

interface ExemptToggleProps { apartmentId: string; exempt: boolean; timeline: readonly TimelineRow[]; onDone: () => void }

/** Quick toggle: exempt from a month on (default this month), or end it, restoring what applied before it. */
export function ExemptToggleForm({ apartmentId, exempt, timeline, onDone }: ExemptToggleProps) {
  const save = useSetApartmentFee()
  const [month, setMonth] = useState(currentMonth)
  const restore = restoreAfterExempt(timeline, currentMonth())
  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const next = exempt ? restore : { mode: 'exempt' as const, amount: null }
    save.mutate({ apartment_id: apartmentId, effective_from: month, ...next }, { onSuccess: (changed) => { saved(changed); onDone() } })
  }
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <Text>{exempt ? he.fees.unmarkHint(restoreLabel(restore)) : he.fees.markHint}</Text>
        <MonthField label={he.fees.fromMonth} value={month} onChange={setMonth} />
        <PastWarning month={month} />
        <Button type="submit" fullWidth loading={save.isPending}>{exempt ? he.fees.unmarkExempt : he.fees.markExempt}</Button>
      </Stack>
    </form>
  )
}
