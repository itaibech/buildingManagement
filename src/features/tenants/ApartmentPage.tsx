import { ActionIcon, Anchor, Button, Card, Divider, Group, Stack, Text, Title } from '@mantine/core'
import { IconChevronRight, IconPencil, IconTrash } from '@tabler/icons-react'
import { Fragment, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { he } from '../../lib/he'
import { formatILS } from '../../lib/format'
import { AptPlate, EmptyState, ExemptBadge, ListSkeleton, notifySuccess, PageHeader } from '../../ui'
import { useApartmentFee } from '../finance/api'
import { ApartmentForm } from './ApartmentForm'
import { isMoneyHistoryError, useApartments, useDeleteApartment, useDeleteResident, useResidents, type Apartment, type Resident } from './api'
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
  const details = [r.is_owner ? he.tenants.owner : he.tenants.tenant, r.phone, r.email].filter(Boolean).join(' · ')
  return (
    <Group wrap="nowrap" gap="xs" py="xs" px="md" mih={56}>
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} truncate>{r.full_name}</Text>
        <Text size="sm" c="dimmed" truncate>{details}</Text>
      </Stack>
      <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={`${he.tenants.edit} ${r.full_name}`} onClick={onEdit}>
        <IconPencil {...ICON} />
      </ActionIcon>
      <ActionIcon variant="subtle" color="debt" size={44} aria-label={`${he.tenants.delete} ${r.full_name}`} onClick={onDelete}>
        <IconTrash {...ICON} />
      </ActionIcon>
    </Group>
  )
}

/** "דמי ועד חודשיים: ₪X" plus the exempt badge while an exemption is in force. */
function FeeLine({ apartmentId }: { apartmentId: string }) {
  const q = useApartmentFee(apartmentId)
  if (!q.data) return null
  if (q.data.feeMode === 'exempt') return <div><ExemptBadge /></div>
  return <Text size="sm" c="dimmed" className="bm-num">{he.fees.myFee(formatILS(q.data.fee))}</Text>
}

function ApartmentSummary({ apartment, onEdit, onDelete }: { apartment: Apartment; onEdit: () => void; onDelete: () => void }) {
  return (
    <Card padding="md">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="md" wrap="nowrap" style={{ minWidth: 0 }}>
          <AptPlate number={apartment.number} size="lg" />
          <Stack gap={0} style={{ minWidth: 0 }}>
            {apartment.floor !== null && <Text fw={600}>{he.tenants.floorLabel(apartment.floor)}</Text>}
            {apartment.notes && <Text size="sm" c="dimmed">{apartment.notes}</Text>}
            <FeeLine apartmentId={apartment.id} />
          </Stack>
        </Group>
        <Group gap="xs">
          <Button variant="light" leftSection={<IconPencil {...ICON} />} onClick={onEdit}>{he.tenants.edit}</Button>
          <Button variant="subtle" color="debt" leftSection={<IconTrash {...ICON} />} onClick={onDelete}>{he.tenants.delete}</Button>
        </Group>
      </Group>
    </Card>
  )
}

function ResidentList({ residents, setDialog }: { residents: Resident[]; setDialog: (d: Dialog) => void }) {
  if (residents.length === 0) {
    return <EmptyState title={he.tenants.noResidents} action={{ label: he.tenants.addResident, onClick: () => setDialog({ kind: 'resident' }) }} />
  }
  return residents.map((r, i) => (
    <Fragment key={r.id}>
      {i > 0 && <Divider color="stone.1" />}
      <ResidentRow r={r} onEdit={() => setDialog({ kind: 'resident', resident: r })} onDelete={() => setDialog({ kind: 'deleteResident', resident: r })} />
    </Fragment>
  ))
}

function BackLink() {
  return (
    <Anchor component={Link} to="/apartments" fw={600} mih={44} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <IconChevronRight size={18} stroke={1.75} aria-hidden="true" />
      {he.tenants.back}
    </Anchor>
  )
}

function Dialogs({ apartment, residents, dialog, close }: { apartment: Apartment; residents: Resident[]; dialog: Dialog; close: () => void }) {
  const navigate = useNavigate()
  const deleteApartment = useDeleteApartment()
  const deleteResident = useDeleteResident()
  const target = dialog?.kind === 'deleteResident' ? dialog.resident : undefined
  return (
    <>
      <FormModal opened={dialog?.kind === 'editApartment'} title={he.tenants.editApartment} onClose={close}>
        <ApartmentForm apartment={apartment} onDone={close} />
      </FormModal>
      <FormModal opened={dialog?.kind === 'resident'} title={dialog?.kind === 'resident' && dialog.resident ? he.tenants.editResident : he.tenants.addResident} onClose={close}>
        <ResidentForm apartmentId={apartment.id} resident={dialog?.kind === 'resident' ? dialog.resident : undefined} onDone={close} />
      </FormModal>
      <ConfirmDialog opened={dialog?.kind === 'deleteApartment'} title={he.tenants.deleteApartmentConfirm(apartment.number)}
        body={he.tenants.deleteApartmentCascade(residents.length)} confirmLabel={he.tenants.deleteApartment}
        loading={deleteApartment.isPending} failed={deleteApartment.isError} onClose={close}
        failedMessage={isMoneyHistoryError(deleteApartment.error) ? he.tenants.errors.hasMoney : undefined}
        onConfirm={() => deleteApartment.mutate(apartment.id, { onSuccess: () => { notifySuccess(he.toast.apartmentDeleted); void navigate('/apartments', { replace: true }) } })} />
      <ConfirmDialog opened={Boolean(target)} title={he.tenants.deleteResidentConfirm(target?.full_name ?? '')}
        body={he.tenants.deleteApartmentCascade(0)} confirmLabel={he.tenants.deleteResident}
        loading={deleteResident.isPending} failed={deleteResident.isError} onClose={close}
        onConfirm={() => target && deleteResident.mutate(target.id, { onSuccess: () => { notifySuccess(he.toast.residentDeleted); close() } })} />
    </>
  )
}

/** Admin: one apartment, its residents, and every edit that belongs to them. */
export default function ApartmentPage() {
  const { id = '' } = useParams()
  const apartments = useApartments()
  const residents = useResidents(id)
  const [dialog, setDialog] = useState<Dialog>(null)
  const apartment = apartments.data?.find((a) => a.id === id)
  if (apartments.isLoading) return <ListSkeleton />
  if (!apartment) return <Stack align="flex-start"><BackLink /><Text>{apartments.isError ? he.tenants.loadError : he.tenants.notFound}</Text></Stack>
  const list = residents.data ?? []
  return (
    <Stack gap="md">
      <BackLink />
      <PageHeader title={he.apartment(apartment.number)} action={{ label: he.tenants.addResident, onClick: () => setDialog({ kind: 'resident' }) }} />
      <ApartmentSummary apartment={apartment} onEdit={() => setDialog({ kind: 'editApartment' })} onDelete={() => setDialog({ kind: 'deleteApartment' })} />
      <Title order={2} size="h4">{he.tenants.residents}</Title>
      <Card padding={0}>
        {residents.isLoading ? <Stack p="md"><ListSkeleton /></Stack> : <ResidentList residents={list} setDialog={setDialog} />}
      </Card>
      <Dialogs apartment={apartment} residents={list} dialog={dialog} close={() => setDialog(null)} />
    </Stack>
  )
}
