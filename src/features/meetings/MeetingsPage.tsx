import { Stack, Tabs, Text, Title } from '@mantine/core'
import { IconBolt } from '@tabler/icons-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useNavigate } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, PageHeader } from '../../ui'
import { FormModal } from '../tenants/dialogs'
import { useMeetings } from './api'
import { ArchiveList } from './ArchiveList'
import { tabOf, type MeetingTab } from './lifecycle'
import { MeetingCard } from './MeetingCard'
import { MeetingForm } from './MeetingForm'
import { PublishReminders } from './PublishReminders'
import { QuickStartDialog } from './QuickStart'
import type { MeetingListItem } from './types'

const byDateAsc = (a: MeetingListItem, b: MeetingListItem) => a.scheduled_at.localeCompare(b.scheduled_at)

function List({ meetings, empty, body }: { meetings: MeetingListItem[]; empty: string; body: string }) {
  if (!meetings.length) return <EmptyState title={empty} body={body} />
  return <Stack gap="sm">{meetings.map((m) => <MeetingCard key={m.id} meeting={m} showStatus />)}</Stack>
}

function AdminTabs({ meetings }: { meetings: MeetingListItem[] }) {
  const [params] = useSearchParams()
  const raw = params.get('tab')
  const linked: MeetingTab | null = raw === 'pending' || raw === 'archive' || raw === 'upcoming' ? raw : null
  const [tab, setTab] = useState<MeetingTab>(linked ?? 'upcoming')
  // A new ?tab= while the page is open (the home inbox) switches the tab.
  const [seenLink, setSeenLink] = useState(linked)
  if (linked !== seenLink) { setSeenLink(linked); if (linked) setTab(linked) }
  const of = (t: MeetingTab) => meetings.filter((m) => tabOf(m.status) === t)
  const label = (t: MeetingTab) => `${he.meetings.tabs[t]} (${of(t).length})`
  return (
    <Tabs value={tab} onChange={(v) => setTab(v === 'pending' || v === 'archive' ? v : 'upcoming')} keepMounted={false}>
      <Tabs.List mb="md">
        {(['upcoming', 'pending', 'archive'] as const).map((t) => <Tabs.Tab key={t} value={t} mih={44}>{label(t)}</Tabs.Tab>)}
      </Tabs.List>
      <Tabs.Panel value="upcoming"><List meetings={of('upcoming').sort(byDateAsc)} empty={he.meetings.emptyUpcoming} body={he.meetings.emptyUpcomingAdmin} /></Tabs.Panel>
      <Tabs.Panel value="pending"><List meetings={of('pending')} empty={he.meetings.emptyPending} body={he.meetings.emptyPendingBody} /></Tabs.Panel>
      <Tabs.Panel value="archive"><ArchiveList meetings={of('archive')} showStatus={false} /></Tabs.Panel>
    </Tabs>
  )
}

function ResidentSections({ meetings }: { meetings: MeetingListItem[] }) {
  const upcoming = meetings.filter((m) => m.status === 'invited').sort(byDateAsc)
  return (
    <Stack gap="lg">
      <Stack gap="sm">
        <Title order={2} size="h4">{he.meetings.upcomingTitle}</Title>
        {upcoming.length ? upcoming.map((m) => <MeetingCard key={m.id} meeting={m} showStatus={false} />)
          : <EmptyState title={he.meetings.emptyUpcoming} body={he.meetings.emptyUpcomingResident} />}
      </Stack>
      <Stack gap="sm">
        <Title order={2} size="h4">{he.meetings.protocolsTitle}</Title>
        <ArchiveList meetings={meetings.filter((m) => m.status === 'published')} showStatus={false} />
      </Stack>
    </Stack>
  )
}

/** "ישיבות ועד": admins plan, run and archive meetings; residents see invitations and published protocols. */
export default function MeetingsPage() {
  const { isAdmin } = useAuth()
  const list = useMeetings()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [quick, setQuick] = useState(false)
  const add = isAdmin ? { label: he.meetings.newMeeting, onClick: () => setCreating(true) } : undefined
  const quickStart = isAdmin ? { label: he.meetings.actions.quickStart, icon: <IconBolt size={18} stroke={1.75} />, onClick: () => setQuick(true) } : undefined
  return (
    <Stack gap="md">
      <PageHeader title={isAdmin ? he.meetings.title : he.meetings.residentTitle} action={add} secondaryAction={quickStart} />
      {list.isError && <Text c="debt.7">{he.meetings.loadFailed}</Text>}
      {list.isLoading && <ListSkeleton rows={4} />}
      {list.data && isAdmin && <PublishReminders meetings={list.data} />}
      {list.data && (isAdmin ? <AdminTabs meetings={list.data} /> : <ResidentSections meetings={list.data} />)}
      <FormModal opened={creating} title={he.meetings.form.newTitle} onClose={() => setCreating(false)}>
        {creating && <MeetingForm onDone={(id) => { setCreating(false); navigate(`/meetings/${id}`) }} />}
      </FormModal>
      {isAdmin && <QuickStartDialog key={String(quick)} opened={quick} onClose={() => setQuick(false)} />}
    </Stack>
  )
}
