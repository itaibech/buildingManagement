import { Card, Divider, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconChevronLeft } from '@tabler/icons-react'
import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { he } from '../../lib/he'
import { AptPlate, EmptyState, ListSkeleton, PageHeader } from '../../ui'
import { ApartmentForm } from './ApartmentForm'
import { useApartments, useResidents, type Apartment, type Resident } from './api'
import { FormModal } from './dialogs'

function ApartmentRow({ apartment, residents }: { apartment: Apartment; residents: Resident[] }) {
  const meta = [
    apartment.floor !== null ? he.tenants.floorLabel(apartment.floor) : null,
    he.tenants.residentsCount(residents.length),
  ].filter(Boolean).join(' · ')
  return (
    <UnstyledButton component={Link} to={`/apartments/${apartment.id}`} py="sm" px="md" mih={56} className="bm-row"
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--mantine-spacing-md)' }}>
      <AptPlate number={apartment.number} size="sm" />
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} truncate>{residents.map((r) => r.full_name).join(', ') || he.apartment(apartment.number)}</Text>
        <Text size="sm" c="dimmed">{meta}</Text>
      </Stack>
      <IconChevronLeft size={20} stroke={1.75} color="var(--mantine-color-stone-6)" aria-hidden="true" />
    </UnstyledButton>
  )
}

function useResidentsByApartment(): Map<string, Resident[]> {
  const residents = useResidents()
  return useMemo(() => {
    const map = new Map<string, Resident[]>()
    for (const r of residents.data ?? []) map.set(r.apartment_id, [...(map.get(r.apartment_id) ?? []), r])
    return map
  }, [residents.data])
}

/** Admin: every apartment sorted by number; tap through to its residents. */
export default function ApartmentsPage() {
  const apartments = useApartments()
  const byApartment = useResidentsByApartment()
  const [adding, setAdding] = useState(false)
  const add = { label: he.tenants.addApartment, onClick: () => setAdding(true) }
  const list = apartments.data ?? []
  return (
    <Stack gap="md">
      <PageHeader title={he.nav.apartments} action={add} />
      <Card padding={0}>
        {apartments.isError && <Text c="debt.7" p="md">{he.tenants.loadError}</Text>}
        {apartments.isLoading && <Stack p="md"><ListSkeleton rows={5} /></Stack>}
        {apartments.data && list.length === 0 && (
          <EmptyState title={he.tenants.apartmentsEmpty} body={he.tenants.apartmentsEmptyBody} action={add} />
        )}
        {list.map((a, i) => (
          <Fragment key={a.id}>
            {i > 0 && <Divider color="stone.1" />}
            <ApartmentRow apartment={a} residents={byApartment.get(a.id) ?? []} />
          </Fragment>
        ))}
      </Card>
      <FormModal opened={adding} title={he.tenants.addApartment} onClose={() => setAdding(false)}>
        <ApartmentForm onDone={() => setAdding(false)} />
      </FormModal>
    </Stack>
  )
}
