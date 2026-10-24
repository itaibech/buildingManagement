import { Button, Group, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { he } from '../../lib/he'
import type { Notice } from './rules'

// Live notices: top-centre, at most 3 on screen. When a 4th arrives, the newest notice and every later one
// collapse into a single "ועוד N עדכונים" toast (the notification center still lists them all).
const MAX = 3
const MORE_ID = 'bm-notice-more'
const AUTO_CLOSE = 8000
const POSITION = 'top-center'

let shown: string[] = []
let more = 0
let seq = 0

/** Forget what is on screen (tests, and after notifications.clean()). */
export function resetNotices(): void {
  shown = []
  more = 0
}

function showMore(): void {
  const message = he.notifications.more(more)
  if (more > 2) {
    notifications.update({ id: MORE_ID, message })
    return
  }
  notifications.show({
    id: MORE_ID, message, position: POSITION, color: 'signal', withBorder: true, autoClose: AUTO_CLOSE,
    onClose: () => { more = 0 },
  })
}

/** The toast body: the second line and the "לצפייה" action (a render helper, not a component). */
function noticeBody(notice: Notice, onView: () => void) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      <Text size="sm" c="dimmed" truncate="end" style={{ minWidth: 0 }}>{notice.detail}</Text>
      <Button variant="light" color="enamel" mih={44} onClick={onView} style={{ flexShrink: 0 }}>{he.notifications.view}</Button>
    </Group>
  )
}

/** Shows a notice toast whose "לצפייה" calls `onOpen` (navigate to the item) and closes it. */
export function showNotice(notice: Notice, onOpen: () => void): void {
  if (more > 0) {
    more += 1
    showMore()
    return
  }
  if (shown.length >= MAX) {
    const newest = shown.pop()
    if (newest) notifications.hide(newest)
    more = 2
    showMore()
    return
  }
  seq += 1
  const id = `bm-notice-${seq}`
  shown.push(id)
  const onView = () => {
    onOpen()
    notifications.hide(id)
  }
  notifications.show({
    id, title: notice.text, message: noticeBody(notice, onView), position: POSITION,
    color: 'signal', withBorder: true, autoClose: AUTO_CLOSE,
    onClose: () => { shown = shown.filter((s) => s !== id) },
  })
}
