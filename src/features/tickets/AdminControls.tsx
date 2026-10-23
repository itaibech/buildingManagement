import { Button, Card, Group, Input, SegmentedControl, Stack, TextInput, Title } from '@mantine/core'
import { useState } from 'react'
import { he } from '../../lib/he'
import { notifyError, notifySuccess } from '../../ui'
import { TICKET_STATUSES, useUpdateTicket, type Ticket } from './api'

const STATUS_OPTIONS = TICKET_STATUSES.map((s) => ({ value: s, label: he.ticketStatus[s] }))

/** Admin: status (saved on change) and vendor (saved with its button). */
export function AdminControls({ ticket }: { ticket: Ticket }) {
  const update = useUpdateTicket()
  const [vendor, setVendor] = useState(ticket.vendor ?? '')
  const onError = () => notifyError(he.toast.failed)
  const setStatus = (status: string) => {
    const next = TICKET_STATUSES.find((s) => s === status)
    if (!next || next === ticket.status) return
    update.mutate({ id: ticket.id, patch: { status: next } }, { onSuccess: () => notifySuccess(he.tickets.statusUpdated), onError })
  }
  const saveVendor = () =>
    update.mutate({ id: ticket.id, patch: { vendor: vendor.trim() || null } }, { onSuccess: () => notifySuccess(he.tickets.vendorSaved), onError })
  return (
    <Card padding="md">
      <Stack gap="md">
        <Title order={2} size="h4">{he.tickets.adminControls}</Title>
        <Input.Wrapper label={he.tickets.status}>
          <SegmentedControl fullWidth mt={4} size="md" data={STATUS_OPTIONS} value={ticket.status} onChange={setStatus} />
        </Input.Wrapper>
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <TextInput style={{ flex: 1 }} label={he.tickets.vendor} placeholder={he.tickets.vendorPlaceholder}
            value={vendor} onChange={(e) => setVendor(e.currentTarget.value)} />
          <Button variant="light" onClick={saveVendor} disabled={vendor.trim() === (ticket.vendor ?? '')}>{he.tickets.saveVendor}</Button>
        </Group>
      </Stack>
    </Card>
  )
}
