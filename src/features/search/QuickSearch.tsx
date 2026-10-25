import { Modal, Stack, Text, TextInput, Title, UnstyledButton } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { AptPlate } from '../../ui'
import { useAnnouncements } from '../announcements/api'
import { useDirectory, useApartments } from '../tenants/api'
import { useDesktop } from '../finance/hooks'
import { useTickets } from '../tickets/api'
import { searchAll, type SearchData, type SearchResults } from './match'

const S = he.search

/** What the user may already see, from the queries the pages use (RLS decides; permissions hide the rest). */
function useSearchData(): SearchData {
  const { isAdmin, can } = useAuth()
  const people = isAdmin || can('directory')
  const directory = useDirectory()
  const apartments = useApartments()
  const announcements = useAnnouncements()
  const tickets = useTickets()
  return useMemo(() => ({
    apartments: people ? (apartments.data ?? []).map((a) => ({
      id: a.id, number: a.number, names: (directory.data ?? []).filter((r) => r.apartment_id === a.id).map((r) => r.full_name),
    })) : [],
    people: people ? (directory.data ?? []).map((r) => ({
      id: r.id, name: r.full_name, phone: r.phone, email: r.email, apartmentId: r.apartment_id, apartmentNumber: r.apartmentNumber,
    })) : [],
    announcements: can('announcements') ? (announcements.data ?? []).map((a) => ({ id: a.id, title: a.title })) : [],
    tickets: can('tickets') ? (tickets.data ?? []).map((t) => ({ id: t.id, title: t.title })) : [],
  }), [people, can, apartments.data, directory.data, announcements.data, tickets.data])
}

interface Hit { key: string; to: string; label: ReactNode; plate?: number }

/** Where each result goes: admins open the apartment page; others the directory, filtered. */
function hitsOf(r: SearchResults, admin: boolean): [keyof SearchResults, Hit[]][] {
  return [
    ['apartments', r.apartments.map((a) => ({ key: a.id, plate: a.number, label: a.names.join(', ') || he.apartment(a.number),
      to: admin ? `/apartments/${a.id}` : `/directory?q=${a.number}` }))],
    ['people', r.people.map((p) => ({ key: p.id, plate: p.apartmentNumber, label: p.name,
      to: admin ? `/apartments/${p.apartmentId}?tab=residents` : `/directory?q=${encodeURIComponent(p.name)}` }))],
    ['announcements', r.announcements.map((a) => ({ key: a.id, label: a.title, to: `/announcements?open=${a.id}` }))],
    ['tickets', r.tickets.map((t) => ({ key: t.id, label: t.title, to: `/tickets/${t.id}` }))],
  ]
}

function Results({ query, groups, onGo }: { query: string; groups: [keyof SearchResults, Hit[]][]; onGo: (to: string) => void }) {
  if (!query.trim()) return <Text c="dimmed" size="sm">{S.start}</Text>
  if (groups.every(([, h]) => h.length === 0)) return <Text c="dimmed" size="sm" role="status">{S.empty}</Text>
  return (
    <Stack gap="sm">
      {groups.filter(([, hits]) => hits.length > 0).map(([group, hits]) => (
        <Stack key={group} gap={0} role="group" aria-label={S.groups[group]}>
          <Title order={3} size="h6" c="dimmed" mb={2}>{S.groups[group]}</Title>
          {hits.map((h) => (
            <UnstyledButton key={h.key} className="bm-row" mih={44} px="xs" onClick={() => onGo(h.to)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, borderRadius: 10 }}>
              {h.plate !== undefined && <AptPlate number={h.plate} size="sm" />}
              <Text truncate="end">{h.label}</Text>
            </UnstyledButton>
          ))}
        </Stack>
      ))}
    </Stack>
  )
}

/** Mounted only while open, so the data loads on first use. Enter opens the first result. */
function SearchBody({ onGo }: { onGo: (to: string) => void }) {
  const { isAdmin } = useAuth()
  const data = useSearchData()
  const desktop = useDesktop()
  const [query, setQuery] = useState('')
  const groups = useMemo(() => hitsOf(searchAll(query, data), isAdmin), [query, data, isAdmin])
  const first = groups.flatMap(([, h]) => h)[0]
  return (
    <Stack gap="md">
      <TextInput data-autofocus aria-label={S.title} placeholder={S.placeholder} value={query} type="search" description={desktop ? S.hint : undefined}
        leftSection={<IconSearch size={18} stroke={1.75} aria-hidden="true" />} onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && first) onGo(first.to) }} />
      <Results query={query} groups={groups} onGo={onGo} />
    </Stack>
  )
}

/** The Spotlight-style quick jump: apartments, residents, announcements and calls the user may see. */
export function QuickSearch({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const go = (to: string) => { onClose(); void navigate(to) }
  return (
    <Modal opened={opened} onClose={onClose} title={S.title} size="lg" yOffset="10vh">
      {opened && <SearchBody onGo={go} />}
    </Modal>
  )
}
