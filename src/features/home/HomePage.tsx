import { Anchor, Box, Button, Card, Group, Progress, Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { formatDate, formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, Money, PageHeader, StatusBadge } from '../../ui'
import { useAnnouncements } from '../announcements/api'
import { useTasks } from '../maintenance/api'
import { dueBucket } from '../maintenance/nextDue'
import { useTickets } from '../tickets/api'
import { TicketForm } from '../tickets/TicketForm'
import { TicketRow } from '../tickets/TicketsPage'
import { FormModal } from '../tenants/dialogs'
import { todayISO } from '../../lib/dates'

const LINK_STYLE = { display: 'inline-flex', alignItems: 'center' } as const

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

/** Resident hero: their own balance. `balance` is null until the finance module lands. */
export function BalanceHero({ balance }: { balance: number | null }) {
  return (
    <Card>
      <Text fw={600} c="dimmed" size="sm">{he.home.myBalance}</Text>
      {balance === null ? (
        <Text c="dimmed" mt="xs">{he.home.financeSoon}</Text>
      ) : (
        <Stack gap={4} mt="xs">
          <Money amount={balance} size="xl" />
          <Text fw={600}>{balance > 0 ? he.home.balanceDue(formatILS(balance)) : he.home.allPaid}</Text>
        </Stack>
      )}
    </Card>
  )
}

/** Admin hero: the month's collection rate. `rate` is null until the finance module lands. */
export function CollectionHero({ rate }: { rate: { paid: number; total: number } | null }) {
  return (
    <Card>
      <Text fw={600} c="dimmed" size="sm">{he.home.collectionThisMonth}</Text>
      {rate === null ? (
        <EmptyState title={he.home.collectionSoon} />
      ) : (
        <Stack gap="xs" mt="xs">
          <Text className="bm-display bm-num" fz="h1">{he.home.collected(rate.paid, rate.total)}</Text>
          <Progress value={rate.total ? (rate.paid / rate.total) * 100 : 0} color="paid.7" size="lg" radius="xl" />
        </Stack>
      )}
    </Card>
  )
}

function UnreadDot() {
  return <Box role="img" aria-label={he.announcements.unread} w={10} h={10} bg="signal.6" style={{ borderRadius: '50%', flexShrink: 0 }} />
}

/** The newest visible announcement (pinned first), or an empty state. */
function LatestAnnouncement({ showUnread }: { showUnread: boolean }) {
  const { data, isLoading } = useAnnouncements()
  const latest = data?.[0]
  return (
    <Section title={he.home.latestAnnouncement} to="/announcements" linkLabel={he.announcements.seeAll}>
      {isLoading && <ListSkeleton rows={1} />}
      {!isLoading && !latest && <EmptyState title={he.home.noAnnouncements} body={he.home.noAnnouncementsBody} />}
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
  const { data, isLoading } = useTickets(['open'])
  return (
    <Section title={he.home.openTickets} to="/tickets" linkLabel={he.home.allTickets}>
      {isLoading && <ListSkeleton rows={2} />}
      {data?.length === 0 && <EmptyState title={he.home.noOpenTickets} />}
      {data && data.length > 0 && <Text fw={600} className="bm-num">{he.home.openTicketsCount(data.length)}</Text>}
      {data?.slice(0, 3).map((t) => <TicketRow key={t.id} ticket={t} />)}
    </Section>
  )
}

/** Admin: overdue and soon-due maintenance. */
function MaintenanceDue() {
  const { data, isLoading } = useTasks()
  const today = todayISO()
  const due = (data ?? []).map((task) => ({ task, bucket: dueBucket(task.next_due, today) })).filter((x) => x.bucket === 'overdue' || x.bucket === 'soon')
  return (
    <Section title={he.home.maintenanceDue} to="/maintenance" linkLabel={he.home.allTasks}>
      {isLoading && <ListSkeleton rows={2} />}
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
function MyTickets() {
  const userId = useAuth().session?.user.id
  const { data, isLoading } = useTickets(['open', 'in_progress'])
  const mine = data?.filter((t) => t.opened_by === userId)
  return (
    <Section title={he.home.myTickets} to="/tickets" linkLabel={he.home.allTickets}>
      {isLoading && <ListSkeleton rows={2} />}
      {mine?.length === 0 && <EmptyState title={he.home.noMyTickets} />}
      {mine?.map((t) => <TicketRow key={t.id} ticket={t} />)}
    </Section>
  )
}

function ReportTicket() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="md" mih={44} fullWidth onClick={() => setOpen(true)}>{he.home.reportTicket}</Button>
      <FormModal opened={open} title={he.tickets.add} onClose={() => setOpen(false)}>
        {open && <TicketForm onDone={() => setOpen(false)} />}
      </FormModal>
    </>
  )
}

function ResidentHome() {
  return (
    <Stack gap="lg">
      <BalanceHero balance={null} />
      <ReportTicket />
      <LatestAnnouncement showUnread />
      <MyTickets />
    </Stack>
  )
}

function AdminHome() {
  return (
    <Stack gap="lg">
      <CollectionHero rate={null} />
      <OpenTickets />
      <MaintenanceDue />
      <LatestAnnouncement showUnread={false} />
    </Stack>
  )
}

export default function HomePage() {
  const { profile, isAdmin } = useAuth()
  return (
    <>
      <PageHeader title={profile?.full_name ? he.welcomeUser(profile.full_name) : he.welcome} />
      {isAdmin ? <AdminHome /> : <ResidentHome />}
    </>
  )
}
