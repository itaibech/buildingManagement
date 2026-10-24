import { Group, Select, Stack, TextInput } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { useState } from 'react'
import { he } from '../../lib/he'
import { EmptyState } from '../../ui'
import { matchesArchive, meetingYear } from './lifecycle'
import { MeetingCard } from './MeetingCard'
import type { MeetingListItem } from './types'

/** Published protocols, searchable by subject, decision text and year. */
export function ArchiveList({ meetings, showStatus }: { meetings: readonly MeetingListItem[]; showStatus: boolean }) {
  const [query, setQuery] = useState('')
  const [year, setYear] = useState<string | null>(null)
  const years = [...new Set(meetings.map((m) => String(meetingYear(m.scheduled_at))))].sort().reverse()
  const shown = meetings.filter((m) => matchesArchive(m, query, year ? Number(year) : null))
  if (!meetings.length) return <EmptyState title={he.meetings.emptyArchive} body={he.meetings.emptyArchiveBody} />
  return (
    <Stack gap="sm">
      <Group gap="sm" grow preventGrowOverflow={false} wrap="wrap">
        <TextInput aria-label={he.meetings.search} placeholder={he.meetings.search} leftSection={<IconSearch size={18} stroke={1.75} />}
          value={query} onChange={(e) => setQuery(e.currentTarget.value)} style={{ minWidth: 220 }} />
        <Select aria-label={he.meetings.year} placeholder={he.meetings.allYears} data={years} value={year} onChange={setYear} clearable
          maw={{ sm: 160 }} />
      </Group>
      {shown.length === 0 && <EmptyState title={he.meetings.noResults} />}
      {shown.map((m) => <MeetingCard key={m.id} meeting={m} showStatus={showStatus} />)}
    </Stack>
  )
}
