import { Card, Chip, Group, Stack, Text } from '@mantine/core'
import { IconPhoto } from '@tabler/icons-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { relativeDate } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, PageHeader, StatusBadge } from '../../ui'
import { FormModal } from '../tenants/dialogs'
import { TICKET_STATUSES, useTickets, type TicketListItem, type TicketStatus } from './api'
import { TicketForm } from './TicketForm'

const DEFAULT_FILTER: TicketStatus[] = ['open', 'in_progress']
const CHIP_STYLES = { label: { height: 44, paddingInline: 16, fontWeight: 600 } }

function PhotoCount({ n }: { n: number }) {
  return (
    <Group gap={4} wrap="nowrap" c="stone.7" role="img" aria-label={he.tickets.photoCount(n)}>
      <IconPhoto size={18} stroke={1.75} aria-hidden="true" />
      <Text size="sm" className="bm-num" aria-hidden="true">{n}</Text>
    </Group>
  )
}

export function TicketRow({ ticket }: { ticket: TicketListItem }) {
  const meta = [ticket.location, relativeDate(ticket.created_at)].filter(Boolean).join(' · ')
  return (
    <Card component={Link} to={`/tickets/${ticket.id}`} padding="md" className="bm-row" mih={44}>
      <Group wrap="nowrap" gap="sm">
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

function StatusFilter({ value, onChange }: { value: TicketStatus[]; onChange: (v: TicketStatus[]) => void }) {
  const all = value.length === TICKET_STATUSES.length
  const pick = (next: string[]) => {
    const statuses = TICKET_STATUSES.filter((s) => next.includes(s))
    if (statuses.length > 0) onChange(statuses)
  }
  return (
    <Group gap="xs" role="group" aria-label={he.tickets.filterLabel}>
      <Chip checked={all} onChange={() => onChange([...TICKET_STATUSES])} styles={CHIP_STYLES}>{he.tickets.filters.all}</Chip>
      <Chip.Group multiple value={value} onChange={pick}>
        {TICKET_STATUSES.map((s) => <Chip key={s} value={s} styles={CHIP_STYLES}>{he.tickets.filters[s]}</Chip>)}
      </Chip.Group>
    </Group>
  )
}

/** Service calls: anyone approved can report; filter by status (open + in progress by default). */
export default function TicketsPage() {
  const [filter, setFilter] = useState<TicketStatus[]>(DEFAULT_FILTER)
  const [adding, setAdding] = useState(false)
  const list = useTickets(filter.length === TICKET_STATUSES.length ? undefined : filter)
  const add = { label: he.tickets.add, onClick: () => setAdding(true) }
  return (
    <Stack gap="md">
      <PageHeader title={he.nav.tickets} action={add} />
      <StatusFilter value={filter} onChange={setFilter} />
      {list.isError && <Text c="debt.7">{he.tickets.errors.load}</Text>}
      {list.isLoading && <ListSkeleton rows={4} />}
      {list.data?.length === 0 && <EmptyState title={he.tickets.empty} body={he.tickets.emptyBody} action={add} />}
      {list.data?.map((t) => <TicketRow key={t.id} ticket={t} />)}
      <FormModal opened={adding} title={he.tickets.add} onClose={() => setAdding(false)}>
        {adding && <TicketForm onDone={() => setAdding(false)} />}
      </FormModal>
    </Stack>
  )
}
