import { Accordion, Card, Divider, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconChevronLeft } from '@tabler/icons-react'
import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { he } from '../../lib/he'
import { ApartmentTags, AptPlate, EmptyState, ListSkeleton, Money, PageHeader } from '../../ui'
import { useChargers } from '../ev/api'
import { useBalances } from '../finance/api'
import { ApartmentForm } from './ApartmentForm'
import { billingOf, useApartmentBilling, useApartments, useArchivedApartments, useResidents, type Apartment, type Resident } from './api'
import { apartmentsRows } from '../export/buildWorkbook'
import { useExportAction } from '../export/useExport'
import { FormModal } from './dialogs'

interface RowExtras { fee?: number; ev: boolean; standingOrder: boolean }

function ApartmentRow({ apartment, residents, fee, ev, standingOrder }: { apartment: Apartment; residents: Resident[] } & RowExtras) {
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
        <ApartmentTags committee={apartment.is_committee} standingOrder={standingOrder} ev={ev} />
      </Stack>
      {fee !== undefined && (
        <Stack gap={0} align="flex-end">
          <Text size="xs" c="dimmed">{he.tenants.monthlyFeeLabel}</Text>
          <Money amount={fee} tone="neutral" />
        </Stack>
      )}
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

/** Apartment id → this month's fee, EV charger and standing order (for the list's badges, amounts and export). */
function useRowExtras(): (id: string) => RowExtras {
  const balances = useBalances()
  const chargers = useChargers()
  const billing = useApartmentBilling()
  const fees = useMemo(() => new Map((balances.data ?? []).map((b) => [b.apartmentId, b.fee])), [balances.data])
  const ev = useMemo(() => new Set((chargers.data ?? []).map((c) => c.apartment_id)), [chargers.data])
  return (id) => ({ fee: fees.get(id), ev: ev.has(id), standingOrder: billingOf(billing.data, id).paymentMethod === 'standing_order' })
}

/** Archived apartments, collapsed under "ארכיון (N)": each opens its page (where it can be restored). */
function ArchivedSection() {
  const archived = useArchivedApartments()
  const list = archived.data ?? []
  if (list.length === 0) return null
  return (
    <Accordion variant="contained" radius="md">
      <Accordion.Item value="archive">
        <Accordion.Control>{he.tenants.removal.archiveList(list.length)}</Accordion.Control>
        <Accordion.Panel>
          <Group gap="xs">
            {list.map((a) => (
              <UnstyledButton key={a.id} component={Link} to={`/apartments/${a.id}`} miw={44} mih={44} aria-label={he.apartment(a.number)}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <AptPlate number={a.number} size="sm" />
              </UnstyledButton>
            ))}
          </Group>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  )
}

/** Admin: every apartment sorted by number; tap through to its residents. */
export default function ApartmentsPage() {
  const apartments = useApartments()
  const byApartment = useResidentsByApartment()
  const [adding, setAdding] = useState(false)
  const add = { label: he.tenants.addApartment, onClick: () => setAdding(true) }
  const list = apartments.data ?? []
  const residents = useResidents()
  const extras = useRowExtras()
  const exportAction = useExportAction(he.export.files.apartments, () => apartmentsRows(list, residents.data ?? [], extras), !!apartments.data && !!residents.data)
  return (
    <Stack gap="md">
      <PageHeader title={he.nav.apartments} subtitle={he.nav.hints.apartments} action={add} secondaryAction={exportAction} />
      <Card padding={0}>
        {apartments.isError && <Text c="debt.7" p="md">{he.tenants.loadError}</Text>}
        {apartments.isLoading && <Stack p="md"><ListSkeleton rows={5} /></Stack>}
        {apartments.data && list.length === 0 && (
          <EmptyState title={he.tenants.apartmentsEmpty} body={he.tenants.apartmentsEmptyBody} action={add} />
        )}
        {list.map((a, i) => (
          <Fragment key={a.id}>
            {i > 0 && <Divider color="stone.1" />}
            <ApartmentRow apartment={a} residents={byApartment.get(a.id) ?? []} {...extras(a.id)} />
          </Fragment>
        ))}
      </Card>
      <ArchivedSection />
      <FormModal opened={adding} title={he.tenants.addApartment} onClose={() => setAdding(false)}>
        <ApartmentForm onDone={() => setAdding(false)} />
      </FormModal>
    </Stack>
  )
}
