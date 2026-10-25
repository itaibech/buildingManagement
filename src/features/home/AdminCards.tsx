import { Card, Group, Progress, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { IconChevronLeft } from '@tabler/icons-react'
import { useNavigate } from 'react-router'
import { todayISO } from '../../lib/dates'
import { formatDate, formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, Money, StatusBadge } from '../../ui'
import { ReminderButton } from '../email/ReminderButton'
import { reminderStamp, useEmailApartments, useLastReminders } from '../email/useReminders'
import { useBalances, useBuildingCash, useCollectionSummary, useFeeSchedule } from '../finance/api'
import { Row } from '../finance/fields'
import { monthOf, sortBalances } from '../finance/ledger'
import { useTasks } from '../maintenance/api'
import { dueBucket } from '../maintenance/nextDue'
import { useTickets } from '../tickets/api'
import { TicketRow } from '../tickets/TicketsPage'
import { LoadError, Section } from './parts'

const MAX_DUE = 5
const MAX_DEBTORS = 5

/** Admin hero: "3 מתוך 6 · שילמו את דמי הוועד לחודש זה" (collection_summary, the same rule as the balances list). */
export function CollectionHero() {
  const navigate = useNavigate()
  const fees = useFeeSchedule()
  const noFees = fees.data?.length === 0
  const q = useCollectionSummary(monthOf(todayISO()), fees.isSuccess && !noFees)
  const rate = noFees ? undefined : q.data
  return (
    <Card>
      <Title order={2} size="h4">{he.home.collectionThisMonth}</Title>
      {(fees.isLoading || (q.isLoading && !noFees)) && <ListSkeleton rows={1} />}
      {(fees.isError || q.isError) && <LoadError onRetry={() => { void fees.refetch(); void q.refetch() }} />}
      {noFees && <EmptyState title={he.home.setFeesFirst} action={{ label: he.home.setFeesAction, onClick: () => navigate('/finance?tab=fees') }} />}
      {rate?.total === 0 && <EmptyState title={he.home.collectionSoon} />}
      {rate && rate.total > 0 && (
        <Stack gap="xs" mt="xs">
          <Group gap="sm" align="baseline" wrap="wrap">
            <Text className="bm-display bm-num" fz="h1">{he.home.collected(rate.paidUp, rate.total)}</Text>
            <Text fw={600}>{he.home.collectedCaption}</Text>
          </Group>
          <Progress value={(rate.paidUp / rate.total) * 100} color="paid.7" size="lg" radius="xl"
            aria-label={`${he.home.collected(rate.paidUp, rate.total)} ${he.home.collectedCaption}`} />
          <Text size="xs" c="dimmed">{he.home.collectedRule}</Text>
          {rate.due > 0 && <Text size="sm" c="dimmed" className="bm-num">{he.home.amountDue(formatILS(rate.due))}</Text>}
        </Stack>
      )}
    </Card>
  )
}

/** Admin: "בקופת הבניין ₪X", a compact card that opens the budget tab. */
export function CashMini() {
  const navigate = useNavigate()
  const q = useBuildingCash()
  if (q.data === undefined) return null
  return (
    <Card padding={0}>
      <UnstyledButton className="bm-row" onClick={() => void navigate('/finance?tab=budget')} aria-label={he.home.cashLink} mih={56} px="md" py="xs"
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', borderRadius: 12 }}>
        <Text fw={600} style={{ flex: 1 }}>{he.home.cash}</Text>
        <Money amount={q.data} tone="neutral" size="md" />
        <IconChevronLeft size={18} stroke={1.75} aria-hidden="true" />
      </UnstyledButton>
    </Card>
  )
}

/** Admin: the five largest debts; a row opens the apartment's "חיובים ויתרה", the envelope sends a reminder. */
export function Debtors() {
  const navigate = useNavigate()
  const q = useBalances()
  const emailApts = useEmailApartments()
  const last = useLastReminders()
  const debtors = sortBalances((q.data ?? []).filter((b) => b.balance > 0), 'amount').slice(0, MAX_DEBTORS)
  return (
    <Section title={he.home.debtors} to="/finance" linkLabel={he.home.allBalances} flush>
      {q.isLoading && <ListSkeleton rows={3} />}
      {q.isError && <LoadError onRetry={q.refetch} />}
      {q.data && debtors.length === 0 && <EmptyState title={he.home.noDebtors} />}
      {debtors.map((b) => (
        <Row key={b.apartmentId} plate={b.number} title={b.names.join(', ') || he.finance.noResidents} meta={reminderStamp(last.get(b.apartmentId))}
          end={<Money amount={b.balance} />} onClick={() => void navigate(`/apartments/${b.apartmentId}?tab=ledger`)} label={he.home.openDebtor(b.number)}
          trailing={<ReminderButton apartment={b} hasEmail={emailApts.has(b.apartmentId)} />} />
      ))}
    </Section>
  )
}

/** Admin: open calls count plus the 3 newest. */
export function OpenTickets() {
  const { data, isLoading, isError, refetch } = useTickets(['open', 'in_progress'])
  return (
    <Section title={he.home.openTickets} to="/tickets" linkLabel={he.home.allTickets}>
      {isLoading && <ListSkeleton rows={2} />}
      {isError && <LoadError onRetry={() => void refetch()} />}
      {data?.length === 0 && <EmptyState title={he.home.noOpenTickets} />}
      {data && data.length > 0 && <Text fw={600} className="bm-num">{he.home.openTicketsCount(data.length)}</Text>}
      {data?.slice(0, 3).map((t) => <TicketRow key={t.id} ticket={t} />)}
    </Section>
  )
}

/** Admin: overdue and soon-due maintenance; a row opens the task's detail. */
export function MaintenanceDue() {
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useTasks()
  const today = todayISO()
  const due = (data ?? [])
    .map((task) => ({ task, bucket: dueBucket(task.next_due, today) }))
    .filter((x) => x.bucket === 'overdue' || x.bucket === 'soon')
    .slice(0, MAX_DUE)
  return (
    <Section title={he.home.maintenanceDue} to="/maintenance" linkLabel={he.home.allTasks} flush>
      {isLoading && <ListSkeleton rows={2} />}
      {isError && <LoadError onRetry={() => void refetch()} />}
      {data && due.length === 0 && <EmptyState title={he.home.noMaintenanceDue} />}
      {due.map(({ task, bucket }) => (
        <Row key={task.id} title={task.title} meta={task.next_due ? formatDate(task.next_due) : undefined} end={<StatusBadge kind="due" value={bucket} />}
          onClick={() => void navigate(`/maintenance?task=${task.id}`)} label={he.home.openTask(task.title)} />
      ))}
    </Section>
  )
}
