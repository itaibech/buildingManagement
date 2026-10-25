import { Anchor, Button, Card, Group, Stack, Text, Title } from '@mantine/core'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { he } from '../../lib/he'

const LINK_STYLE = { display: 'inline-flex', alignItems: 'center' } as const

/** Dimmed failure line with a retry button, shown instead of content when a section's query fails. */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Group gap="sm" justify="space-between">
      <Text size="sm" c="dimmed">{he.home.loadFailed}</Text>
      <Button variant="subtle" mih={44} onClick={onRetry}>{he.home.retry}</Button>
    </Group>
  )
}

/**
 * A home section: heading, content, and a link to the full page. `flush`: the content is tappable rows (finance Row,
 * padded on their own), pulled out to the card's padding so their text lines up with the heading.
 */
export function Section({ title, to, linkLabel, children, flush = false }: { title: string; to: string; linkLabel: string; children: ReactNode; flush?: boolean }) {
  return (
    <Card>
      <Title order={2} size="h4" mb="xs">{title}</Title>
      <Stack gap={flush ? 0 : 'xs'} mx={flush ? -16 : 0}>{children}</Stack>
      <Anchor component={Link} to={to} fw={600} mih={44} mt="xs" style={LINK_STYLE}>{linkLabel}</Anchor>
    </Card>
  )
}
