import { Button, Card, Divider, Group, Stack, Text, TextInput } from '@mantine/core'
import { IconPhone, IconSearch } from '@tabler/icons-react'
import { Fragment, useMemo, useState } from 'react'
import { he } from '../../lib/he'
import { AptPlate, EmptyState, ListSkeleton, PageHeader } from '../../ui'
import { useDirectory, type DirectoryEntry } from './api'

interface Group {
  number: number
  entries: DirectoryEntry[]
}

function matches(e: DirectoryEntry, q: string): boolean {
  return !q || e.full_name.includes(q) || String(e.apartmentNumber) === q
}

function groupByApartment(entries: DirectoryEntry[]): Group[] {
  const groups: Group[] = []
  for (const e of entries) {
    const last = groups.at(-1)
    if (last?.number === e.apartmentNumber) last.entries.push(e)
    else groups.push({ number: e.apartmentNumber, entries: [e] })
  }
  return groups
}

function ResidentLine({ r }: { r: DirectoryEntry }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm" mih={44}>
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Text fw={600} truncate>{r.full_name}</Text>
        <Text size="sm" c="dimmed">{r.is_owner ? he.tenants.owner : he.tenants.tenant}</Text>
      </Stack>
      {r.phone && (
        <Button component="a" href={`tel:${r.phone}`} variant="subtle" aria-label={he.tenants.call(r.full_name)}
          leftSection={<IconPhone size={18} stroke={1.75} />} className="bm-num" dir="ltr" px="xs">
          {r.phone}
        </Button>
      )}
    </Group>
  )
}

function ApartmentGroup({ group }: { group: Group }) {
  return (
    <Group align="flex-start" wrap="nowrap" gap="md" py="sm">
      <AptPlate number={group.number} size="sm" />
      <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
        {group.entries.map((r) => <ResidentLine key={r.id} r={r} />)}
      </Stack>
    </Group>
  )
}

/** Everyone's phone book: residents grouped by apartment, searchable by name or apartment number. */
export default function DirectoryPage() {
  const directory = useDirectory()
  const [query, setQuery] = useState('')
  const q = query.trim()
  const groups = useMemo(() => groupByApartment((directory.data ?? []).filter((e) => matches(e, q))), [directory.data, q])
  const empty = directory.data?.length === 0
  return (
    <Stack gap="md">
      <PageHeader title={he.nav.directory} />
      <TextInput aria-label={he.tenants.search} placeholder={he.tenants.searchPlaceholder} value={query}
        onChange={(e) => setQuery(e.currentTarget.value)} leftSection={<IconSearch size={18} stroke={1.75} />} type="search" />
      <Card padding="md">
        {directory.isError && <Text c="debt.7">{he.tenants.loadError}</Text>}
        {directory.isLoading && <ListSkeleton rows={5} />}
        {empty && <EmptyState title={he.tenants.directoryEmpty} body={he.tenants.directoryEmptyBody} />}
        {!empty && directory.data && groups.length === 0 && <EmptyState title={he.tenants.noMatches} />}
        {groups.map((g, i) => (
          <Fragment key={g.number}>
            {i > 0 && <Divider color="stone.1" />}
            <ApartmentGroup group={g} />
          </Fragment>
        ))}
      </Card>
    </Stack>
  )
}
