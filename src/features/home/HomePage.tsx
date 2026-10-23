import { Anchor, Card, Progress, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { formatDate, formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, Money, PageHeader } from '../../ui'
import { useAnnouncements } from '../announcements/api'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <Title order={2} size="h4" mb="xs">{title}</Title>
      {children}
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
        <Text c="dimmed" mt="xs">{he.home.financeSoon}</Text>
      ) : (
        <Stack gap="xs" mt="xs">
          <Text className="bm-display bm-num" fz="h1">{he.home.collected(rate.paid, rate.total)}</Text>
          <Progress value={rate.total ? (rate.paid / rate.total) * 100 : 0} color="paid.7" size="lg" radius="xl" />
        </Stack>
      )}
    </Card>
  )
}

/** The newest visible announcement (pinned first), or an empty state. */
function LatestAnnouncement() {
  const { data, isLoading } = useAnnouncements()
  const latest = data?.[0]
  if (isLoading) return <ListSkeleton rows={1} />
  if (!latest) return <EmptyState title={he.home.noAnnouncements} body={he.home.noAnnouncementsBody} />
  return (
    <Stack gap={4}>
      <Text fw={600}>{latest.title}</Text>
      <Text size="sm" c="dimmed" className="bm-num">{formatDate(latest.created_at)}</Text>
      <Text lineClamp={3} style={{ whiteSpace: 'pre-wrap' }}>{latest.body}</Text>
      <Anchor component={Link} to="/announcements" fw={600} mih={44} style={{ display: 'inline-flex', alignItems: 'center' }}>
        {he.announcements.seeAll}
      </Anchor>
    </Stack>
  )
}

function ResidentHome() {
  return (
    <Stack gap="lg">
      <BalanceHero balance={null} />
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        <Section title={he.home.latestAnnouncement}>
          <LatestAnnouncement />
        </Section>
        <Section title={he.home.myOpenTickets}>
          <EmptyState title={he.home.noOpenTickets} />
        </Section>
      </SimpleGrid>
    </Stack>
  )
}

function AdminHome() {
  return (
    <Stack gap="lg">
      <CollectionHero rate={null} />
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
        <Section title={he.home.debtors}>
          <EmptyState title={he.home.noDebtors} />
        </Section>
        <Section title={he.home.openTickets}>
          <EmptyState title={he.home.noOpenTickets} />
        </Section>
        <Section title={he.home.maintenanceDue}>
          <EmptyState title={he.home.noMaintenanceDue} />
        </Section>
      </SimpleGrid>
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
