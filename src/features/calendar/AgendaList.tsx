import { Card, Stack, Title } from '@mantine/core'
import { dayTitle } from './display'
import { OccurrenceRow } from './EventParts'
import { groupByDay } from './recurrence'
import type { Occurrence } from './types'

/** The agenda: one card per day with events (a multi-day event under each of its days). */
export function AgendaList({ occurrences, from, to, today, onOpen }: {
  occurrences: readonly Occurrence[]; from: string; to: string; today: string; onOpen: (o: Occurrence) => void
}) {
  const days = [...groupByDay(occurrences, from, to)]
  return (
    <Stack gap="md">
      {days.map(([day, list]) => (
        <Card key={day} padding="sm" component="section" aria-label={dayTitle(day, today)}>
          <Title order={2} size="h4" px="sm" pt={4} pb={6} c={day === today ? 'enamel.7' : undefined}>{dayTitle(day, today)}</Title>
          <Stack gap={0}>
            {list.map((o) => <OccurrenceRow key={o.key} o={o} onOpen={onOpen} />)}
          </Stack>
        </Card>
      ))}
    </Stack>
  )
}
