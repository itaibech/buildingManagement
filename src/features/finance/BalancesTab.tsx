import { Card, Divider, Group, SegmentedControl, Stack, Text } from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import { Fragment, useState } from 'react'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, Money } from '../../ui'
import { balancesRows } from '../export/buildWorkbook'
import { useChargers } from '../ev/api'
import { FormModal } from '../tenants/dialogs'
import { useBalances, type ApartmentBalance } from './api'
import { ApartmentLedger } from './ApartmentLedger'
import { useRegisterExport } from './exportSlot'
import { BalanceBadges, LoadFailed } from './cards'
import { BALANCE_SORTS, hasBadges, isBalanceSort, sortBalances, type BalanceSort } from './ledger'
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

const SORT_DATA = BALANCE_SORTS.map((value) => ({ value, label: he.finance.sorts[value] }))

/** The list order, remembered on this device: by apartment number (default) or by amount. */
function useBalanceSort(): [BalanceSort, (v: string) => void] {
  const [stored, setStored] = useLocalStorage<string>({ key: 'bm.finance.balances.sort', defaultValue: 'number' })
  return [isBalanceSort(stored) ? stored : 'number', (v) => isBalanceSort(v) && setStored(v)]
}

/** One apartment: plate, residents, balance (debt in red); tap opens its ledger. */
export function BalanceRow({ row, onOpen }: { row: ApartmentBalance; onOpen?: (id: string) => void }) {
  const meta = row.scheduled > 0 ? he.finance.scheduled(formatILS(row.scheduled)) : undefined
  return (
    <Row plate={row.number} title={row.names.join(', ') || he.finance.noResidents} meta={meta}
      badge={hasBadges(row) ? <BalanceBadges row={row} /> : undefined} end={<Money amount={row.balance} />} onClick={onOpen ? () => onOpen(row.apartmentId) : undefined}
      label={onOpen ? he.finance.openLedger(row.number) : undefined} />
  )
}

/** Admin "יתרות": every apartment, by number or by amount. `paying` opens the payment form (the page FAB). */
export function BalancesTab({ paying, onPayingClose }: { paying: boolean; onPayingClose: () => void }) {
  const q = useBalances()
  const [openId, setOpenId] = useState<string | null>(null)
  const open = q.data?.find((r) => r.apartmentId === openId)
  const chargers = useChargers()
  const [sort, setSort] = useBalanceSort()
  useRegisterExport(he.export.files.balances, () => balancesRows(q.data ?? [], (id) => (chargers.data ?? []).some((c) => c.apartment_id === id)), !!q.data && !!chargers.data)
  return (
    <Card padding={0}>
      {q.isLoading && <Stack p="md"><ListSkeleton rows={6} /></Stack>}
      {q.isError && <Stack p="md"><LoadFailed onRetry={q.refetch} /></Stack>}
      {q.data?.length === 0 && <EmptyState title={he.finance.noApartments} body={he.finance.noApartmentsBody} />}
      {q.data && q.data.length > 0 && <Summary rows={q.data} />}
      {q.data && q.data.length > 1 && (
        <SegmentedControl mx="md" mb="sm" data={SORT_DATA} value={sort} onChange={setSort} aria-label={he.finance.sortLabel} />
      )}
      {sortBalances(q.data ?? [], sort).map((row) => (
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
