import { Button, Card, Group, Stack, Text } from '@mantine/core'
import { IconArrowRight, IconCash, IconGauge } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { todayISO } from '../../lib/dates'
import { formatILS, formatKwh, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { AptPlate, EmptyState, ListSkeleton, notifySuccess, PageHeader } from '../../ui'
import { LoadFailed } from '../finance/cards'
import { YearStepper } from '../finance/fields'
import { useApartmentInfo } from '../finance/hooks'
import { PaymentForm } from '../finance/PaymentForm'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { useChargers, useDeleteReading, useEvPayments, useEvReadings, type Charger, type Reading } from './api'
import { historyRows, money } from './evMath'
import { History } from './History'
import { ReadingForm } from './ReadingForm'

type Sheet = { kind: 'record' } | { kind: 'edit'; reading: Reading } | { kind: 'pay' } | null

function Summary({ charger, onPay }: { charger: Charger; onPay: () => void }) {
  const info = useApartmentInfo().get(charger.apartment_id)
  return (
    <Card>
      <Group wrap="nowrap" gap="md">
        <AptPlate number={charger.number} size="lg" />
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} truncate="end">{info?.names || he.finance.noResidents}</Text>
          <Text size="sm" c="dimmed" className="bm-num">{he.ev.initialValue(formatKwh(charger.initial_reading))}</Text>
        </Stack>
      </Group>
      <Button mt="md" fullWidth variant="light" leftSection={<IconCash size={20} stroke={1.75} />} onClick={onPay}>{he.ev.recordPayment}</Button>
    </Card>
  )
}

function YearHistory({ charger, onEdit, onDelete }: { charger: Charger; onEdit: (r: Reading) => void; onDelete: (r: Reading) => void }) {
  const readings = useEvReadings(charger.id)
  const payments = useEvPayments([charger.apartment_id])
  const [year, setYear] = useState(() => Number((readings.data?.[0]?.month ?? todayISO()).slice(0, 4)))
  const all = useMemo(() => historyRows(readings.data ?? [], payments.data ?? []), [readings.data, payments.data])
  const rows = all.filter((r) => r.month.startsWith(String(year)))
  const byId = (id: string) => readings.data?.find((r) => r.id === id)
  const sum = (f: (r: (typeof rows)[number]) => number) => money(rows.reduce((t, r) => t + f(r), 0))
  if (readings.isLoading || payments.isLoading) return <ListSkeleton rows={4} />
  if (readings.isError || payments.isError) return <LoadFailed onRetry={() => { void readings.refetch(); void payments.refetch() }} />
  return (
    <Card padding="sm">
      <YearStepper value={year} onChange={setYear} />
      {rows.length === 0 ? <EmptyState title={he.ev.noYearReadings} /> : (
        <Stack gap="xs" mt="xs">
          <History rows={rows} onEdit={(id) => { const r = byId(id); if (r) onEdit(r) }} onDelete={(id) => { const r = byId(id); if (r) onDelete(r) }} />
          <Text size="sm" fw={600} className="bm-num" px="md">
            {he.ev.yearTotals(formatKwh(sum((r) => r.kwh ?? 0)), formatILS(sum((r) => r.amount ?? 0)), formatILS(sum((r) => r.paid)))}
          </Text>
        </Stack>
      )}
      <Text size="xs" c="dimmed" px="md" mt="xs">{he.ev.paidHint}</Text>
    </Card>
  )
}

function Sheets({ charger, sheet, onClose }: { charger: Charger; sheet: Sheet; onClose: () => void }) {
  const title = sheet?.kind === 'pay' ? he.ev.recordPayment : sheet?.kind === 'edit' ? he.ev.editReading(monthLabel(sheet.reading.month)) : he.ev.recordReading
  return (
    <FormModal opened={!!sheet} title={title} onClose={onClose}>
      {sheet?.kind === 'record' && <ReadingForm charger={charger} onDone={onClose} />}
      {sheet?.kind === 'edit' && <ReadingForm charger={charger} edit={sheet.reading} onDone={onClose} />}
      {sheet?.kind === 'pay' && <PaymentForm apartmentId={charger.apartment_id} note={he.ev.chargeLabel} onDone={onClose} />}
    </FormModal>
  )
}

/** One charger (/ev/:id): its months in the sheet's columns, with edit, delete and an EV payment shortcut. */
export default function ChargerPage() {
  const { id } = useParams()
  const chargers = useChargers()
  const charger = chargers.data?.find((c) => c.id === id)
  const del = useDeleteReading()
  const [sheet, setSheet] = useState<Sheet>(null)
  const [removing, setRemoving] = useState<Reading | null>(null)
  const confirm = () => removing && del.mutate(removing.id, { onSuccess: () => { notifySuccess(he.ev.readingDeleted); setRemoving(null) } })
  return (
    <>
      <PageHeader title={he.ev.title} action={charger ? { label: he.ev.recordReading, icon: <IconGauge size={22} stroke={1.75} />, onClick: () => setSheet({ kind: 'record' }) } : undefined} />
      <Button variant="subtle" component={Link} to="/ev" mb="sm" px={0} leftSection={<IconArrowRight size={18} stroke={1.75} aria-hidden="true" />}>{he.ev.back}</Button>
      {chargers.isLoading && <ListSkeleton rows={3} />}
      {chargers.isError && <LoadFailed onRetry={() => void chargers.refetch()} />}
      {chargers.isSuccess && !charger && <EmptyState title={he.ev.notFound} />}
      {charger && (
        <Stack gap="md">
          <Summary charger={charger} onPay={() => setSheet({ kind: 'pay' })} />
          <YearHistory key={charger.id} charger={charger} onEdit={(reading) => setSheet({ kind: 'edit', reading })} onDelete={setRemoving} />
          <Sheets charger={charger} sheet={sheet} onClose={() => setSheet(null)} />
        </Stack>
      )}
      <ConfirmDialog opened={!!removing} title={he.ev.deleteReadingConfirm(removing ? monthLabel(removing.month) : '')} body={he.ev.deleteReadingBody}
        confirmLabel={he.ev.delete} loading={del.isPending} failed={del.isError} onClose={() => setRemoving(null)} onConfirm={confirm} />
    </>
  )
}
