import { ActionIcon, Badge, Box, Card, Collapse, Group, Menu, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconChevronDown, IconDots, IconMail, IconPencil, IconPin, IconTrash } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { formatDate } from '../../lib/format'
import { he } from '../../lib/he'
import { UnreadDot } from '../../ui/UnreadDot'
import type { AnnouncementItem as Item } from './api'

function Meta({ a, expired }: { a: Item; expired: boolean }) {
  const expiry = a.expires_at ? (expired ? he.announcements.expiredOn : he.announcements.expiresOn)(formatDate(a.expires_at)) : null
  return (
    <Text size="sm" c="dimmed" className="bm-num">
      {[formatDate(a.created_at), expiry].filter(Boolean).join(' · ')}
    </Text>
  )
}

export interface AdminActions {
  onEdit: (item: Item) => void
  onDelete: (item: Item) => void
  onEmail: (item: Item) => void
}

function ItemMenu({ item, actions }: { item: Item; actions: AdminActions }) {
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="stone.7" size={44} mx="xs" aria-label={he.announcements.actions(item.title)}>
          <IconDots size={20} stroke={1.75} aria-hidden="true" />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconPencil size={18} stroke={1.75} />} onClick={() => actions.onEdit(item)}>{he.announcements.edit}</Menu.Item>
        <Menu.Item leftSection={<IconMail size={18} stroke={1.75} />} onClick={() => actions.onEmail(item)}>{he.mail.send}</Menu.Item>
        <Menu.Item color="debt" leftSection={<IconTrash size={18} stroke={1.75} />} onClick={() => actions.onDelete(item)}>{he.announcements.delete}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

export interface AnnouncementItemProps {
  item: Item
  expired?: boolean
  /** Called the first time an unread item is opened. */
  onOpen?: (item: Item) => void
  /** Admin only: shows the edit/delete menu. */
  actions?: AdminActions
}

function Header({ item, expired, opened, onToggle }: { item: Item; expired: boolean; opened: boolean; onToggle: () => void }) {
  return (
    <UnstyledButton onClick={onToggle} aria-expanded={opened} mih={44} p="md" pb={opened ? 'xs' : undefined} className="bm-row" style={{ flex: 1, minWidth: 0 }}>
      <Group wrap="nowrap" gap="sm" align="center">
        {!item.isRead && !expired ? <UnreadDot label={he.announcements.unread} /> : <Box w={10} style={{ flexShrink: 0 }} />}
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
  )
}

/**
 * One announcement. Pinned and unread items open with their full body (an unread one is marked read once,
 * as it is shown); read items show a 2-line preview and expand on tap.
 */
export function AnnouncementItem({ item, expired = false, onOpen, actions }: AnnouncementItemProps) {
  const [opened, setOpened] = useState(() => item.pinned || (!item.isRead && !expired))
  const reported = useRef(false)
  const report = useRef(onOpen)
  useEffect(() => {
    report.current = onOpen
  })
  useEffect(() => {
    if (opened && !item.isRead && !reported.current) {
      reported.current = true
      report.current?.(item)
    }
  }, [opened, item])
  return (
    <Card padding={0} data-testid={`announcement-${item.id}`} style={expired ? { opacity: 0.8 } : undefined}>
      <Group wrap="nowrap" gap={0} align="center">
        <Header item={item} expired={expired} opened={opened} onToggle={() => setOpened(!opened)} />
        {actions && <ItemMenu item={item} actions={actions} />}
      </Group>
      {!opened && (
        <Text data-testid="announcement-preview" px="md" pb="md" mt={-8} ps={44} c="dimmed" size="sm" lineClamp={2}>{item.body}</Text>
      )}
      <Collapse expanded={opened}>
        <Text px="md" pb="md" ps={44} style={{ whiteSpace: 'pre-wrap' }}>{item.body}</Text>
      </Collapse>
    </Card>
  )
}
