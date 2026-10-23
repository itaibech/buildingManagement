import { Button, Card, Divider, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { IconFileImport } from '@tabler/icons-react'
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { todayISO } from '../../lib/dates'
import { formatKwh, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { AptPlate, EmptyState, ListSkeleton, notifySuccess, StatusBadge } from '../../ui'
import { LoadFailed } from '../finance/cards'
import { DeleteButton, Row } from '../finance/fields'
import { useApartmentInfo } from '../finance/hooks'
import { monthOf } from '../finance/ledger'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { useChargers, useDeleteRate, useEvRates, useEvReadings, type Charger, type EvRate, type Reading } from './api'
import { ChargerForm, RateForm } from './ChargerForms'
import { EvExportButton } from './EvExport'
import { rateText } from './evMath'
import { ReadingForm } from './ReadingForm'

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Stack gap="sm">
      <Group justify="space-between" gap="xs">
        <Title order={2} size="h4">{title}</Title>
        {action}
      </Group>
      {children}
    </Stack>
  )
}

function ChargerCard({ charger, last, onRecord }: { charger: Charger; last: Reading | undefined; onRecord: () => void }) {
  const info = useApartmentInfo().get(charger.apartment_id)
  const recorded = last?.month === monthOf(todayISO())
  return (
    <Card>
      <Group wrap="nowrap" gap="sm" align="flex-start">
        <AptPlate number={charger.number} size="md" />
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <Text fw={600} truncate="end">{info?.names || he.finance.noResidents}</Text>
            <StatusBadge kind="reading" value={recorded ? 'recorded' : 'pending'} />
          </Group>
          <Text size="sm" c="dimmed" className="bm-num">
            {last ? he.ev.lastReading(formatKwh(last.reading), monthLabel(last.month)) : he.ev.noReadings}
          </Text>
        </Stack>
      </Group>
      <Group grow mt="sm" gap="sm">
        <Button variant="light" onClick={onRecord}>{he.ev.recordReading}</Button>
        <Button variant="default" component={Link} to={`/ev/${charger.id}`}>{he.ev.history}</Button>
      </Group>
    </Card>
  )
}

function ChargerList({ onRecord, onAdd }: { onRecord: (c: Charger) => void; onAdd: () => void }) {
  const chargers = useChargers()
  const readings = useEvReadings()
  const latest = useMemo(() => {
    const m = new Map<string, Reading>()
    for (const r of readings.data ?? []) if (!m.has(r.charger_id)) m.set(r.charger_id, r)
    return m
  }, [readings.data])
  const actions = (
    <Group gap="xs">
      <Button variant="light" component={Link} to="/ev/import" leftSection={<IconFileImport size={20} stroke={1.75} aria-hidden="true" />}>{he.ev.importAction}</Button>
      <EvExportButton />
    </Group>
  )
  return (
    <Section title={he.ev.chargers} action={actions}>
      {(chargers.isLoading || readings.isLoading) && <ListSkeleton rows={2} />}
      {(chargers.isError || readings.isError) && <LoadFailed onRetry={() => { void chargers.refetch(); void readings.refetch() }} />}
      {chargers.data?.length === 0 && <Card><EmptyState title={he.ev.noChargers} body={he.ev.noChargersBody} action={{ label: he.ev.addCharger, onClick: onAdd }} /></Card>}
      {chargers.data && readings.data && (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          {chargers.data.map((c) => <ChargerCard key={c.id} charger={c} last={latest.get(c.id)} onRecord={() => onRecord(c)} />)}
        </SimpleGrid>
      )}
    </Section>
  )
}

function RatesSection() {
  const rates = useEvRates()
  const del = useDeleteRate()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<EvRate | null>(null)
  const confirm = () => removing && del.mutate(removing.id, { onSuccess: () => { notifySuccess(he.ev.rateDeleted); setRemoving(null) } })
  const today = monthOf(todayISO())
  const current = rates.data?.find((r) => r.effective_from <= today)
  return (
    <Section title={he.ev.rates} action={<Button variant="light" onClick={() => setAdding(true)}>{he.ev.addRate}</Button>}>
      <Card padding={0}>
        {rates.isLoading && <Stack p="md"><ListSkeleton rows={2} /></Stack>}
        {rates.isError && <Stack p="md"><LoadFailed onRetry={() => void rates.refetch()} /></Stack>}
        {rates.data?.length === 0 && <EmptyState title={he.ev.noRates} body={he.ev.noRatesBody} />}
        {rates.data?.map((r, i) => (
          <Fragment key={r.id}>
            {i > 0 && <Divider color="stone.1" />}
            <Row title={rateText(r)} meta={r.id === current?.id ? he.ev.currentRate : undefined} end={null}
              trailing={<DeleteButton label={he.ev.deleteRate} onClick={() => setRemoving(r)} />} />
          </Fragment>
        ))}
      </Card>
      <FormModal opened={adding} title={he.ev.addRate} onClose={() => setAdding(false)}>
        {adding && <RateForm onDone={() => setAdding(false)} />}
      </FormModal>
      <ConfirmDialog opened={!!removing} title={he.ev.deleteRateConfirm(removing ? rateText(removing) : '')} body={he.ev.deleteRateBody}
        confirmLabel={he.ev.delete} loading={del.isPending} failed={del.isError} onClose={() => setRemoving(null)} onConfirm={confirm} />
    </Section>
  )
}

/** Admin EV charging: chargers with this month's status, the per-kWh rates, import and export. */
export function EvPanel({ adding, onAddingClose }: { adding: boolean; onAddingClose: () => void }) {
  const [recording, setRecording] = useState<Charger | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const closeAdd = () => { setAddOpen(false); onAddingClose() }
  return (
    <Stack gap="xl">
      <ChargerList onRecord={setRecording} onAdd={() => setAddOpen(true)} />
      <RatesSection />
      <FormModal opened={adding || addOpen} title={he.ev.addCharger} onClose={closeAdd}>
        {(adding || addOpen) && <ChargerForm onDone={closeAdd} />}
      </FormModal>
      <FormModal opened={!!recording} title={he.ev.recordReading} onClose={() => setRecording(null)}>
        {recording && <ReadingForm charger={recording} onDone={() => setRecording(null)} />}
      </FormModal>
    </Stack>
  )
}
