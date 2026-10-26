import { ActionIcon, Button, Card, Divider, Group, Menu, Stack, Text, TextInput } from '@mantine/core'
import { IconDots, IconMail, IconMailPlus, IconPencil, IconPhone, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react'
import { Fragment, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { AptPlate, EmptyState, ListSkeleton, notifySuccess, PageHeader } from '../../ui'
import { ApartmentForm } from './ApartmentForm'
import { useApartments, type Apartment, useDeleteResident, useDirectory, type DirectoryEntry, useProfiles } from './api'
import { ConfirmDialog, FormModal } from './dialogs'
import { DirectoryPrintView } from './DirectoryPrintView'
import { hasAccount } from './invite'
import { InviteDialog } from './InviteDialog'
import { ResidentForm } from './ResidentForm'
import { useDirectoryExport } from './useDirectoryExport'

interface Group {
  number: number
  apartmentId: string
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
    else groups.push({ number: e.apartmentNumber, apartmentId: e.apartment_id, entries: [e] })
  }
  return groups
}

/** Admins also see apartments nobody lives in (found by number), so residents can be added to them. */
function withEmptyApartments(groups: Group[], all: Apartment[], q: string): Group[] {
  const listed = new Set(groups.map((g) => g.apartmentId))
  const empty = all.filter((a) => !listed.has(a.id) && (!q || String(a.number) === q))
  return [...groups, ...empty.map((a) => ({ number: a.number, apartmentId: a.id, entries: [] }))].sort((a, b) => a.number - b.number)
}

type Dialog =
  | { kind: 'apartment'; apartmentId: string }
  | { kind: 'resident'; apartmentId: string; resident?: DirectoryEntry }
  | { kind: 'remove'; resident: DirectoryEntry }
  | { kind: 'invite'; resident: DirectoryEntry }
  | null

interface Actions {
  admin: boolean
  open: (d: Dialog) => void
  /** Admins: the resident has an email and no login yet ("הזמנה"). */
  invitable: (r: DirectoryEntry) => boolean
}

function InviteAction({ r, open }: { r: DirectoryEntry; open: Actions['open'] }) {
  return (
    <Button variant="subtle" size="compact-md" mih={44} px="xs" leftSection={<IconMailPlus size={18} stroke={1.75} />} visibleFrom="sm"
      aria-label={he.invite.directoryActionLabel(r.full_name)} onClick={() => open({ kind: 'invite', resident: r })}>
      {he.invite.directoryAction}
    </Button>
  )
}

/** On mobile "הזמנה" moves in here, so the row keeps room for the full phone number. */
function ResidentMenu({ r, open, invitable }: { r: DirectoryEntry; open: Actions['open']; invitable: boolean }) {
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={he.tenants.residentActions(r.full_name)}>
          <IconDots size={20} stroke={1.75} aria-hidden="true" />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {invitable && (
          <Menu.Item hiddenFrom="sm" leftSection={<IconMailPlus size={18} stroke={1.75} />}
            onClick={() => open({ kind: 'invite', resident: r })}>{he.invite.directoryMenuItem}</Menu.Item>
        )}
        <Menu.Item leftSection={<IconPencil size={18} stroke={1.75} />}
          onClick={() => open({ kind: 'resident', apartmentId: r.apartment_id, resident: r })}>{he.tenants.editResident}</Menu.Item>
        <Menu.Item color="debt" leftSection={<IconTrash size={18} stroke={1.75} />}
          onClick={() => open({ kind: 'remove', resident: r })}>{he.tenants.removeResident}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

function EmailLine({ email }: { email: string }) {
  return (
    <Text size="xs" c="dimmed" hiddenFrom="sm" truncate title={email}>
      <bdi dir="ltr">{email}</bdi>
    </Text>
  )
}

/** Phone and email actions: full buttons on desktop; on mobile the phone stays full and the email is an icon. */
function ContactActions({ r }: { r: DirectoryEntry }) {
  return (
    <>
      {/* RTL: the last child sits leftmost — email, then the phone on the far left. */}
      {r.email && (
        <>
          <Button component="a" href={`mailto:${r.email}`} visibleFrom="sm" variant="subtle" title={r.email} px="xs"
            aria-label={he.tenants.emailAction(r.full_name)} leftSection={<IconMail size={18} stroke={1.75} />}
            styles={{ label: { maxWidth: '16rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }}>
            <bdi dir="ltr">{r.email}</bdi>
          </Button>
          <ActionIcon component="a" href={`mailto:${r.email}`} hiddenFrom="sm" variant="subtle" size={44} title={r.email}
            aria-label={he.tenants.emailAction(r.full_name)}>
            <IconMail size={20} stroke={1.75} aria-hidden="true" />
          </ActionIcon>
        </>
      )}
      {r.phone && (
        <Button component="a" href={`tel:${r.phone}`} variant="subtle" aria-label={he.tenants.call(r.full_name)}
          leftSection={<IconPhone size={18} stroke={1.75} />} className="bm-num" dir="ltr" px="xs" style={{ whiteSpace: 'nowrap' }}>
          {r.phone}
        </Button>
      )}
    </>
  )
}

function ResidentLine({ r, actions }: { r: DirectoryEntry; actions: Actions }) {
  return (
    <Group justify="space-between" wrap="wrap" gap="xs" mih={44}>
      <Stack gap={0} style={{ flex: '1 1 8rem', minWidth: 0 }}>
        <Text fw={600}>{r.full_name}</Text>
        <Text size="sm" c="dimmed">{r.is_owner ? he.tenants.owner : he.tenants.tenant}</Text>
        {r.email && <EmailLine email={r.email} />}
      </Stack>
      <Group wrap="nowrap" gap={0} style={{ flexShrink: 0, maxWidth: '100%' }}>
        <ContactActions r={r} />
        {actions.admin && actions.invitable(r) && <InviteAction r={r} open={actions.open} />}
        {actions.admin && <ResidentMenu r={r} open={actions.open} invitable={actions.invitable(r)} />}
      </Group>
    </Group>
  )
}

function ResidentList({ group, actions }: { group: Group; actions: Actions }) {
  return (
    <Stack gap="xs" style={{ flex: 1, minWidth: 0 }}>
      {group.entries.map((r) => <ResidentLine key={r.id} r={r} actions={actions} />)}
      {actions.admin && group.entries.length === 0 && <Text c="dimmed">{he.tenants.noResidentsShort}</Text>}
      {actions.admin && (
        <Button variant="subtle" size="compact-md" mih={44} leftSection={<IconPlus size={18} stroke={1.75} />} style={{ alignSelf: 'flex-start' }}
          onClick={() => actions.open({ kind: 'resident', apartmentId: group.apartmentId })}>{he.tenants.addResident}</Button>
      )}
    </Stack>
  )
}

function ApartmentGroup({ group, actions }: { group: Group; actions: Actions }) {
  if (!actions.admin) {
    return (
      <Group align="flex-start" wrap="nowrap" gap="md" py="sm">
        <AptPlate number={group.number} size="sm" />
        <ResidentList group={group} actions={actions} />
      </Group>
    )
  }
  return (
    <Stack gap="xs" py="sm">
      <Group justify="space-between" wrap="nowrap" gap="md">
        <Group gap="md" wrap="nowrap">
          <AptPlate number={group.number} size="sm" />
          <Text fw={600}>{he.apartment(group.number)}</Text>
        </Group>
        <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={he.tenants.editApartmentN(group.number)}
          onClick={() => actions.open({ kind: 'apartment', apartmentId: group.apartmentId })}>
          <IconPencil size={20} stroke={1.75} aria-hidden="true" />
        </ActionIcon>
      </Group>
      <ResidentList group={group} actions={actions} />
    </Stack>
  )
}

function DirectoryDialogs({ dialog, close }: { dialog: Dialog; close: () => void }) {
  const apartments = useApartments()
  const remove = useDeleteResident()
  // Keep the last dialog while the modal animates out, so titles and forms don't flash to another mode.
  const [shown, setShown] = useState<Dialog>(null)
  if (dialog && dialog !== shown) setShown(dialog)
  const apartment = shown?.kind === 'apartment' ? apartments.data?.find((a) => a.id === shown.apartmentId) : undefined
  const target = shown?.kind === 'remove' ? shown.resident : undefined
  const editing = shown?.kind === 'resident' ? shown.resident : undefined
  const invitee = useMemo(() => (shown?.kind === 'invite' ? [shown.resident] : undefined), [shown])
  return (
    <>
      <InviteDialog opened={dialog?.kind === 'invite'} prefill={invitee} onClose={close} />
      <FormModal opened={dialog?.kind === 'apartment' && Boolean(apartment)} title={he.tenants.editApartment} onClose={close}>
        <ApartmentForm apartment={apartment} onDone={close} />
      </FormModal>
      <FormModal opened={dialog?.kind === 'resident'} title={editing ? he.tenants.editResident : he.tenants.addResident} onClose={close}>
        {shown?.kind === 'resident' && <ResidentForm apartmentId={shown.apartmentId} resident={editing} onDone={close} />}
      </FormModal>
      <ConfirmDialog opened={dialog?.kind === 'remove'} title={he.tenants.deleteResidentConfirm(target?.full_name ?? '')}
        body={he.tenants.cannotUndo} confirmLabel={he.tenants.removeResident}
        loading={remove.isPending} failed={remove.isError} onClose={close}
        onConfirm={() => target && remove.mutate(target.id, { onSuccess: () => { notifySuccess(he.toast.residentDeleted); close() } })} />
    </>
  )
}

/** Admins: whether a resident can be invited (an email, no login yet). */
function useInvitable(isAdmin: boolean): (r: DirectoryEntry) => boolean {
  const profiles = useProfiles(isAdmin)
  return (r) => Boolean(r.email && profiles.data && !hasAccount(r, profiles.data))
}

/** Everyone's phone book: residents grouped by apartment, searchable by name or apartment number. */
export default function DirectoryPage() {
  const directory = useDirectory()
  const { isAdmin } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)
  const actions: Actions = { admin: isAdmin, open: setDialog, invitable: useInvitable(isAdmin) }
  // ?q= (the header search) starts the list filtered.
  const [params] = useSearchParams()
  const linked = params.get('q')
  const [query, setQuery] = useState(linked ?? '')
  // A new ?q= while the page is open (another search result) replaces the filter.
  const [seenLink, setSeenLink] = useState(linked)
  if (linked !== seenLink) { setSeenLink(linked); setQuery(linked ?? '') }
  const q = query.trim()
  const apartments = useApartments()
  const groups = useMemo(() => {
    const found = groupByApartment((directory.data ?? []).filter((e) => matches(e, q)))
    return isAdmin ? withEmptyApartments(found, apartments.data ?? [], q) : found
  }, [directory.data, apartments.data, isAdmin, q])
  const { action: exportAction, lines } = useDirectoryExport(groups, apartments.data ?? [], q !== '', Boolean(directory.data && apartments.data))
  const empty = directory.data?.length === 0 && !(isAdmin && apartments.data?.length)
  return (
    <Stack gap="md">
      <PageHeader title={he.nav.directory} subtitle={he.nav.hints.directory} secondaryAction={exportAction} />
      <TextInput aria-label={he.tenants.search} placeholder={he.tenants.searchPlaceholder} value={query}
        onChange={(e) => setQuery(e.currentTarget.value)} leftSection={<IconSearch size={18} stroke={1.75} />} type="search" />
      <Card padding="md">
        {directory.isError && <Text c="debt.7">{he.tenants.loadError}</Text>}
        {directory.isLoading && <ListSkeleton rows={5} />}
        {empty && <EmptyState title={he.tenants.directoryEmpty} body={he.tenants.directoryEmptyBody} />}
        {!empty && directory.data && groups.length === 0 && <EmptyState title={he.tenants.noMatches} />}
        {groups.map((g, i) => (
          <Fragment key={g.apartmentId}>
            {i > 0 && <Divider color="stone.1" />}
            <ApartmentGroup group={g} actions={actions} />
          </Fragment>
        ))}
      </Card>
      {isAdmin && <DirectoryPrintView lines={lines} />}
      {isAdmin && <DirectoryDialogs dialog={dialog} close={() => setDialog(null)} />}
    </Stack>
  )
}
