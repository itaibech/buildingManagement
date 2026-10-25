import { Button, Card, SimpleGrid, Stack } from '@mantine/core'
import { IconTool } from '@tabler/icons-react'
import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, PageHeader } from '../../ui'
import { useTickets } from '../tickets/api'
import { TicketForm } from '../tickets/TicketForm'
import { TicketRow } from '../tickets/TicketsPage'
import { FormModal } from '../tenants/dialogs'
import { CashMini, CollectionHero, Debtors, MaintenanceDue, OpenTickets } from './AdminCards'
import { SetupChecklist } from './SetupChecklist'
import { AdminInbox } from './InboxCard'
import { LoadError, Section } from './parts'
import { LatestAnnouncement, ResidentHero } from './ResidentHero'

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

/** "הדירה שלי" first (its money part only with finance_own), then the sections the user's group may see. */
function ResidentHome({ onReport }: { onReport: () => void }) {
  const { can } = useAuth()
  const news = can('announcements')
  const calls = can('tickets')
  return (
    <Stack gap="lg">
      <ResidentHero />
      {news && <LatestAnnouncement showUnread />}
      {calls && <MyTickets onReport={onReport} />}
      {!news && !calls && !can('finance_own') && <Card><EmptyState title={he.permissions.homeEmpty} body={he.permissions.homeEmptyBody} /></Card>}
    </Stack>
  )
}

/** "לטיפולך" and the setup checklist on top, the collection hero and cash, then money and calls beside maintenance and news. */
function AdminHome() {
  return (
    <Stack gap="lg">
      <AdminInbox />
      <SetupChecklist />
      <CollectionHero />
      <CashMini />
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
