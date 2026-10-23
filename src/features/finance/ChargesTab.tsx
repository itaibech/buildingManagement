import { Button, Card, Divider, Group, Stack, Text, Title } from '@mantine/core'
import { Fragment, useState, type ReactNode } from 'react'
import { todayISO } from '../../lib/dates'
import { formatILS, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, Money, notifySuccess } from '../../ui'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { ApartmentFeesSection } from './ApartmentFees'
import { useCharges, useDeleteCharge, useFeeSchedule, type Charge } from './api'
import { LoadFailed } from './cards'
import { ChargeForm, FeeForm, LevyForm } from './ChargeForms'
import { DeleteButton, Row, YearStepper } from './fields'
import { useApartmentInfo } from './hooks'

type Sheet = 'fee' | 'levy' | 'charge' | null

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card padding={0}>
      <Group justify="space-between" px="md" pt="md" pb="xs" gap="xs">
        <Title order={2} size="h4">{title}</Title>
        {action}
      </Group>
      {children}
    </Card>
  )
}

function FeeList({ onAdd }: { onAdd: () => void }) {
  const q = useFeeSchedule()
  return (
    <Section title={he.finance.feeSchedule} action={<Button variant="light" onClick={onAdd}>{he.finance.setFee}</Button>}>
      <Text size="sm" c="dimmed" px="md" pb="xs">{he.finance.feeHint}</Text>
      {q.isLoading && <Stack p="md"><ListSkeleton rows={2} /></Stack>}
      {q.isError && <Stack p="md"><LoadFailed onRetry={() => void q.refetch()} /></Stack>}
      {q.data?.length === 0 && <EmptyState title={he.finance.noFees} body={he.finance.noFeesBody} />}
      {q.data?.map((f, i) => (
        <Fragment key={f.id}>
          <Divider color="stone.1" />
          <Row title={he.finance.fromMonth(monthLabel(f.effective_from))} meta={i === 0 ? he.finance.currentFee : undefined}
            end={<Money amount={f.amount} tone="neutral" />} />
        </Fragment>
      ))}
    </Section>
  )
}

function ChargeList({ onLevy, onCharge, onDelete }: { onLevy: () => void; onCharge: () => void; onDelete: (c: Charge) => void }) {
  const [year, setYear] = useState(() => Number(todayISO().slice(0, 4)))
  const q = useCharges(year)
  const info = useApartmentInfo()
  const actions = <Group gap="xs"><Button variant="light" onClick={onLevy}>{he.finance.newLevy}</Button><Button variant="default" onClick={onCharge}>{he.finance.newCharge}</Button></Group>
  return (
    <Section title={he.finance.charges} action={actions}>
      <YearStepper value={year} onChange={setYear} />
      {q.isLoading && <Stack p="md"><ListSkeleton rows={3} /></Stack>}
      {q.isError && <Stack p="md"><LoadFailed onRetry={() => void q.refetch()} /></Stack>}
      {q.data?.length === 0 && <EmptyState title={he.finance.noCharges} body={he.finance.noChargesBody} />}
      {q.data?.map((c) => (
        <Fragment key={c.id}>
          <Divider color="stone.1" />
          <Row plate={info.get(c.apartment_id)?.number} title={c.label || he.finance.kinds[c.kind]}
            meta={[he.finance.kinds[c.kind], monthLabel(c.month), c.ev_reading_id ? he.finance.evChargeLocked : ''].filter(Boolean).join(' · ')} end={<Money amount={c.amount} />}
            trailing={c.ev_reading_id ? undefined : <DeleteButton label={he.finance.deleteCharge} onClick={() => onDelete(c)} />} />
        </Fragment>
      ))}
    </Section>
  )
}

const SHEET_TITLE: Record<NonNullable<Sheet>, string> = { fee: he.finance.setFee, levy: he.finance.newLevy, charge: he.finance.newCharge }

function RemoveDialog({ removing, onClose }: { removing: Charge | null; onClose: () => void }) {
  const del = useDeleteCharge()
  return (
    <ConfirmDialog opened={!!removing} title={he.finance.deleteChargeConfirm(formatILS(removing?.amount ?? 0))}
      body={he.finance.deleteChargeBody} confirmLabel={he.finance.delete} loading={del.isPending} failed={del.isError} onClose={onClose}
      onConfirm={() => removing && del.mutate(removing.id, { onSuccess: () => { notifySuccess(he.finance.chargeDeleted); onClose() } })} />
  )
}

/** Admin "חיובים": levies and one-off/opening charges, each apartment's fee, and the building fee. The page FAB adds a levy. */
export function ChargesTab({ levying, onLevyingClose }: { levying: boolean; onLevyingClose: () => void }) {
  const [sheet, setSheet] = useState<Sheet>(null)
  const [removing, setRemoving] = useState<Charge | null>(null)
  const active: Sheet = levying ? 'levy' : sheet
  const close = () => { setSheet(null); onLevyingClose() }
  return (
    <Stack gap="md">
      <ChargeList onLevy={() => setSheet('levy')} onCharge={() => setSheet('charge')} onDelete={setRemoving} />
      <ApartmentFeesSection />
      <FeeList onAdd={() => setSheet('fee')} />
      <FormModal opened={!!active} title={active ? SHEET_TITLE[active] : ''} onClose={close}>
        {active === 'fee' && <FeeForm onDone={close} />}
        {active === 'levy' && <LevyForm onDone={close} />}
        {active === 'charge' && <ChargeForm onDone={close} />}
      </FormModal>
      <RemoveDialog removing={removing} onClose={() => setRemoving(null)} />
    </Stack>
  )
}
