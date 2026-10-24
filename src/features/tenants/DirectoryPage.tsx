import { ActionIcon, Button, Card, Divider, Group, Menu, Stack, Text, TextInput } from '@mantine/core'
import { IconDots, IconPencil, IconPhone, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react'
import { Fragment, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { AptPlate, EmptyState, ListSkeleton, notifySuccess, PageHeader } from '../../ui'
import { ApartmentForm } from './ApartmentForm'
import { useApartments, useDeleteResident, useDirectory, type DirectoryEntry } from './api'
import { ConfirmDialog, FormModal } from './dialogs'
import { ResidentForm } from './ResidentForm'

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

type Dialog =
  | { kind: 'apartment'; apartmentId: string }
  | { kind: 'resident'; apartmentId: string; resident?: DirectoryEntry }
  | { kind: 'remove'; resident: DirectoryEntry }
  | null

interface Actions {
  admin: boolean
  open: (d: Dialog) => void
}

function ResidentMenu({ r, open }: { r: DirectoryEntry; open: Actions['open'] }) {
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={he.tenants.residentActions(r.full_name)}>
          <IconDots size={20} stroke={1.75} aria-hidden="true" />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconPencil size={18} stroke={1.75} />}
          onClick={() => open({ kind: 'resident', apartmentId: r.apartment_id, resident: r })}>{he.tenants.editResident}</Menu.Item>
        <Menu.Item color="debt" leftSection={<IconTrash size={18} stroke={1.75} />}
          onClick={() => open({ kind: 'remove', resident: r })}>{he.tenants.removeResident}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

function ResidentLine({ r, actions }: { r: DirectoryEntry; actions: Actions }) {
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
      {actions.admin && <ResidentMenu r={r} open={actions.open} />}
    </Group>
  )
}

function ApartmentGroup({ group, actions }: { group: Group; actions: Actions }) {
  const apartmentId = group.entries[0].apartment_id
  return (
    <Group align="flex-start" wrap="nowrap" gap="md" py="sm">
      <AptPlate number={group.number} size="sm" />
      <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
        {group.entries.map((r) => <ResidentLine key={r.id} r={r} actions={actions} />)}
        {actions.admin && (
          <Button variant="subtle" size="compact-md" mih={44} leftSection={<IconPlus size={18} stroke={1.75} />} style={{ alignSelf: 'flex-start' }}
            onClick={() => actions.open({ kind: 'resident', apartmentId })}>{he.tenants.addResident}</Button>
        )}
      </Stack>
      {actions.admin && (
        <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={he.tenants.editApartmentN(group.number)}
          onClick={() => actions.open({ kind: 'apartment', apartmentId })}>
          <IconPencil size={20} stroke={1.75} aria-hidden="true" />
        </ActionIcon>
      )}
    </Group>
  )
}

function DirectoryDialogs({ dialog, close }: { dialog: Dialog; close: () => void }) {
  const apartments = useApartments()
  const remove = useDeleteResident()
  const apartment = dialog?.kind === 'apartment' ? apartments.data?.find((a) => a.id === dialog.apartmentId) : undefined
  const target = dialog?.kind === 'remove' ? dialog.resident : undefined
  const editing = dialog?.kind === 'resident' ? dialog.resident : undefined
  return (
    <>
      <FormModal opened={Boolean(apartment)} title={he.tenants.editApartment} onClose={close}>
        <ApartmentForm apartment={apartment} onDone={close} />
      </FormModal>
      <FormModal opened={dialog?.kind === 'resident'} title={editing ? he.tenants.editResident : he.tenants.addResident} onClose={close}>
        {dialog?.kind === 'resident' && <ResidentForm apartmentId={dialog.apartmentId} resident={editing} onDone={close} />}
      </FormModal>
      <ConfirmDialog opened={Boolean(target)} title={he.tenants.deleteResidentConfirm(target?.full_name ?? '')}
        body={he.tenants.deleteApartmentCascade(0)} confirmLabel={he.tenants.removeResident}
        loading={remove.isPending} failed={remove.isError} onClose={close}
        onConfirm={() => target && remove.mutate(target.id, { onSuccess: () => { notifySuccess(he.toast.residentDeleted); close() } })} />
    </>
  )
}

/** Everyone's phone book: residents grouped by apartment, searchable by name or apartment number. */
export default function DirectoryPage() {
  const directory = useDirectory()
  const { isAdmin } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)
  const actions: Actions = { admin: isAdmin, open: setDialog }
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
            <ApartmentGroup group={g} actions={actions} />
          </Fragment>
        ))}
      </Card>
      {isAdmin && <DirectoryDialogs dialog={dialog} close={() => setDialog(null)} />}
    </Stack>
  )
}
