import { Anchor, Box, Button, Card, Group, Progress, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { IconTool } from '@tabler/icons-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { formatDate, formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { AptPlate, EmptyState, ListSkeleton, Money, PageHeader, StatusBadge } from '../../ui'
import { useAnnouncements } from '../announcements/api'
import { useBalances, useCollectionSummary, useFeeSchedule } from '../finance/api'
import { HowToPay, MyBalanceHero } from '../finance/cards'
import { monthOf, sortBalances } from '../finance/ledger'
import { useTasks } from '../maintenance/api'
import { dueBucket } from '../maintenance/nextDue'
import { useTickets } from '../tickets/api'
import { TicketForm } from '../tickets/TicketForm'
import { TicketRow } from '../tickets/TicketsPage'
import { FormModal } from '../tenants/dialogs'
import { todayISO } from '../../lib/dates'

const LINK_STYLE = { display: 'inline-flex', alignItems: 'center' } as const

const MAX_DUE = 5
const MAX_DEBTORS = 5

/** Dimmed failure line with a retry button, shown instead of content when a section's query fails. */
function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Group gap="sm" justify="space-between">
      <Text size="sm" c="dimmed">{he.home.loadFailed}</Text>
      <Button variant="subtle" mih={44} onClick={onRetry}>{he.home.retry}</Button>
    </Group>
  )
}

/** A home section: heading, content, and a link to the full page. */
function Section({ title, to, linkLabel, children }: { title: string; to: string; linkLabel: string; children: ReactNode }) {
  return (
    <Card>
      <Title order={2} size="h4" mb="xs">{title}</Title>
      <Stack gap="xs">{children}</Stack>
      <Anchor component={Link} to={to} fw={600} mih={44} mt="xs" style={LINK_STYLE}>{linkLabel}</Anchor>
    </Card>
  )
}

/** Admin hero: how many apartments are paid up for the current month (Israel time). */
function CollectionHero() {
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
          <Text className="bm-display bm-num" fz="h1">{he.home.collected(rate.paidUp, rate.total)}</Text>
          <Progress value={(rate.paidUp / rate.total) * 100} color="paid.7" size="lg" radius="xl"
            aria-label={he.home.collected(rate.paidUp, rate.total)} />
          {rate.due > 0 && <Text size="sm" c="dimmed" className="bm-num">{he.home.amountDue(formatILS(rate.due))}</Text>}
        </Stack>
      )}
    </Card>
  )
}

/** Admin: the five largest debts (ties by apartment number). */
function Debtors() {
  const q = useBalances()
  const debtors = sortBalances((q.data ?? []).filter((b) => b.balance > 0), 'amount').slice(0, MAX_DEBTORS)
  return (
    <Section title={he.home.debtors} to="/finance" linkLabel={he.home.allBalances}>
      {q.isLoading && <ListSkeleton rows={3} />}
      {q.isError && <LoadError onRetry={q.refetch} />}
      {q.data && debtors.length === 0 && <EmptyState title={he.home.noDebtors} />}
      {debtors.map((b) => (
        <Group key={b.apartmentId} gap="sm" wrap="nowrap" mih={44}>
          <AptPlate number={b.number} size="sm" />
          <Text fw={600} truncate="end" c={b.names.length ? undefined : 'dimmed'} style={{ flex: 1, minWidth: 0 }}>{b.names.join(', ') || he.finance.noResidents}</Text>
          <Money amount={b.balance} />
        </Group>
      ))}
    </Section>
  )
}

function UnreadDot() {
  return <Box role="img" aria-label={he.announcements.unread} w={10} h={10} bg="signal.6" style={{ borderRadius: '50%', flexShrink: 0 }} />
}

/** The newest visible announcement (pinned first), or an empty state. */
function LatestAnnouncement({ showUnread }: { showUnread: boolean }) {
  const { data, isLoading, isError, refetch } = useAnnouncements()
  const latest = data?.[0]
  return (
    <Section title={he.home.latestAnnouncement} to="/announcements" linkLabel={he.announcements.seeAll}>
      {isLoading && <ListSkeleton rows={1} />}
      {isError && <LoadError onRetry={() => void refetch()} />}
      {!isLoading && !isError && !latest && <EmptyState title={he.home.noAnnouncements} body={he.home.noAnnouncementsBody} />}
      {latest && (
        <>
          <Group gap="xs" wrap="nowrap">
            {showUnread && !latest.isRead && <UnreadDot />}
            <Text fw={600}>{latest.title}</Text>
          </Group>
          <Text size="sm" c="dimmed" className="bm-num">{formatDate(latest.created_at)}</Text>
          <Text lineClamp={3} style={{ whiteSpace: 'pre-wrap' }}>{latest.body}</Text>
        </>
      )}
    </Section>
  )
}

