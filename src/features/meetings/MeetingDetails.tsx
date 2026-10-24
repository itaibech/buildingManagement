import { Card, List, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { he } from '../../lib/he'
import { sortAgenda } from './decisions'
import { meetingDate, meetingTime } from './fmt'
import { quorumText } from './quorum'
import type { MeetingDetail } from './types'

function Field({ label, children }: { label: string; children: string }) {
  return (
    <Stack gap={0}>
      <Text size="sm" c="dimmed">{label}</Text>
      <Text fw={600} className="bm-num" style={{ overflowWrap: 'anywhere' }}>{children}</Text>
    </Stack>
  )
}

/** Type, time, place, quorum rule and the agenda: what an invitation says (residents and admins). */
export function MeetingDetails({ meeting: m, total }: { meeting: MeetingDetail; total: number | null }) {
  const agenda = sortAgenda(m.items).filter((i) => i.item_status === 'open')
  return (
    <Card>
      <Stack gap="md">
        <Title order={2} size="h4">{he.meetings.details}</Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Field label={he.meetings.kindLabel}>{he.meetings.kinds[m.kind]}</Field>
          <Field label={he.meetings.dateLabel}>{he.meetings.when(meetingDate(m.scheduled_at), meetingTime(m.scheduled_at))}</Field>
          <Field label={he.meetings.locationLabel}>{m.location || '—'}</Field>
          {total !== null && <Field label={he.meetings.quorumLabel}>{quorumText(m, total)}</Field>}
        </SimpleGrid>
        <Stack gap={4}>
          <Text size="sm" c="dimmed">{he.meetings.agendaLabel}</Text>
          <List type="ordered" spacing={4}>
            {agenda.map((i) => <List.Item key={i.id}><Text style={{ overflowWrap: 'anywhere' }}>{i.title}</Text></List.Item>)}
          </List>
        </Stack>
        {m.invited_at && <Text size="sm" c="dimmed" className="bm-num">{he.meetings.invitedAt(meetingDate(m.invited_at))}</Text>}
      </Stack>
    </Card>
  )
}
