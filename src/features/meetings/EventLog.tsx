import { Card, Stack, Text, Title } from '@mantine/core'
import { he } from '../../lib/he'
import { useMeetingEvents } from './api'
import { meetingDate, meetingTime } from './fmt'

/** Admin: the meeting's audit trail (invitations, updates, postponement, open, close, signatures, publication). */
export function EventLog({ meetingId }: { meetingId: string }) {
  const events = useMeetingEvents(meetingId, true)
  if (!events.data?.length) return null
  return (
    <Card>
      <Stack gap="xs">
        <Title order={2} size="h4">{he.meetings.history}</Title>
        {events.data.map((e) => (
          <Text key={e.id} size="sm" className="bm-num">
            {`${meetingDate(e.created_at)} ${meetingTime(e.created_at)} · ${he.meetings.events[e.kind] ?? e.kind}`}
          </Text>
        ))}
      </Stack>
    </Card>
  )
}
