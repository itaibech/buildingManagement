import { ActionIcon, Button, Card, Divider, Group, Stack, Title } from '@mantine/core'
import { IconArrowBackUp } from '@tabler/icons-react'
import { Fragment, useState, type ReactNode } from 'react'
import { todayISO } from '../../lib/dates'
import { formatILS, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, Money, notifySuccess } from '../../ui'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { useCharges, useDeleteCharge, useDeleteOverride, useFeeSchedule, useOverrides, type Charge, type FeeOverride } from './api'
import { LoadFailed } from './cards'
import { ChargeForm, FeeForm, LevyForm, OverrideForm } from './ChargeForms'
import { DeleteButton, Row, YearStepper } from './fields'
import { useApartmentInfo } from './hooks'

type Sheet = 'fee' | 'override' | 'levy' | 'charge' | null
type Removing = { kind: 'override'; row: FeeOverride } | { kind: 'charge'; row: Charge } | null

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

function OverrideList({ onAdd, onRevert }: { onAdd: () => void; onRevert: (o: FeeOverride) => void }) {
  const q = useOverrides()
  const info = useApartmentInfo()
  const revert = (o: FeeOverride) => (
    <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={he.finance.revertOverride(info.get(o.apartment_id)?.number ?? 0)} onClick={() => onRevert(o)}>
      <IconArrowBackUp size={20} stroke={1.75} aria-hidden="true" />
    </ActionIcon>
  )
  return (
    <Section title={he.finance.overrides} action={<Button variant="light" onClick={onAdd}>{he.finance.addOverride}</Button>}>
      {q.isError && <Stack p="md"><LoadFailed onRetry={() => void q.refetch()} /></Stack>}
      {q.data?.length === 0 && <EmptyState title={he.finance.noOverrides} />}
      {q.data?.map((o) => (
        <Fragment key={o.id}>
          <Divider color="stone.1" />
          <Row plate={info.get(o.apartment_id)?.number} title={info.get(o.apartment_id)?.names || he.finance.noResidents}
            meta={he.finance.fromMonth(monthLabel(o.effective_from))} end={<Money amount={o.amount} tone="neutral" />} trailing={revert(o)} />
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

const SHEET_TITLE: Record<NonNullable<Sheet>, string> = { fee: he.finance.setFee, override: he.finance.addOverride, levy: he.finance.newLevy, charge: he.finance.newCharge }

function RemoveDialog({ removing, onClose }: { removing: Removing; onClose: () => void }) {
  const delOverride = useDeleteOverride()
  const delCharge = useDeleteCharge()
  const busy = removing?.kind === 'override' ? delOverride : delCharge
  const done = (msg: string) => ({ onSuccess: () => { notifySuccess(msg); onClose() } })
  const confirm = () => {
    if (removing?.kind === 'override') delOverride.mutate(removing.row.id, done(he.finance.overrideReverted))
    else if (removing) delCharge.mutate(removing.row.id, done(he.finance.chargeDeleted))
  }
  const isOverride = removing?.kind === 'override'
  return (
    <ConfirmDialog opened={!!removing} title={isOverride ? he.finance.revertConfirm : he.finance.deleteChargeConfirm(formatILS(removing?.row.amount ?? 0))}
      body={isOverride ? he.finance.revertBody : he.finance.deleteChargeBody} confirmLabel={isOverride ? he.finance.revert : he.finance.delete}
      loading={busy.isPending} failed={busy.isError} onClose={onClose} onConfirm={confirm} />
  )
}

/** Admin "חיובים": fee schedule, per-apartment fees, levies and one-off/opening charges. The page FAB adds a levy. */
export function ChargesTab({ levying, onLevyingClose }: { levying: boolean; onLevyingClose: () => void }) {
  const [sheet, setSheet] = useState<Sheet>(null)
  const [removing, setRemoving] = useState<Removing>(null)
  const active: Sheet = levying ? 'levy' : sheet
  const close = () => { setSheet(null); onLevyingClose() }
  return (
    <Stack gap="md">
      <ChargeList onLevy={() => setSheet('levy')} onCharge={() => setSheet('charge')} onDelete={(row) => setRemoving({ kind: 'charge', row })} />
      <FeeList onAdd={() => setSheet('fee')} />
      <OverrideList onAdd={() => setSheet('override')} onRevert={(row) => setRemoving({ kind: 'override', row })} />
      <FormModal opened={!!active} title={active ? SHEET_TITLE[active] : ''} onClose={close}>
        {active === 'fee' && <FeeForm onDone={close} />}
        {active === 'override' && <OverrideForm onDone={close} />}
        {active === 'levy' && <LevyForm onDone={close} />}
        {active === 'charge' && <ChargeForm onDone={close} />}
      </FormModal>
      <RemoveDialog removing={removing} onClose={() => setRemoving(null)} />
    </Stack>
  )
}
