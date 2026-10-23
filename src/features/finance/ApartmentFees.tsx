import { ActionIcon, Button, Card, Divider, Group, Menu, Stack, Table, Text, Title, UnstyledButton } from '@mantine/core'
import { IconDots, IconPencil, IconPlus, IconUserCheck, IconUserOff } from '@tabler/icons-react'
import { Fragment, useState } from 'react'
import { monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { AptPlate, EmptyState, ListSkeleton, Money, notifySuccess, StatusBadge } from '../../ui'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { useDeleteFeeRow } from './api'
import { LoadFailed } from './cards'
import { ExemptToggleForm, FeeChangeForm } from './FeeForms'
import { affectsPast, currentMonth, nextChangeLabel, rowEffect, shortMonth, type TimelineRow } from './feeTimeline'
import { DeleteButton, Row } from './fields'
import { useApartmentFees, useDesktop, type ApartmentFeeRow } from './hooks'

type Sheet = { kind: 'timeline' | 'exempt'; id: string } | null
const ICON = { size: 18, stroke: 1.75 } as const
const names = (r: ApartmentFeeRow): string => r.names.join(', ') || he.finance.noResidents
const FeeAmount = ({ r }: { r: ApartmentFeeRow }) => <Money amount={r.fee} tone="neutral" />

function RowMenu({ r, onSheet }: { r: ApartmentFeeRow; onSheet: (s: Sheet) => void }) {
  const exempt = r.feeMode === 'exempt'
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={he.fees.actions(r.number)}><IconDots size={20} stroke={1.75} aria-hidden="true" /></ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconPencil {...ICON} />} onClick={() => onSheet({ kind: 'timeline', id: r.apartmentId })}>{he.fees.change}</Menu.Item>
        <Menu.Item leftSection={exempt ? <IconUserCheck {...ICON} /> : <IconUserOff {...ICON} />} onClick={() => onSheet({ kind: 'exempt', id: r.apartmentId })}>
          {exempt ? he.fees.unmarkExempt : he.fees.markExempt}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

function FeeListRows({ rows, onSheet }: { rows: ApartmentFeeRow[]; onSheet: (s: Sheet) => void }) {
  return rows.map((r) => (
    <Fragment key={r.apartmentId}>
      <Divider color="stone.1" />
      <Row plate={r.number} title={names(r)} meta={r.next ? nextChangeLabel(r.next) : undefined}
        badge={<StatusBadge kind="fee" value={r.feeMode} />} end={<FeeAmount r={r} />}
        onClick={() => onSheet({ kind: 'timeline', id: r.apartmentId })} label={he.fees.open(r.number)} trailing={<RowMenu r={r} onSheet={onSheet} />} />
    </Fragment>
  ))
}

function FeeTable({ rows, onSheet }: { rows: ApartmentFeeRow[]; onSheet: (s: Sheet) => void }) {
  const H = he.fees.headers
  return (
    <Table className="bm-num" verticalSpacing="sm" highlightOnHover>
      <Table.Thead><Table.Tr><Table.Th>{H.apartment}</Table.Th><Table.Th>{H.residents}</Table.Th><Table.Th ta="end">{H.fee}</Table.Th><Table.Th>{H.source}</Table.Th><Table.Th>{H.next}</Table.Th><Table.Th /></Table.Tr></Table.Thead>
      <Table.Tbody>
        {rows.map((r) => (
          <Table.Tr key={r.apartmentId}>
            <Table.Td><UnstyledButton mih={44} onClick={() => onSheet({ kind: 'timeline', id: r.apartmentId })} aria-label={he.fees.open(r.number)}><AptPlate number={r.number} size="sm" /></UnstyledButton></Table.Td>
            <Table.Td>{names(r)}</Table.Td>
            <Table.Td ta="end"><FeeAmount r={r} /></Table.Td>
            <Table.Td><StatusBadge kind="fee" value={r.feeMode} /></Table.Td>
            <Table.Td>{r.next ? nextChangeLabel(r.next) : ''}</Table.Td>
            <Table.Td w={56}><RowMenu r={r} onSheet={onSheet} /></Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

function HistoryRow({ row, onDelete }: { row: TimelineRow; onDelete: () => void }) {
  return (
    <Row title={he.finance.fromMonth(monthLabel(row.effective_from))} badge={<StatusBadge kind="fee" value={row.mode} />}
      end={row.mode === 'custom' && row.amount !== null ? <Money amount={row.amount} tone="neutral" /> : <Text size="sm" c="dimmed">{rowEffect(row)}</Text>}
      trailing={<DeleteButton label={he.fees.deleteRow(shortMonth(row.effective_from))} onClick={onDelete} />} />
  )
}

function DeleteRowDialog({ row, onClose }: { row: TimelineRow | null; onClose: () => void }) {
  const del = useDeleteFeeRow()
  const month = row ? shortMonth(row.effective_from) : ''
  const past = row ? affectsPast(row.effective_from, currentMonth()) : false
  return (
    <ConfirmDialog opened={!!row} title={he.fees.deleteConfirm(month)} body={past ? `${he.fees.deleteBody} ${he.fees.pastWarning}.` : he.fees.deleteBody}
      confirmLabel={he.finance.delete} loading={del.isPending} failed={del.isError} onClose={onClose}
      onConfirm={() => row && del.mutate(row.id, { onSuccess: () => { notifySuccess(he.fees.deleted); onClose() } })} />
  )
}

/** The apartment's fee history, newest first, with "שינוי דמי ועד". */
export function FeeTimelineSheet({ r }: { r: ApartmentFeeRow }) {
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState<TimelineRow | null>(null)
  if (editing) return <FeeChangeForm apartmentId={r.apartmentId} onDone={() => setEditing(false)} />
  return (
    <Stack gap="md">
      <Group gap="md" wrap="nowrap">
        <AptPlate number={r.number} size="lg" />
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Text fw={600} truncate="end">{names(r)}</Text>
          <Group gap="xs"><FeeAmount r={r} /><StatusBadge kind="fee" value={r.feeMode} /></Group>
        </Stack>
      </Group>
      <Button fullWidth leftSection={<IconPlus size={20} stroke={1.75} />} onClick={() => setEditing(true)}>{he.fees.change}</Button>
      <Title order={3} size="h5">{he.fees.history}</Title>
      <Card padding={0}>
        {r.timeline.length === 0 && <Text c="dimmed" p="md">{he.fees.noHistory}</Text>}
        {r.timeline.map((t, i) => (
          <Fragment key={t.id}>{i > 0 && <Divider color="stone.1" />}<HistoryRow row={t} onDelete={() => setRemoving(t)} /></Fragment>
        ))}
      </Card>
      <DeleteRowDialog row={removing} onClose={() => setRemoving(null)} />
    </Stack>
  )
}

function sheetTitle(sheet: Sheet, r: ApartmentFeeRow | undefined): string {
  if (!sheet || !r) return ''
  if (sheet.kind === 'timeline') return he.fees.open(r.number)
  return r.feeMode === 'exempt' ? he.fees.unmarkExemptTitle(r.number) : he.fees.markExemptTitle(r.number)
}

/** Admin "דמי ועד לדירות": each apartment's current fee and its source; tap for the history. */
export function ApartmentFeesSection() {
  const q = useApartmentFees()
  const desktop = useDesktop()
  const [sheet, setSheet] = useState<Sheet>(null)
  const open = q.data?.find((r) => r.apartmentId === sheet?.id)
  const close = () => setSheet(null)
  return (
    <Card padding={0}>
      <Group px="md" pt="md" pb="xs"><Title order={2} size="h4">{he.fees.title}</Title></Group>
      {q.isLoading && <Stack p="md"><ListSkeleton rows={3} /></Stack>}
      {q.isError && <Stack p="md"><LoadFailed onRetry={q.refetch} /></Stack>}
      {q.data?.length === 0 && <EmptyState title={he.finance.noApartments} body={he.finance.noApartmentsBody} />}
      {q.data && q.data.length > 0 && (desktop ? <FeeTable rows={q.data} onSheet={setSheet} /> : <FeeListRows rows={q.data} onSheet={setSheet} />)}
      <FormModal opened={!!open} title={sheetTitle(sheet, open)} onClose={close}>
        {open && sheet?.kind === 'timeline' && <FeeTimelineSheet key={open.apartmentId} r={open} />}
        {open && sheet?.kind === 'exempt' && <ExemptToggleForm apartmentId={open.apartmentId} exempt={open.feeMode === 'exempt'} onDone={close} />}
      </FormModal>
    </Card>
  )
}