/** Admin: open calls count plus the 3 newest. */
function OpenTickets() {
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

/** Admin: overdue and soon-due maintenance. */
function MaintenanceDue() {
  const { data, isLoading, isError, refetch } = useTasks()
  const today = todayISO()
  const due = (data ?? [])
    .map((task) => ({ task, bucket: dueBucket(task.next_due, today) }))
    .filter((x) => x.bucket === 'overdue' || x.bucket === 'soon')
    .slice(0, MAX_DUE)
  return (
    <Section title={he.home.maintenanceDue} to="/maintenance" linkLabel={he.home.allTasks}>
      {isLoading && <ListSkeleton rows={2} />}
      {isError && <LoadError onRetry={() => void refetch()} />}
      {data && due.length === 0 && <EmptyState title={he.home.noMaintenanceDue} />}
      {due.map(({ task, bucket }) => (
        <Group key={task.id} justify="space-between" wrap="nowrap" mih={44}>
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text fw={600} truncate="end">{task.title}</Text>
            {task.next_due && <Text size="sm" c="dimmed" className="bm-num">{formatDate(task.next_due)}</Text>}
          </Stack>
          <StatusBadge kind="due" value={bucket} />
        </Group>
      ))}
    </Section>
  )
}

/** Resident: the calls this user opened that are still active. */
function MyTickets({ onReport }: { onReport: () => void }) {
  const userId = useAuth().session?.user.id
  const { data, isLoading, isError, refetch } = useTickets(['open', 'in_progress'])
  const mine = data?.filter((t) => t.opened_by === userId)
  return (
    <Section title={he.home.myTickets} to="/tickets" linkLabel={he.home.allTickets}>
      <Button color="signal" fullWidth leftSection={<IconTool size={20} stroke={1.75} aria-hidden="true" />} onClick={onReport}>{he.home.reportTicket}</Button>
      {isLoading && <ListSkeleton rows={2} />}
      {isError && <LoadError onRetry={() => void refetch()} />}
      {mine?.length === 0 && <EmptyState title={he.home.noMyTickets} />}
      {mine?.map((t) => <TicketRow key={t.id} ticket={t} />)}
    </Section>
  )
}

/** Only the sections the user's group may see (the server returns nothing for the others anyway). */
function ResidentHome({ onReport }: { onReport: () => void }) {
  const { can } = useAuth()
  const money = can('finance_own')
  const news = can('announcements')
  const calls = can('tickets')
  if (!money && !news && !calls) {
    return <Card><EmptyState title={he.permissions.homeEmpty} body={he.permissions.homeEmptyBody} /></Card>
  }
  return (
    <Stack gap="lg">
      {money && <MyBalanceHero />}
      {money && <HowToPay whenOwed />}
      {news && <LatestAnnouncement showUnread />}
      {calls && <MyTickets onReport={onReport} />}
    </Stack>
  )
}

/** The collection hero full width; then money and calls beside maintenance and the latest announcement. */
function AdminHome() {
  return (
    <Stack gap="lg">
      <CollectionHero />
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg" verticalSpacing="lg">
        <Stack gap="lg"><Debtors /><OpenTickets /></Stack>
        <Stack gap="lg"><MaintenanceDue /><LatestAnnouncement showUnread={false} /></Stack>
      </SimpleGrid>
    </Stack>
  )
}

export default function HomePage() {
  const { profile, isAdmin } = useAuth()
  const [reporting, setReporting] = useState(false)
  return (
    <>
      <PageHeader title={profile?.full_name ? he.welcomeUser(profile.full_name) : he.welcome} />
      {isAdmin ? <AdminHome /> : <ResidentHome onReport={() => setReporting(true)} />}
      <FormModal opened={reporting} title={he.tickets.add} onClose={() => setReporting(false)}>
        {reporting && <TicketForm onDone={() => setReporting(false)} />}
      </FormModal>
    </>
  )
}
