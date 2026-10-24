import { Card, Divider, Group, Paper, Stack, Switch, Text, Title, Tooltip, UnstyledButton } from '@mantine/core'
import { IconLock } from '@tabler/icons-react'
import { Fragment, useState, type ReactNode } from 'react'
import { todayISO } from '../../lib/dates'
import { formatILS, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, Money, notifySuccess } from '../../ui'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { ApartmentFeesSection } from './ApartmentFees'
import { useCharges, useDeleteCharge, useFeeSchedule, type Charge } from './api'
import { UndoSpecialDialog } from './UndoConfirms'
import { LoadFailed } from './cards'
import { ChargeForm, FeeForm, LevyForm } from './ChargeForms'
import { DeleteButton, Row, YearStepper } from './fields'
import { useApartmentInfo } from './hooks'

type Sheet = 'choose' | 'levy' | 'charge' | null

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card padding={0}>
      <Title order={2} size="h4" px="md" pt="md" pb="xs">{title}</Title>
      {children}
    </Card>
  )
}

function FeeList() {
  const q = useFeeSchedule()
  return (
    <Section title={he.finance.feeSchedule}>
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

const Locked = () => (
  <Tooltip label={he.finance.evChargeLocked} events={{ hover: true, focus: true, touch: true }}>
    <Group w={44} h={44} justify="center" tabIndex={0} aria-label={he.finance.evChargeLocked} role="img">
      <IconLock size={18} stroke={1.75} color="var(--mantine-color-stone-6)" aria-hidden="true" />
    </Group>
  </Tooltip>
)

function ChargeList({ onDelete }: { onDelete: (c: Charge) => void }) {
  const [year, setYear] = useState(() => Number(todayISO().slice(0, 4)))
  const [showEv, setShowEv] = useState(false)
  const q = useCharges(year)
  const info = useApartmentInfo()
  const evCount = (q.data ?? []).filter((c) => c.ev_reading_id).length
  const rows = (q.data ?? []).filter((c) => showEv || !c.ev_reading_id)
  return (
    <Section title={he.finance.charges}>
      <YearStepper value={year} onChange={setYear} />
      {evCount > 0 && (
        <Switch px="md" py="xs" label={he.finance.showEvCharges(evCount)} checked={showEv} onChange={(e) => setShowEv(e.currentTarget.checked)}
          styles={{ body: { alignItems: 'center', minHeight: 44 } }} />
      )}
      {q.isLoading && <Stack p="md"><ListSkeleton rows={3} /></Stack>}
      {q.isError && <Stack p="md"><LoadFailed onRetry={() => void q.refetch()} /></Stack>}
      {q.data && rows.length === 0 && <EmptyState title={he.finance.noCharges} body={he.finance.noChargesBody} />}
      {rows.map((c) => (
        <Fragment key={c.id}>
          <Divider color="stone.1" />
          <Row plate={info.get(c.apartment_id)?.number} title={c.special_id ? he.finance.special.chip(c.label) : c.label || he.finance.kinds[c.kind]}
            meta={`${c.special_id ? he.finance.special.action : he.finance.kinds[c.kind]} · ${monthLabel(c.month)}`} end={<Money amount={c.amount} />}
            trailing={c.ev_reading_id ? <Locked /> : <DeleteButton label={he.finance.deleteCharge} onClick={() => onDelete(c)} />} />
        </Fragment>
      ))}
    </Section>
  )
}

function Choice({ title, body, onClick }: { title: string; body: string; onClick: () => void }) {
  return (
    <UnstyledButton onClick={onClick} w="100%">
      <Paper withBorder radius={12} p="md" className="bm-row">
        <Text fw={600}>{title}</Text>
        <Text size="sm" c="dimmed">{body}</Text>
      </Paper>
    </UnstyledButton>
  )
}

/** A special charge is removed with its linked payment and expense (undo_special_charge), never on its own. */
function RemoveDialog({ removing, onClose }: { removing: Charge | null; onClose: () => void }) {
  const del = useDeleteCharge()
  const specialId = removing?.special_id ?? null
  return (
    <>
      <UndoSpecialDialog specialId={specialId} amount={removing?.amount ?? 0} onClose={onClose} doneMessage={he.finance.chargeDeleted} />
      <ConfirmDialog opened={!!removing && !specialId} title={he.finance.deleteChargeConfirm(formatILS(removing?.amount ?? 0))}
        body={he.finance.deleteChargeBody} confirmLabel={he.finance.delete} loading={del.isPending} failed={del.isError} onClose={onClose}
        onConfirm={() => removing && del.mutate(removing.id, { onSuccess: () => { notifySuccess(he.finance.chargeDeleted); onClose() } })} />
    </>
  )
}

const SHEET_TITLE: Record<NonNullable<Sheet>, string> = { choose: he.finance.newChargeChooser, levy: he.finance.newLevy, charge: he.finance.newCharge }

/** Admin "חיובים": levies and one-off/opening charges. The page action ("חיוב חדש") asks which kind first. */
export function ChargesTab({ adding, onAddingClose }: { adding: boolean; onAddingClose: () => void }) {
  const [sheet, setSheet] = useState<Sheet>(null)
  const [removing, setRemoving] = useState<Charge | null>(null)
  const active: Sheet = sheet ?? (adding ? 'choose' : null)
  const close = () => { setSheet(null); onAddingClose() }
  return (
    <Stack gap="md">
      <ChargeList onDelete={setRemoving} />
      <FormModal opened={!!active} title={active ? SHEET_TITLE[active] : ''} onClose={close} compact={active === 'choose'}>
        {active === 'choose' && (
          <Stack gap="sm">
            <Choice title={he.finance.chooseLevy} body={he.finance.chooseLevyBody} onClick={() => setSheet('levy')} />
            <Choice title={he.finance.chooseCharge} body={he.finance.chooseChargeBody} onClick={() => setSheet('charge')} />
          </Stack>
        )}
        {active === 'levy' && <LevyForm onDone={close} />}
        {active === 'charge' && <ChargeForm onDone={close} />}
      </FormModal>
      <RemoveDialog removing={removing} onClose={() => setRemoving(null)} />
    </Stack>
  )
}

/** Admin "דמי ועד": each apartment's fee (its own timeline) and the building's fee. The page action changes it for all. */
export function FeesTab({ adding, onAddingClose }: { adding: boolean; onAddingClose: () => void }) {
  return (
    <Stack gap="md">
      <ApartmentFeesSection />
      <FeeList />
      <FormModal opened={adding} title={he.finance.setFee} onClose={onAddingClose}>
        {adding && <FeeForm onDone={onAddingClose} />}
      </FormModal>
    </Stack>
  )
}
