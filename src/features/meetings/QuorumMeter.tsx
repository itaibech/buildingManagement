import { Badge, Card, Group, Progress, Text } from '@mantine/core'
import { IconCheck, IconX } from '@tabler/icons-react'
import { he } from '../../lib/he'
import type { QuorumState } from './quorum'

const L = he.meetings.live

/** "נוכחות: 9 מתוך 17 דירות · נדרש מניין: 9 ✓", live, pinned at the top while scrolling the list. */
export function QuorumMeter({ q }: { q: QuorumState }) {
  const color = q.valid ? 'paid' : 'debt'
  const label = q.none ? L.quorumNone : q.met ? L.quorumMet : q.valid ? L.quorumPostponed : L.quorumMissing
  return (
    <Card padding="sm" className="bm-sticky" aria-live="polite">
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Text fw={600} className="bm-num">{L.meter(q.attending, q.total, q.required)}</Text>
        <Badge color={color} c={`${color}.9`} style={{ flexShrink: 0 }} leftSection={q.valid ? <IconCheck size={14} /> : <IconX size={14} />}>
          {label}
        </Badge>
      </Group>
      <Progress mt="xs" value={q.total ? Math.min(100, (q.attending / q.total) * 100) : 0} color={color} size="sm"
        aria-label={L.meter(q.attending, q.total, q.required)} />
    </Card>
  )
}
