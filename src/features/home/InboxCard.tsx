import { Alert, Anchor, Badge, Card, Group, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { IconCalendarCheck, IconChevronLeft, IconCoin, IconGavel, IconTool, IconUserPlus, type Icon } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { todayISO } from '../../lib/dates'
import { he } from '../../lib/he'
import { ListSkeleton } from '../../ui'
import { useLastReminders } from '../email/useReminders'
import { useBalances } from '../finance/api'
import { useTasks } from '../maintenance/api'
import { dueBucket } from '../maintenance/nextDue'
import { useMeetings } from '../meetings/api'
import { useUnseenTicketCount } from '../notifications/api'
import { useGroups } from '../permissions/api'
import { usePendingProfiles } from '../tenants/api'
import { inboxItems, staleDebtors, upcomingInvited, type InboxItem, type InboxKey } from './inbox'

const I = he.home.inbox
const ICONS: Record<InboxKey, Icon> = {
  users: IconUserPlus, tickets: IconTool, maintenance: IconCalendarCheck, publish: IconGavel, invited: IconGavel, debtors: IconCoin,
}
// Maintenance overdue is `debt` by the status mapping; everything else waiting on the admin is `signal`.
const TONE: Partial<Record<InboxKey, string>> = { maintenance: 'debt' }

function InboxRow({ item }: { item: InboxItem }) {
  const Ico = ICONS[item.key]
  const tone = TONE[item.key] ?? 'signal'
  return (
    <UnstyledButton component={Link} to={item.to} className="bm-row" mih={48} px="xs" style={{ display: 'flex', alignItems: 'center', gap: 12, borderRadius: 10 }}>
      <Ico size={22} stroke={1.75} aria-hidden="true" color="var(--mantine-color-stone-7)" />
      <Text fw={600} style={{ flex: 1, minWidth: 0 }}>{I.rows[item.key](item.count)}</Text>
      <Badge color={tone} c={`${tone}.9`} className="bm-num" aria-hidden="true">{item.count}</Badge>
      <IconChevronLeft size={18} stroke={1.75} aria-hidden="true" />
    </UnstyledButton>
  )
}

/** The counts behind the inbox, from the queries the pages already use. */
function useInbox() {
  const pending = usePendingProfiles()
  const unseen = useUnseenTicketCount()
  const tasks = useTasks()
  const meetings = useMeetings()
  const balances = useBalances()
  const last = useLastReminders()
  const [now] = useState(() => new Date())
  const items = useMemo(() => {
    const today = todayISO()
    return inboxItems({
      pendingUsers: pending.data?.length ?? 0,
      unseenTickets: unseen,
      overdueTasks: (tasks.data ?? []).filter((t) => dueBucket(t.next_due, today) === 'overdue').length,
      toPublish: (meetings.data ?? []).filter((m) => m.status === 'closed').length,
      invited: upcomingInvited(meetings.data ?? [], now),
      staleDebtors: staleDebtors(balances.data ?? [], last, today),
    })
  }, [pending.data, unseen, tasks.data, meetings.data, balances.data, last, now])
  return { items, isLoading: pending.isLoading || tasks.isLoading || meetings.isLoading }
}

/** "דיירים לא רואים את היתרה שלהם": while the default group lacks finance_own (the defaults stay as the admin set them). */
function FinanceOwnHint() {
  const groups = useGroups()
  const fallback = groups.data?.find((g) => g.isDefault)
  if (!fallback || fallback.permissions.has('finance_own')) return null
  return (
    <Alert color="enamel" variant="light" p="sm">
      <Group gap="xs" justify="space-between" wrap="wrap">
        <Text size="sm">{I.financeOwnHint}</Text>
        <Anchor component={Link} to="/settings/permissions" fw={600} size="sm" mih={44} style={{ display: 'inline-flex', alignItems: 'center' }}>{I.financeOwnAction}</Anchor>
      </Group>
    </Alert>
  )
}

/** Admin "לטיפולך": what waits for a decision, each with a count and a deep link; a cheer when nothing does. */
export function AdminInbox() {
  const { items, isLoading } = useInbox()
  return (
    <Card>
      <Title order={2} size="h4" mb="xs">{I.title}</Title>
      {isLoading && <ListSkeleton rows={2} />}
      {!isLoading && items.length === 0 && <Text c="dimmed" py="xs">{I.empty}</Text>}
      <Stack gap={0}>{items.map((item) => <InboxRow key={item.key} item={item} />)}</Stack>
      <Stack mt={items.length ? 'xs' : 0}><FinanceOwnHint /></Stack>
    </Card>
  )
}
