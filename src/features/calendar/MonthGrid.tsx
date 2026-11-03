import { ActionIcon, Box, Button, Card, Group, SimpleGrid, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import { formatDate, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { CALENDAR_COLOR } from '../../ui'
import { dayTitle } from './display'
import { OccurrenceRow } from './EventParts'
import { addDays, monthRange, shiftMonth } from './recurrence'
import type { Occurrence } from './types'

const C = he.calendar
const MAX_CHIPS = 2

function DayCell({ day, month, today, list, selected, onSelect }: {
  day: string; month: string; today: string; list: Occurrence[]; selected: boolean; onSelect: (day: string) => void
}) {
  const outside = !day.startsWith(month)
  return (
    <UnstyledButton onClick={() => onSelect(day)} aria-pressed={selected} aria-label={C.dayLabel(formatDate(day), list.length)} mih={56} p={4}
      style={{ borderRadius: 8, border: `1px solid ${selected ? 'var(--mantine-color-enamel-6)' : 'transparent'}`, opacity: outside ? 0.5 : 1, minWidth: 0 }}>
      <Text size="sm" fw={day === today ? 700 : 400} c={day === today ? 'enamel.7' : undefined} className="bm-num">{Number(day.slice(8))}</Text>
      <Stack gap={2}>
        {list.slice(0, MAX_CHIPS).map((o) => (
          <Box key={o.key} px={4} style={{ borderRadius: 4, background: `var(--mantine-color-${CALENDAR_COLOR[o.item.category]}-1)`,
            borderInlineStart: `3px solid var(--mantine-color-${CALENDAR_COLOR[o.item.category]}-6)` }}>
            <Text size="xs" truncate="end" visibleFrom="sm">{o.item.title}</Text>
            <Box hiddenFrom="sm" h={4} />
          </Box>
        ))}
        {list.length > MAX_CHIPS && <Text size="xs" c="dimmed">{C.moreInDay(list.length - MAX_CHIPS)}</Text>}
      </Stack>
    </UnstyledButton>
  )
}

function MonthNav({ month, onMonth }: { month: string; onMonth: (m: string) => void }) {
  return (
    <Group justify="space-between" wrap="nowrap">
      {/* RTL: "previous" points right, "next" points left. */}
      <ActionIcon variant="subtle" size={44} aria-label={C.prevMonth} onClick={() => onMonth(shiftMonth(month, -1))}><IconChevronRight size={22} stroke={1.75} /></ActionIcon>
      <Title order={2} size="h3">{monthLabel(month)}</Title>
      <ActionIcon variant="subtle" size={44} aria-label={C.nextMonth} onClick={() => onMonth(shiftMonth(month, 1))}><IconChevronLeft size={22} stroke={1.75} /></ActionIcon>
    </Group>
  )
}

export interface MonthGridProps {
  month: string; days: Map<string, Occurrence[]>; today: string; selected: string
  onMonth: (m: string) => void; onSelect: (day: string) => void; onOpen: (o: Occurrence) => void
}

/** A month of whole weeks (Sunday first), chips per day on desktop and colour marks on mobile, the selected day's list below. */
export function MonthGrid({ month, days, today, selected, onMonth, onSelect, onOpen }: MonthGridProps) {
  const { from, to } = monthRange(month)
  const cells: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) cells.push(d)
  const picked = days.get(selected) ?? []
  return (
    <Stack gap="md">
      <Card padding="sm">
        <MonthNav month={month} onMonth={onMonth} />
        <Button variant="subtle" size="compact-md" mih={44} onClick={() => { onMonth(today.slice(0, 7)); onSelect(today) }} style={{ alignSelf: 'center' }}>{C.thisMonth}</Button>
        <SimpleGrid cols={7} spacing={2} verticalSpacing={2} mt="xs">
          {C.weekdaysShort.map((w) => <Text key={w} size="xs" c="dimmed" ta="center" aria-hidden="true">{w}</Text>)}
          {cells.map((d) => <DayCell key={d} day={d} month={month} today={today} list={days.get(d) ?? []} selected={d === selected} onSelect={onSelect} />)}
        </SimpleGrid>
      </Card>
      <Card padding="sm" component="section" aria-label={dayTitle(selected, today)}>
        <Title order={2} size="h4" px="sm" pt={4} pb={6}>{dayTitle(selected, today)}</Title>
        {picked.length === 0 && <Text c="dimmed" px="sm" pb="xs">{C.emptyDay}</Text>}
        {picked.map((o) => <OccurrenceRow key={o.key} o={o} onOpen={onOpen} />)}
      </Card>
    </Stack>
  )
}
