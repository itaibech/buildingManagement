import { Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton } from '../../ui'
import { LoadError, Section } from '../home/parts'
import { FormModal } from '../tenants/dialogs'
import { dayTitle, useUpcoming } from './display'
import { EventDetails, OccurrenceRow } from './EventParts'
import type { Occurrence } from './types'

const MAX = 3

/** Home: "השבוע בבניין", the next three events (any source), each opening its details and "הוספה ליומן שלי". */
export function WeekCard() {
  const q = useUpcoming()
  const [open, setOpen] = useState<Occurrence | null>(null)
  const next = q.occurrences.slice(0, MAX)
  return (
    <Section title={he.home.week} to="/calendar" linkLabel={he.home.allEvents} flush>
      {q.isLoading && <ListSkeleton rows={2} />}
      {q.isError && <LoadError onRetry={q.refetch} />}
      {!q.isLoading && !q.isError && next.length === 0 && <EmptyState title={he.home.noEvents} />}
      {next.map((o) => (
        <Stack key={o.key} gap={0}>
          <Text size="xs" c="dimmed" px="md">{dayTitle(o.day, q.today)}</Text>
          <OccurrenceRow o={o} onOpen={setOpen} />
        </Stack>
      ))}
      <FormModal compact opened={open !== null} title={open?.item.title ?? ''} onClose={() => setOpen(null)}>
        {open && <EventDetails o={open} today={q.today} />}
      </FormModal>
    </Section>
  )
}
