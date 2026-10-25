import { Button, Card, Divider, Group, SegmentedControl, Stack, Text } from '@mantine/core'
import { IconMail } from '@tabler/icons-react'
import { useLocalStorage } from '@mantine/hooks'
import { Fragment, useState } from 'react'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, Money } from '../../ui'
import { balancesRows } from '../export/buildWorkbook'
import { useChargers } from '../ev/api'
import { DebtBulkForm } from '../email/DebtReminder'
import { ReminderButton } from '../email/ReminderButton'
import { reminderStamp, useEmailApartments, useLastReminders } from '../email/useReminders'
import type { LastReminder } from '../email/reminders'
import { FormModal } from '../tenants/dialogs'
import { useBalances, type ApartmentBalance } from './api'
import { ApartmentLedger } from './ApartmentLedger'
import { useRegisterExport } from './exportSlot'
import { BalanceBadges, LoadFailed } from './cards'
import { BALANCE_SORTS, hasBadges, isBalanceSort, sortBalances, type BalanceSort } from './ledger'
import { collectionCounts } from './collection'
import { Row } from './fields'
import { PaymentForm } from './PaymentForm'

/** Admin: "תזכורת לכל החייבים" opens the debtors list (all checked) to send personalised reminders. */
function RemindAll({ debtors }: { debtors: ApartmentBalance[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="default" leftSection={<IconMail size={20} stroke={1.75} aria-hidden="true" />} onClick={() => setOpen(true)}
        style={{ alignSelf: 'center' }}>
        {he.mail.debt.bulkAction}
      </Button>
      <FormModal opened={open} title={he.mail.debt.bulkTitle} onClose={() => setOpen(false)}>
        {open && <DebtBulkForm debtors={debtors} onDone={() => setOpen(false)} />}
      </FormModal>
    </>
  )
}

/** The month's collection (the same rule as the home hero: collectionCounts / collection_summary) and the total debt. */
function Summary({ rows }: { rows: ApartmentBalance[] }) {
  const debtors = rows.filter((r) => r.balance > 0)
  const c = collectionCounts(rows)
  return (
    <Group gap="lg" px="md" pt="md" pb="xs" wrap="wrap" align="flex-start">
      <Stack gap={0}>
        <Text size="sm" c="dimmed">{he.finance.totalOwed}</Text>
        <Money amount={c.owed} size="lg" />
        <Text size="sm" c="dimmed" className="bm-num">{he.finance.debtorsLine(c.debtors)}</Text>
      </Stack>
      {c.total > 0 && (
        <Stack gap={0} maw={260}>
          <Text size="sm" c="dimmed">{he.home.collectedCaption}</Text>
          <Text className="bm-display bm-num" fz="h2">{he.home.collected(c.paidUp, c.total)}</Text>
          <Text size="xs" c="dimmed">{he.home.collectedRule}</Text>
        </Stack>
      )}
      {debtors.length > 0 && <RemindAll debtors={debtors} />}
    </Group>
  )
}

const SORT_DATA = BALANCE_SORTS.map((value) => ({ value, label: he.finance.sorts[value] }))

/** The list order, remembered on this device: by apartment number (default) or by amount. */
function useBalanceSort(): [BalanceSort, (v: string) => void] {
  const [stored, setStored] = useLocalStorage<string>({ key: 'bm.finance.balances.sort', defaultValue: 'number' })
  return [isBalanceSort(stored) ? stored : 'number', (v) => isBalanceSort(v) && setStored(v)]
}

/** A debtor's reminder: whether its residents have an email, and the last reminder sent. */
export interface RowReminder { hasEmail: boolean; last: LastReminder | undefined }

/** One apartment: plate, residents, balance (debt in red); tap opens its ledger. Debtors get the reminder envelope. */
export function BalanceRow({ row, onOpen, reminder }: { row: ApartmentBalance; onOpen?: (id: string) => void; reminder?: RowReminder }) {
  const parts = [row.scheduled > 0 ? he.finance.scheduled(formatILS(row.scheduled)) : undefined, row.balance > 0 ? reminderStamp(reminder?.last) : undefined]
  const meta = parts.filter(Boolean).join(' · ') || undefined
  return (
    <Row plate={row.number} title={row.names.join(', ') || he.finance.noResidents} meta={meta}
      badge={hasBadges(row) ? <BalanceBadges row={row} /> : undefined} end={<Money amount={row.balance} />} onClick={onOpen ? () => onOpen(row.apartmentId) : undefined}
      label={onOpen ? he.finance.openLedger(row.number) : undefined}
      trailing={reminder && row.balance > 0 ? <ReminderButton apartment={row} hasEmail={reminder.hasEmail} /> : undefined} />
  )
}

/** Admin "יתרות": every apartment, by number or by amount. `paying` opens the payment form (the page FAB). */
export function BalancesTab({ paying, onPayingClose }: { paying: boolean; onPayingClose: () => void }) {
  const q = useBalances()
  const [openId, setOpenId] = useState<string | null>(null)
  const open = q.data?.find((r) => r.apartmentId === openId)
  const chargers = useChargers()
  const [sort, setSort] = useBalanceSort()
  const emailApts = useEmailApartments()
  const last = useLastReminders()
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
          <BalanceRow row={row} onOpen={setOpenId} reminder={{ hasEmail: emailApts.has(row.apartmentId), last: last.get(row.apartmentId) }} />
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
