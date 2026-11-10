import { Card, Stack, Text, Title } from '@mantine/core'
import { he } from '../../lib/he'
import type { Ticket } from './api'
import { useTicketFiles } from './detailsApi'
import { TicketFiles } from './TicketFiles'

const T = he.ticketDetails

function Field({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null
  return (
    <Stack gap={2}>
      <Text fw={600} size="sm">{label}</Text>
      <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</Text>
    </Stack>
  )
}

/** "פרטי הטיפול", read-only: the suggested solution, what was done, and the files the committee shared. No cost. */
export function TreatmentCard({ ticket }: { ticket: Ticket }) {
  const files = useTicketFiles(ticket.id).data ?? []
  if (!ticket.suggested_solution.trim() && !ticket.fix_details.trim() && files.length === 0) return null
  return (
    <Card padding="md">
      <Stack gap="sm">
        <Title order={2} size="h4">{T.treatment}</Title>
        <Field label={T.suggestedSolution} value={ticket.suggested_solution} />
        <Field label={T.fixDetails} value={ticket.fix_details} />
        <TicketFiles ticketId={ticket.id} files={files} admin={false} />
      </Stack>
    </Card>
  )
}
