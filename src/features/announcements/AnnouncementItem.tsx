import { Badge, Box, Card, Collapse, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconChevronDown, IconPin } from '@tabler/icons-react'
import { useRef, useState } from 'react'
import { formatDate } from '../../lib/format'
import { he } from '../../lib/he'
import type { AnnouncementItem as Item } from './api'

function UnreadDot() {
  return <Box role="img" aria-label={he.announcements.unread} w={10} h={10} bg="signal.6" style={{ borderRadius: '50%', flexShrink: 0 }} />
}

function Meta({ a, expired }: { a: Item; expired: boolean }) {
  const expiry = a.expires_at ? (expired ? he.announcements.expiredOn : he.announcements.expiresOn)(formatDate(a.expires_at)) : null
  return (
    <Text size="sm" c="dimmed" className="bm-num">
      {[formatDate(a.created_at), expiry].filter(Boolean).join(' · ')}
    </Text>
  )
}

export interface AnnouncementItemProps {
  item: Item
  expired?: boolean
  /** Called the first time an unread item is opened. */
  onOpen?: (item: Item) => void
}

/** One announcement: tap the header to read it. Opening an unread item marks it read. */
export function AnnouncementItem({ item, expired = false, onOpen }: AnnouncementItemProps) {
  const [opened, setOpened] = useState(false)
  const reported = useRef(false)
  const toggle = () => {
    if (!opened && !item.isRead && !reported.current) {
      reported.current = true
      onOpen?.(item)
    }
    setOpened(!opened)
  }
  return (
    <Card padding={0} data-testid={`announcement-${item.id}`} style={expired ? { opacity: 0.8 } : undefined}>
      <UnstyledButton onClick={toggle} aria-expanded={opened} w="100%" mih={44} p="md" className="bm-row">
        <Group wrap="nowrap" gap="sm" align="center">
          {!item.isRead && !expired ? <UnreadDot /> : <Box w={10} style={{ flexShrink: 0 }} />}
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text fw={item.isRead ? 400 : 600} truncate={opened ? undefined : 'end'}>{item.title}</Text>
            <Group gap="xs" wrap="wrap">
              {item.pinned && <Badge size="md" color="enamel" c="enamel.9" leftSection={<IconPin size={14} stroke={1.75} />}>{he.announcements.pinnedLabel}</Badge>}
              <Meta a={item} expired={expired} />
            </Group>
          </Stack>
          <IconChevronDown size={20} stroke={1.75} aria-hidden="true" style={{ transform: opened ? 'rotate(180deg)' : undefined }} />
        </Group>
      </UnstyledButton>
      <Collapse expanded={opened}>
        <Text px="md" pb="md" style={{ whiteSpace: 'pre-wrap' }}>{item.body}</Text>
      </Collapse>
    </Card>
  )
}
