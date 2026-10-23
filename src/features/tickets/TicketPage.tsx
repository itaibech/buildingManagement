import { ActionIcon, Anchor, Card, Group, Menu, Stack, Text, Title } from '@mantine/core'
import { IconChevronRight, IconDots, IconPencil, IconTrash } from '@tabler/icons-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { formatDate } from '../../lib/format'
import { he } from '../../lib/he'
import { ListSkeleton, notifySuccess, StatusBadge } from '../../ui'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { AdminControls } from './AdminControls'
import { useDeleteTicket, useTicket, type TicketDetail } from './api'
import { TicketComments } from './TicketComments'
import { TicketForm } from './TicketForm'
import { TicketPhotos } from './TicketPhotos'

type Dialog = 'edit' | 'delete' | null
const ICON = { size: 18, stroke: 1.75 } as const

function BackLink() {
  return (
    <Anchor component={Link} to="/tickets" fw={600} mih={44} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <IconChevronRight {...ICON} aria-hidden="true" />
      {he.tickets.back}
    </Anchor>
  )
}

function ActionsMenu({ canEdit, canDelete, setDialog }: { canEdit: boolean; canDelete: boolean; setDialog: (d: Dialog) => void }) {
  if (!canEdit && !canDelete) return null
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={he.tickets.actions}>
          <IconDots size={20} stroke={1.75} aria-hidden="true" />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {canEdit && <Menu.Item leftSection={<IconPencil {...ICON} />} onClick={() => setDialog('edit')}>{he.tickets.edit}</Menu.Item>}
        {canDelete && <Menu.Item color="debt" leftSection={<IconTrash {...ICON} />} onClick={() => setDialog('delete')}>{he.tickets.delete}</Menu.Item>}
      </Menu.Dropdown>
    </Menu>
  )
}

function Summary({ ticket, menu }: { ticket: TicketDetail; menu: ReactNode }) {
  const meta = [ticket.location, he.tickets.openedBy(ticket.openerName ?? he.tickets.someone, formatDate(ticket.created_at))]
  return (
    <Card padding="md">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Title order={1} fz={{ base: 'h3', sm: 'h2' }} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{ticket.title}</Title>
          <Group gap={0} wrap="nowrap" style={{ flexShrink: 0 }}>
            <StatusBadge kind="ticket" value={ticket.status} />
            {menu}
          </Group>
        </Group>
        <Text size="sm" c="dimmed">{meta.filter(Boolean).join(' · ')}</Text>
        {ticket.vendor && <Text size="sm">{`${he.tickets.vendor}: ${ticket.vendor}`}</Text>}
        {ticket.description && <Text style={{ whiteSpace: 'pre-wrap' }}>{ticket.description}</Text>}
        <TicketPhotos photos={ticket.photos} />
      </Stack>
    </Card>
  )
}

function Dialogs({ ticket, dialog, close }: { ticket: TicketDetail; dialog: Dialog; close: () => void }) {
  const navigate = useNavigate()
  const del = useDeleteTicket()
  const onDelete = () =>
    del.mutate({ id: ticket.id, paths: ticket.photos.map((p) => p.path) }, {
      onSuccess: () => { notifySuccess(he.tickets.deleted); void navigate('/tickets', { replace: true }) },
    })
  return (
    <>
      <FormModal opened={dialog === 'edit'} title={he.tickets.edit} onClose={close}>
        {dialog === 'edit' && <TicketForm ticket={ticket} onDone={close} />}
      </FormModal>
      <ConfirmDialog opened={dialog === 'delete'} title={he.tickets.deleteConfirm(ticket.title)} body={he.tickets.deleteBody}
        confirmLabel={he.tickets.delete} loading={del.isPending} failed={del.isError} onClose={close} onConfirm={onDelete} />
    </>
  )
}

/** One service call: details, photos, admin controls and the comment thread. */
export default function TicketPage() {
  const { id = '' } = useParams()
  const { isAdmin, session } = useAuth()
  const query = useTicket(id)
  const [dialog, setDialog] = useState<Dialog>(null)
  const ticket = query.data
  if (query.isLoading) return <ListSkeleton />
  if (!ticket) return <Stack align="flex-start"><BackLink /><Text>{query.isError ? he.tickets.errors.load : he.tickets.notFound}</Text></Stack>
  const canEdit = isAdmin || (ticket.opened_by === session?.user.id && ticket.status === 'open')
  const menu = <ActionsMenu canEdit={canEdit} canDelete={isAdmin} setDialog={setDialog} />
  return (
    <Stack gap="md">
      <BackLink />
      <Summary ticket={ticket} menu={menu} />
      {isAdmin && <AdminControls key={`${ticket.id}-${ticket.vendor ?? ''}`} ticket={ticket} />}
      <TicketComments ticketId={ticket.id} comments={ticket.comments} />
      <Dialogs ticket={ticket} dialog={dialog} close={() => setDialog(null)} />
    </Stack>
  )
}
