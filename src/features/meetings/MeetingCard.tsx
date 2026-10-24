import { Card, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconChevronLeft } from '@tabler/icons-react'
import { Link } from 'react-router'
import { he } from '../../lib/he'
import { StatusBadge } from '../../ui'
import { meetingDate, meetingTime } from './fmt'
import type { Meeting } from './types'

/** One meeting in a list: type, subject, time and place; the state badge for admins. Opens the meeting page. */
export function MeetingCard({ meeting: m, showStatus }: { meeting: Meeting; showStatus: boolean }) {
  return (
    <Card padding={0}>
      <UnstyledButton component={Link} to={`/meetings/${m.id}`} p="md" mih={44} className="bm-row" style={{ display: 'block' }}>
        <Group wrap="nowrap" gap="sm" align="center">
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" wrap="wrap">
              <Text size="sm" c="dimmed">{he.meetings.kinds[m.kind]}</Text>
              {showStatus && <StatusBadge kind="meeting" value={m.status} />}
            </Group>
            <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{m.title}</Text>
            <Text size="sm" c="dimmed" className="bm-num">
              {[he.meetings.when(meetingDate(m.scheduled_at), meetingTime(m.scheduled_at)), m.location].filter(Boolean).join(' · ')}
            </Text>
          </Stack>
          <IconChevronLeft size={18} stroke={1.75} aria-hidden="true" />
        </Group>
      </UnstyledButton>
    </Card>
  )
}
