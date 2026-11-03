import { Button, Card, Group, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { Link } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { useMyVotes, usePolls } from './api'
import { inScope, phaseOf } from './lifecycle'
import { windowText } from './text'

const H = he.polls.home

/** Home: open polls the user's apartment may vote in and hasn't yet; nothing when there are none. */
export function HomePollsCard() {
  const { can } = useAuth()
  const allowed = can('polls')
  const polls = usePolls(allowed)
  const mine = useMyVotes()
  if (!allowed || !polls.data || !mine.votes) return null
  const waiting = polls.data
    .filter((p) => phaseOf(p) === 'voting' && inScope(p, mine.apartmentId) && !mine.votes?.has(p.id))
    .sort((a, b) => a.closes_at.localeCompare(b.closes_at))
  if (waiting.length === 0) return null
  return (
    <Card style={{ borderColor: 'var(--mantine-color-signal-4)' }}>
      <Title order={2} size="h4" mb="xs">{H.title}</Title>
      <Stack gap="xs">
        {waiting.map((p) => (
          <UnstyledButton key={p.id} component={Link} to={`/polls/${p.id}`} className="bm-row" mih={44} py={4} style={{ borderRadius: 10 }}>
            <Group justify="space-between" wrap="nowrap" gap="sm">
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{p.question}</Text>
                <Text size="sm" c="dimmed" className="bm-num">{windowText(p, 'voting')}</Text>
              </Stack>
              <Button component="span" color="signal" size="compact-md" mih={44} style={{ flexShrink: 0 }}>{H.cta}</Button>
            </Group>
          </UnstyledButton>
        ))}
      </Stack>
    </Card>
  )
}
