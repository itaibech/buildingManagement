import { Anchor, Badge, Box, Button, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconBrandGoogle, IconCalendarPlus, IconPencil, IconTrash } from '@tabler/icons-react'
import { Link } from 'react-router'
import { he } from '../../lib/he'
import { CALENDAR_COLOR, StatusBadge } from '../../ui'
import { dayTitle, recurrenceLabel, timeLabel } from './display'
import { downloadIcs, googleCalendarUrl } from './ics'
import type { CalendarItem, Occurrence } from './types'

const C = he.calendar
const ICON = { size: 20, stroke: 1.75, 'aria-hidden': true } as const

/** "ניקיון · 09:00–11:00 · לובי". */
const summaryOf = (o: Occurrence): string => [C.categories[o.item.category], timeLabel(o), o.item.location].filter(Boolean).join(' · ')

/** A tappable occurrence: the category colour bar, title, and category / time / place. */
export function OccurrenceRow({ o, onOpen }: { o: Occurrence; onOpen: (o: Occurrence) => void }) {
  return (
    <UnstyledButton className="bm-row" mih={56} px="sm" py={6} onClick={() => onOpen(o)} data-category={o.item.category}
      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', borderRadius: 10 }}>
      <Box w={4} aria-hidden="true" style={{ alignSelf: 'stretch', borderRadius: 2, background: `var(--mantine-color-${CALENDAR_COLOR[o.item.category]}-6)` }} />
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} truncate="end">{o.item.title}</Text>
        <Text size="sm" c="dimmed" className="bm-num">{summaryOf(o)}</Text>
      </Stack>
      {o.item.committee && <Badge color="stone" c="stone.9" size="md">{C.committeeOnly}</Badge>}
    </UnstyledButton>
  )
}

/** "הוספה ליומן שלי": the .ics download and the Google Calendar template link. */
function AddToCalendar({ item }: { item: CalendarItem }) {
  return (
    <Stack gap="xs">
      <Text fw={600}>{C.addToCalendar}</Text>
      <Button variant="light" leftSection={<IconCalendarPlus {...ICON} />} onClick={() => downloadIcs(item)}>{C.downloadIcs}</Button>
      <Button variant="light" component="a" href={googleCalendarUrl(item)} target="_blank" rel="noopener noreferrer"
        leftSection={<IconBrandGoogle {...ICON} />}>
        {C.google}
      </Button>
    </Stack>
  )
}

export interface DetailActions { onEdit: (item: CalendarItem) => void; onDelete: (item: CalendarItem) => void }

/** The occurrence's details, the way to add it to a personal calendar, and (admins, own events) edit and delete. */
export function EventDetails({ o, today, actions }: { o: Occurrence; today: string; actions?: DetailActions }) {
  const { item } = o
  const rule = recurrenceLabel(item)
  return (
    <Stack gap="md">
      <Group gap="xs">
        <StatusBadge kind="calendar" value={item.category} />
        {item.committee && <Badge color="stone" c="stone.9">{C.committeeOnly}</Badge>}
      </Group>
      <Stack gap={2}>
        <Text fw={600}>{dayTitle(o.day, today)}</Text>
        <Text className="bm-num">{timeLabel(o)}</Text>
        {rule && <Text size="sm" c="dimmed">{rule}</Text>}
        {item.location && <Text>{item.location}</Text>}
      </Stack>
      {item.description && <Text style={{ whiteSpace: 'pre-wrap' }}>{item.description}</Text>}
      {item.link && (
        <Text size="sm" c="dimmed">
          {C.sources[item.source].from} · <Anchor component={Link} to={item.link} fw={600}>{C.sources[item.source].open}</Anchor>
        </Text>
      )}
      <AddToCalendar item={item} />
      {actions && item.source === 'event' && (
        <Group grow>
          <Button variant="default" leftSection={<IconPencil {...ICON} />} onClick={() => actions.onEdit(item)}>{C.edit}</Button>
          <Button variant="light" color="debt" leftSection={<IconTrash {...ICON} />} onClick={() => actions.onDelete(item)}>{C.delete}</Button>
        </Group>
      )}
    </Stack>
  )
}
