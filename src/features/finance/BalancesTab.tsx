import { Card, Divider, Group, Stack, Text } from '@mantine/core'
import { Fragment, useState } from 'react'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, Money } from '../../ui'
import { balancesRows } from '../export/buildWorkbook'
import { FormModal } from '../tenants/dialogs'
import { useBalances, type ApartmentBalance } from './api'
import { ApartmentLedger } from './ApartmentLedger'
import { useRegisterExport } from './exportSlot'
import { LoadFailed } from './cards'
import { Row } from './fields'
import { PaymentForm } from './PaymentForm'

function Summary({ rows }: { rows: ApartmentBalance[] }) {
  const debtors = rows.filter((r) => r.balance > 0)
  const owed = debtors.reduce((t, r) => t + r.balance, 0)
  return (
    <Group gap="lg" px="md" pt="md" pb="xs" wrap="wrap">
      <Stack gap={0}>
        <Text size="sm" c="dimmed">{he.finance.totalOwed}</Text>
        <Money amount={owed} size="lg" />
      </Stack>
      <Stack gap={0}>
        <Text size="sm" c="dimmed">{he.finance.debtorsCount}</Text>
        <Text className="bm-display bm-num" fz="h2">{he.finance.ofApartments(debtors.length, rows.length)}</Text>
      </Stack>
    </Group>
  )
}

/** One apartment: plate, residents, balance (debt in red); tap opens its ledger. */
export function BalanceRow({ row, onOpen }: { row: ApartmentBalance; onOpen?: (id: string) => void }) {
  const meta = row.scheduled > 0 ? he.finance.scheduled(formatILS(row.scheduled)) : undefined
  return (
    <Row plate={row.number} title={row.names.join(', ') || he.finance.noResidents} meta={meta}
      end={<Money amount={row.balance} />} onClick={onOpen ? () => onOpen(row.apartmentId) : undefined}
      label={onOpen ? he.finance.openLedger(row.number) : undefined} />
  )
}

/** Admin "יתרות": every apartment, largest debt first. `paying` opens the payment form (the page FAB). */
export function BalancesTab({ paying, onPayingClose }: { paying: boolean; onPayingClose: () => void }) {
  const q = useBalances()
  const [openId, setOpenId] = useState<string | null>(null)
  const open = q.data?.find((r) => r.apartmentId === openId)
  useRegisterExport(he.export.files.balances, () => balancesRows(q.data ?? []), !!q.data)
  return (
    <Card padding={0}>
      {q.isLoading && <Stack p="md"><ListSkeleton rows={6} /></Stack>}
      {q.isError && <Stack p="md"><LoadFailed onRetry={q.refetch} /></Stack>}
      {q.data?.length === 0 && <EmptyState title={he.finance.noApartments} body={he.finance.noApartmentsBody} />}
      {q.data && q.data.length > 0 && <Summary rows={q.data} />}
      {q.data?.map((row) => (
        <Fragment key={row.apartmentId}>
          <Divider color="stone.1" />
          <BalanceRow row={row} onOpen={setOpenId} />
        </Fragment>
      ))}
      <FormModal opened={!!open} title={open ? he.apartment(open.number) : ''} onClose={() => setOpenId(null)}>
        {open && <ApartmentLedger key={open.apartmentId} apartment={open} />}
      </FormModal>
      <FormModal opened={paying} title={he.finance.recordPayment} onClose={onPayingClose}>
        {paying && <PaymentForm onDone={onPayingClose} />}
      </FormModal>
    </Card>
  )
}
