import { Alert, Button, Group, Paper, Stack, Text, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import type { ReactNode } from 'react'
import { todayISO } from '../../lib/dates'
import { formatILS, formatKwh, formatRate } from '../../lib/format'
import { he } from '../../lib/he'
import { ListSkeleton, Money, notifySuccess } from '../../ui'
import { MonthField } from '../finance/fields'
import { monthOf } from '../finance/ledger'
import { useEvReadings, useEvRates, useRecordReading, type Charger, type Reading } from './api'
import { KwhInput } from './ChargerForms'
import { readingPreview, type ReadingPreview } from './evMath'

interface Values { month: string; reading: number | string; readOn: string; note: string }

const initialValues = (edit?: Reading): Values => (edit
  ? { month: edit.month, reading: edit.reading, readOn: edit.read_on ?? '', note: edit.note }
  : { month: monthOf(todayISO()), reading: '', readOn: todayISO(), note: '' })

function errorText(p: ReadingPreview | null): string | null {
  if (!p?.error) return null
  if (p.error === 'lower') return he.ev.errors.lower(formatKwh(p.previous))
  if (p.error === 'next') return he.ev.errors.next(formatKwh(p.next ?? 0))
  return he.ev.errors.noRate
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      <Text size="sm" c="dimmed">{label}</Text>
      <Text size="sm" fw={600} className="bm-num">{value}</Text>
    </Group>
  )
}

/** The live preview: previous reading, kWh used, the month's rate and what the apartment will be charged. */
function Preview({ p }: { p: ReadingPreview }) {
  return (
    <Paper withBorder radius={12} p="sm" aria-live="polite" data-testid="ev-preview">
      <Stack gap={6}>
        <Line label={he.ev.previous} value={he.ev.kwhValue(formatKwh(p.previous))} />
        <Line label={he.ev.kwh} value={p.error === 'lower' ? '—' : he.ev.kwhValue(formatKwh(p.kwh))} />
        <Line label={he.ev.rate} value={p.rate === null ? '—' : he.ev.perKwh(formatRate(p.rate))} />
        <Group justify="space-between" wrap="nowrap">
          <Text fw={600}>{he.ev.toPay}</Text>
          {p.error ? <Text fw={600}>—</Text> : <Money amount={p.amount} tone="neutral" size="lg" />}
        </Group>
      </Stack>
    </Paper>
  )
}

/** "רישום קריאה": month, meter reading, read-on date and note, with the charge previewed as the admin types. */
export function ReadingForm({ charger, edit, onDone }: { charger: Charger; edit?: Reading; onDone: () => void }) {
  const readings = useEvReadings(charger.id)
  const rates = useEvRates()
  const save = useRecordReading()
  const form = useForm<Values>({ initialValues: initialValues(edit) })
  const v = form.values
  // previous / next look strictly before / after the month, so an edited reading never compares with itself.
  const preview = readingPreview(readings.data ?? [], charger.initial_reading, rates.data ?? [], v.month, typeof v.reading === 'number' ? v.reading : null)
  const existing = edit?.month === v.month ? null : preview?.existing ?? null
  const ready = readings.isSuccess && rates.isSuccess && preview !== null && !preview.error
  const submit = form.onSubmit((x) => {
    if (!ready || typeof x.reading !== 'number') return
    save.mutate({ charger_id: charger.id, month: x.month, reading: x.reading, read_on: x.readOn || null, note: x.note.trim() }, {
      onSuccess: (r) => { notifySuccess(he.ev.saved(formatILS(r.amount))); onDone() },
    })
  })
  if (readings.isLoading || rates.isLoading) return <ListSkeleton rows={4} />
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <MonthField label={he.ev.month} value={v.month} onChange={(m) => form.setFieldValue('month', m)} />
        <KwhInput label={he.ev.readingInput} withAsterisk data-autofocus {...form.getInputProps('reading')} error={errorText(preview)} />
        {existing !== null && <Alert color="signal">{he.ev.existing(formatKwh(existing))}</Alert>}
        {preview && <Preview p={preview} />}
        <TextInput label={he.ev.readOn} type="date" dir="ltr" {...form.getInputProps('readOn')} />
        <TextInput label={he.ev.note} maxLength={500} {...form.getInputProps('note')} />
        <Button type="submit" fullWidth loading={save.isPending} disabled={!ready}>{he.ev.save}</Button>
      </Stack>
    </form>
  )
}
