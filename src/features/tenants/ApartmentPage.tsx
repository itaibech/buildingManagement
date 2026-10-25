import { Accordion, ActionIcon, Alert, Anchor, Button, Card, Divider, Group, Menu, Stack, Tabs, Text } from '@mantine/core'
import { IconDots, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react'
import { Fragment, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { he } from '../../lib/he'
import { AptPlate, BackLink, EmptyState, ListSkeleton, notifySuccess, PageHeader } from '../../ui'
import { useChargers } from '../ev/api'
import { useBalances } from '../finance/api'
import { ApartmentYear } from '../finance/ApartmentLedger'
import { useDesktop } from '../finance/hooks'
import { telHref } from '../settings/api'
import { ApartmentForm } from './ApartmentForm'
import { useAllApartments, useDeleteResident, useResidents, useRestoreApartment, type Apartment, type Resident } from './api'
import { sectionsFor, type SectionKey } from './aptData'
import { AptOverview } from './AptOverview'
import { EvSection, FeesSection, HistorySection, MeetingsSection, PaymentsSection, TicketsSection } from './AptSections'
import { DeleteApartmentDialog } from './DeleteApartmentDialog'
import { ConfirmDialog, FormModal } from './dialogs'
import { ResidentForm } from './ResidentForm'

type Dialog =
  | { kind: 'editApartment' }
  | { kind: 'deleteApartment' }
  | { kind: 'resident'; resident?: Resident }
  | { kind: 'deleteResident'; resident: Resident }
  | null

const ICON = { size: 20, stroke: 1.75 } as const

function ResidentRow({ r, onEdit, onDelete }: { r: Resident; onEdit: () => void; onDelete: () => void }) {
  const details = [r.is_owner ? he.tenants.owner : he.tenants.tenant, r.email].filter(Boolean).join(' · ')
  return (
    <Group wrap="nowrap" gap="xs" py="xs" px="md" mih={56}>
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} truncate>{r.full_name}</Text>
        <Text size="sm" c="dimmed" truncate>
          {details}
          {r.phone && <>{' · '}<Anchor href={telHref(r.phone)} size="sm" dir="ltr">{r.phone}</Anchor></>}
        </Text>
      </Stack>
      <Menu position="bottom-start" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={he.tenants.residentActions(r.full_name)}>
            <IconDots {...ICON} aria-hidden="true" />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconPencil size={18} stroke={1.75} />} onClick={onEdit}>{he.tenants.edit}</Menu.Item>
          <Menu.Item color="debt" leftSection={<IconTrash size={18} stroke={1.75} />} onClick={onDelete}>{he.tenants.delete}</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  )
}

/** "דיירים": the residents, with edit, delete and add. */
function ResidentsSection({ apartmentId, setDialog }: { apartmentId: string; setDialog: (d: Dialog) => void }) {
  const residents = useResidents(apartmentId)
  const list = residents.data ?? []
  const add = { label: he.tenants.addResident, onClick: () => setDialog({ kind: 'resident' }) }
  if (residents.isLoading) return <ListSkeleton />
  if (list.length === 0) return <EmptyState title={he.tenants.noResidents} action={add} />
  return (
    <Stack gap="sm">
      <Card padding={0}>
        {list.map((r, i) => (
          <Fragment key={r.id}>
            {i > 0 && <Divider color="stone.1" />}
            <ResidentRow r={r} onEdit={() => setDialog({ kind: 'resident', resident: r })} onDelete={() => setDialog({ kind: 'deleteResident', resident: r })} />
          </Fragment>
        ))}
      </Card>
      <Button variant="light" leftSection={<IconPlus {...ICON} />} onClick={add.onClick} style={{ alignSelf: 'flex-start' }}>{add.label}</Button>
    </Stack>
  )
}

function Dialogs({ apartment, dialog, close }: { apartment: Apartment; dialog: Dialog; close: () => void }) {
  const navigate = useNavigate()
  const deleteResident = useDeleteResident()
  const target = dialog?.kind === 'deleteResident' ? dialog.resident : undefined
  const leave = (toast: string) => { notifySuccess(toast); void navigate('/apartments', { replace: true }) }
  return (
    <>
      <FormModal opened={dialog?.kind === 'editApartment'} title={he.tenants.editApartment} onClose={close}>
        <ApartmentForm apartment={apartment} onDone={close} />
      </FormModal>
      <FormModal opened={dialog?.kind === 'resident'} title={dialog?.kind === 'resident' && dialog.resident ? he.tenants.editResident : he.tenants.addResident} onClose={close}>
        <ResidentForm apartmentId={apartment.id} resident={dialog?.kind === 'resident' ? dialog.resident : undefined} onDone={close} />
      </FormModal>
      <DeleteApartmentDialog apartment={apartment} opened={dialog?.kind === 'deleteApartment'} onClose={close}
        onDeleted={() => leave(he.toast.apartmentDeleted)} onArchived={() => leave(he.toast.apartmentArchived)} />
      <ConfirmDialog opened={Boolean(target)} title={he.tenants.deleteResidentConfirm(target?.full_name ?? '')}
        body={he.tenants.deleteApartmentCascade(0)} confirmLabel={he.tenants.deleteResident}
        loading={deleteResident.isPending} failed={deleteResident.isError} onClose={close}
        onConfirm={() => target && deleteResident.mutate(target.id, { onSuccess: () => { notifySuccess(he.toast.residentDeleted); close() } })} />
    </>
  )
}

