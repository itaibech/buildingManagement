import { Box, Card, Group, SegmentedControl, Stack, Text } from '@mantine/core'
import { IconPhoto } from '@tabler/icons-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { relativeDate } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, PageHeader, StatusBadge, UnreadDot } from '../../ui'
import { ticketsRows } from '../export/buildWorkbook'
import { useExportAction } from '../export/useExport'
import { useUnseenTicketIds } from '../notifications/api'
import { FormModal } from '../tenants/dialogs'
import { useTickets, type TicketListItem, type TicketStatus } from './api'
import { TicketForm } from './TicketForm'

type Filter = 'active' | 'closed' | 'all'
const STATUSES: Record<Filter, TicketStatus[] | undefined> = { active: ['open', 'in_progress'], closed: ['closed'], all: undefined }
const FILTERS: Filter[] = ['active', 'closed', 'all']
const isFilter = (v: string): v is Filter => FILTERS.some((f) => f === v)

function PhotoCount({ n }: { n: number }) {
  return (
    <Group gap={4} wrap="nowrap" c="stone.7" role="img" aria-label={he.tickets.photoCount(n)}>
      <IconPhoto size={18} stroke={1.75} aria-hidden="true" />
      <Text size="sm" className="bm-num" aria-hidden="true">{n}</Text>
    </Group>
  )
}

/**
 * `unseen`: the call has activity the user hasn't opened yet (the `signal` dot, as for unread announcements). When
 * given, rows keep the dot's slot so titles line up.
 */
export function TicketRow({ ticket, unseen }: { ticket: TicketListItem; unseen?: boolean }) {
  const meta = [ticket.location, relativeDate(ticket.created_at)].filter(Boolean).join(' · ')
  return (
    <Card component={Link} to={`/tickets/${ticket.id}`} padding="md" className="bm-row" mih={44}>
      <Group wrap="nowrap" gap="sm">
        {unseen && <UnreadDot label={he.notifications.unseen} />}
        {unseen === false && <Box w={10} style={{ flexShrink: 0 }} />}
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} truncate="end">{ticket.title}</Text>
          <Text size="sm" c="dimmed" truncate="end">{meta}</Text>
        </Stack>
        {ticket.photoCount > 0 && <PhotoCount n={ticket.photoCount} />}
        <StatusBadge kind="ticket" value={ticket.status} />
      </Group>
    </Card>
  )
}

function StatusFilter({ value, onChange }: { value: Filter; onChange: (v: Filter) => void }) {
  return (
    <SegmentedControl aria-label={he.tickets.filterLabel} maw={480} value={value} onChange={(v) => isFilter(v) && onChange(v)}
      data={FILTERS.map((f) => ({ value: f, label: he.tickets.filters[f] }))} />
  )
}

/** Service calls: anyone approved can report; filter by status (open + in progress by default). */
export default function TicketsPage() {
  const [filter, setFilter] = useState<Filter>('active')
  const [adding, setAdding] = useState(false)
  const list = useTickets(STATUSES[filter])
  const unseen = useUnseenTicketIds()
  const add = { label: he.tickets.add, onClick: () => setAdding(true) }
  const exportAction = useExportAction(he.export.files.tickets, () => ticketsRows(list.data ?? []), !!list.data)
  return (
    <Stack gap="md">
      <PageHeader title={he.nav.tickets} action={add} secondaryAction={exportAction} />
      <StatusFilter value={filter} onChange={setFilter} />
      {list.isError && <Text c="debt.7">{he.tickets.errors.load}</Text>}
      {list.isLoading && <ListSkeleton rows={4} />}
      {list.data?.length === 0 && <EmptyState title={he.tickets.empty} body={he.tickets.emptyBody} action={add} />}
      {list.data?.map((t) => <TicketRow key={t.id} ticket={t} unseen={unseen.has(t.id)} />)}
      <FormModal opened={adding} title={he.tickets.add} onClose={() => setAdding(false)}>
        {adding && <TicketForm onDone={() => setAdding(false)} />}
      </FormModal>
    </Stack>
  )
}
