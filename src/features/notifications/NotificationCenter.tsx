import { ActionIcon, Box, Button, Divider, Group, Modal, Popover, ScrollArea, Stack, Switch, Text, UnstyledButton } from '@mantine/core'
import { IconBell, IconSpeakerphone, IconTool } from '@tabler/icons-react'
import { useState, type Ref } from 'react'
import { useNavigate } from 'react-router'
import { relativeDate } from '../../lib/format'
import { he } from '../../lib/he'
import { UnreadDot } from '../../ui/UnreadDot'
import { useMarkRead } from '../announcements/api'
import { useMarkAllRead, useMarkTicketsSeen, useNotificationCount, useNotificationFeed } from './api'
import type { FeedItem } from './feed'
import { disableSystem, enableSystem, systemDenied, systemEnabled, systemSupported } from './system'

const ICON = { size: 22, stroke: 1.75 } as const

function FeedRow({ item, onPick }: { item: FeedItem; onPick: (item: FeedItem) => void }) {
  const Icon = item.kind === 'announcement' ? IconSpeakerphone : IconTool
  return (
    <UnstyledButton onClick={() => onPick(item)} mih={44} px="sm" py="xs" className="bm-row" style={{ borderRadius: 10 }}>
      <Group wrap="nowrap" gap="sm" align="center">
        <Icon {...ICON} color="var(--mantine-color-stone-7)" aria-hidden="true" style={{ flexShrink: 0 }} />
        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={item.unseen ? 600 : 400} truncate="end">{item.title}</Text>
          <Text size="sm" c="dimmed" truncate="end">{`${item.subtitle} · ${relativeDate(item.at)}`}</Text>
        </Stack>
        {item.unseen ? <UnreadDot label={he.notifications.unseen} /> : <Box w={10} style={{ flexShrink: 0 }} />}
      </Group>
    </UnstyledButton>
  )
}

/** Opt-in system notifications; the preference lives in localStorage, the permission in the browser. */
function SystemToggle() {
  const [supported, setSupported] = useState(systemSupported)
  const [on, setOn] = useState(systemEnabled)
  const [denied, setDenied] = useState(systemDenied)
  const toggle = async (next: boolean) => {
    if (!next) {
      disableSystem()
      setOn(false)
      return
    }
    const result = await enableSystem()
    setOn(result === 'granted')
    setDenied(result === 'denied')
    setSupported(result !== 'unsupported')
  }
  const hint = !supported ? he.notifications.systemUnsupported : denied ? he.notifications.systemDenied : he.notifications.systemHint
  return (
    <Switch label={he.notifications.system} description={hint} checked={on} disabled={!supported} size="md"
      onChange={(e) => void toggle(e.currentTarget.checked)} styles={{ body: { alignItems: 'center', minHeight: 44 } }} />
  )
}

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const feed = useNotificationFeed()
  const count = useNotificationCount()
  const markAll = useMarkAllRead()
  const markRead = useMarkRead().mutate
  const markSeen = useMarkTicketsSeen().mutate
  const navigate = useNavigate()
  const pick = (item: FeedItem) => {
    if (item.unseen && item.kind === 'announcement') markRead(item.id)
    if (item.unseen && item.kind === 'ticket') markSeen([item.id])
    onClose()
    void navigate(item.path)
  }
  return (
    <Stack gap="xs">
      <Group justify="flex-end">
        <Button variant="subtle" color="enamel" mih={44} disabled={count === 0} onClick={markAll}>{he.notifications.markAll}</Button>
      </Group>
      {feed.length === 0 && <Text c="dimmed" py="md" ta="center">{he.notifications.empty}</Text>}
      {feed.map((item) => <FeedRow key={item.key} item={item} onPick={pick} />)}
      <Divider color="stone.1" />
      <SystemToggle />
    </Stack>
  )
}

/** `ref` is passed through so the Popover can anchor to the button. */
function BellButton({ count, onClick, ref }: { count: number; onClick?: () => void; ref?: Ref<HTMLButtonElement> }) {
  return (
    <ActionIcon ref={ref} variant="subtle" color="stone.7" size={44} aria-label={he.notifications.bell(count)} onClick={onClick}>
      <span className="bm-tab-icon">
        <IconBell {...ICON} aria-hidden="true" />
        {count > 0 && <span className="bm-unread" aria-hidden="true">{count > 9 ? '9+' : count}</span>}
      </span>
    </ActionIcon>
  )
}

/** The notification center: a bell with the unseen total. `sheet`: a full-screen sheet (mobile) instead of a popover. */
export function NotificationBell({ sheet = false }: { sheet?: boolean }) {
  const [opened, setOpened] = useState(false)
  const count = useNotificationCount()
  const close = () => setOpened(false)
  if (sheet) {
    return (
      <>
        <BellButton count={count} onClick={() => setOpened(true)} />
        <Modal opened={opened} onClose={close} title={he.notifications.title} fullScreen
          styles={{ title: { fontFamily: 'var(--bm-heading-font)', fontSize: '1.375rem' } }}>
          {opened && <NotificationPanel onClose={close} />}
        </Modal>
      </>
    )
  }
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" width={360} shadow="md" radius="lg" withinPortal trapFocus hideDetached={false}>
      <Popover.Target>
        <BellButton count={count} onClick={() => setOpened((o) => !o)} />
      </Popover.Target>
      <Popover.Dropdown p="sm" aria-label={he.notifications.title}>
        <Text className="bm-display" fz="lg" mb={4}>{he.notifications.title}</Text>
        <ScrollArea.Autosize mah="70vh" type="auto">
          {opened && <NotificationPanel onClose={close} />}
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  )
}