/** An archived apartment: hidden from the lists, fees stopped; "שחזור מהארכיון" brings it back. */
function ArchivedBanner({ apartmentId }: { apartmentId: string }) {
  const restore = useRestoreApartment()
  return (
    <Alert color="signal" title={he.tenants.removal.archived}>
      <Stack gap="xs" align="flex-start">
        <Text size="sm">{he.tenants.removal.archivedBody}</Text>
        <Button variant="light" loading={restore.isPending} onClick={() => restore.mutate(apartmentId, { onSuccess: () => notifySuccess(he.toast.apartmentRestored) })}>
          {he.tenants.removal.restore}
        </Button>
        {restore.isError && <Text c="debt.7" size="sm">{he.toast.failed}</Text>}
      </Stack>
    </Alert>
  )
}

interface BodyProps { k: SectionKey; apartment: Apartment; setDialog: (d: Dialog) => void; setSection: (k: SectionKey) => void }

/** One section's content; mounted only while open, so each loads on demand. */
function SectionBody({ k, apartment, setDialog, setSection }: BodyProps) {
  const balance = useBalances().data?.find((b) => b.apartmentId === apartment.id)
  const charger = useChargers().data?.find((c) => c.apartment_id === apartment.id)
  const id = apartment.id
  if (k === 'overview') return <AptOverview apartment={apartment} balance={balance} onEdit={() => setDialog({ kind: 'editApartment' })} onLedger={() => setSection('ledger')} />
  if (k === 'payments') return <PaymentsSection apartmentId={id} />
  if (k === 'ledger') return <ApartmentYear apartmentId={id} admin />
  if (k === 'fees') return <FeesSection apartmentId={id} />
  if (k === 'ev') return charger ? <EvSection charger={charger} /> : null
  if (k === 'residents') return <ResidentsSection apartmentId={id} setDialog={setDialog} />
  if (k === 'tickets') return <TicketsSection apartmentId={id} />
  if (k === 'meetings') return <MeetingsSection apartmentId={id} />
  return <HistorySection apartmentId={id} />
}

/** Tabs on desktop, a stacked accordion on mobile; one section open at a time. */
function Sections(props: Omit<BodyProps, 'k' | 'setSection'>) {
  const desktop = useDesktop()
  const hasCharger = !!useChargers().data?.some((c) => c.apartment_id === props.apartment.id)
  const keys = sectionsFor(hasCharger)
  // ?tab=<section> (e.g. ledger from the home debtors, the inbox and reminders) opens that section.
  const [params] = useSearchParams()
  const linked = keys.find((k) => k === params.get('tab')) ?? null
  const [section, setSection] = useState<SectionKey | null>(linked ?? 'overview')
  // A new ?tab= while the page is open (e.g. from the header search) opens that section.
  const [seenLink, setSeenLink] = useState(linked)
  if (linked !== seenLink) { setSeenLink(linked); if (linked) setSection(linked) }
  const pick = (v: string | null) => setSection(keys.find((k) => k === v) ?? null)
  const body = (k: SectionKey) => section === k && <SectionBody k={k} setSection={setSection} {...props} />
  if (desktop) {
    return (
      <Tabs value={section ?? 'overview'} onChange={pick} keepMounted={false}>
        <Tabs.List mb="md">{keys.map((k) => <Tabs.Tab key={k} value={k} mih={44}>{he.aptPage.sections[k]}</Tabs.Tab>)}</Tabs.List>
        {keys.map((k) => <Tabs.Panel key={k} value={k}>{body(k)}</Tabs.Panel>)}
      </Tabs>
    )
  }
  return (
    <Accordion value={section} onChange={pick} variant="separated" radius="md">
      {keys.map((k) => (
        <Accordion.Item key={k} value={k}>
          <Accordion.Control mih={48}>{he.aptPage.sections[k]}</Accordion.Control>
          <Accordion.Panel>{body(k)}</Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  )
}

/** Admin: everything about one apartment, in sections (#/apartments/:id). */
export default function ApartmentPage() {
  const { id = '' } = useParams()
  const apartments = useAllApartments()
  const [dialog, setDialog] = useState<Dialog>(null)
  const apartment = apartments.data?.find((a) => a.id === id)
  if (apartments.isLoading) return <ListSkeleton />
  if (!apartment) return <Stack align="flex-start"><BackLink to="/apartments" label={he.tenants.back} /><Text>{apartments.isError ? he.tenants.loadError : he.tenants.notFound}</Text></Stack>
  return (
    <Stack gap="md">
      <BackLink to="/apartments" label={he.tenants.back} />
      <Group gap="md" wrap="nowrap">
        <AptPlate number={apartment.number} size="lg" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <PageHeader title={he.apartment(apartment.number)}
            secondaryAction={{ label: he.tenants.delete, icon: <IconTrash {...ICON} />, onClick: () => setDialog({ kind: 'deleteApartment' }) }} />
          <Text size="sm" c="dimmed">{[apartment.floor !== null ? he.tenants.floorLabel(apartment.floor) : null, apartment.notes].filter(Boolean).join(' · ')}</Text>
        </div>
      </Group>
      {apartment.archived_at && <ArchivedBanner apartmentId={apartment.id} />}
      <Sections key={apartment.id} apartment={apartment} setDialog={setDialog} />
      <Dialogs apartment={apartment} dialog={dialog} close={() => setDialog(null)} />
    </Stack>
  )
}
