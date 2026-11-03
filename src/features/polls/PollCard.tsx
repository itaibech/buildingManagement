import { Badge, Card, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconCheck, IconChevronLeft } from '@tabler/icons-react'
import { Link } from 'react-router'
import { he } from '../../lib/he'
import { StatusBadge } from '../../ui'
import { badgeOf, phaseOf } from './lifecycle'
import { windowText } from './text'
import type { Poll } from './types'

const P = he.polls

/** One poll in a list: state, question, kind and time; "הצבעתם" once the apartment voted. Opens the poll page. */
export function PollCard({ poll, voted }: { poll: Poll; voted: boolean }) {
  const phase = phaseOf(poll)
  return (
    <Card padding={0}>
      <UnstyledButton component={Link} to={`/polls/${poll.id}`} p="md" mih={44} className="bm-row" style={{ display: 'block' }}>
        <Group wrap="nowrap" gap="sm" align="center">
          <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
            <Group gap="xs" wrap="wrap">
              <StatusBadge kind="poll" value={badgeOf(phase)} />
              <Text size="sm" c="dimmed">{P.kinds[poll.kind]}</Text>
              {voted && (
                <Badge color="paid" c="paid.9" leftSection={<IconCheck size={12} stroke={2} aria-hidden="true" />}>{P.home.voted}</Badge>
              )}
            </Group>
            <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{poll.question}</Text>
            <Text size="sm" c="dimmed" className="bm-num">{windowText(poll, phase)}</Text>
          </Stack>
          <IconChevronLeft size={18} stroke={1.75} aria-hidden="true" />
        </Group>
      </UnstyledButton>
    </Card>
  )
}
