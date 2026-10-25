import { ActionIcon, Badge, Button, Card, Group, Menu, SegmentedControl, Select, Stack, Text, Title } from '@mantine/core'
import { IconDots, IconTrash, IconUserPlus } from '@tabler/icons-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { AptPlate, EmptyState, ListSkeleton, notifyError, notifySuccess, PageHeader } from '../../ui'
import { usersRows } from '../export/buildWorkbook'
import { useExportAction } from '../export/useExport'
import { useGroups, type Group as UserGroup } from '../permissions/api'
import { DeleteUserDialog } from './DeleteUserDialog'
import { InviteDialog } from './InviteDialog'
import { summarize } from './invite'
import {
  awaitingFirstSignIn,
  useApproveProfile,
  useDirectory,
  useInviteUsers,
  useProfiles,
  useSignInStatus,
  useUpdateProfile,
  type DirectoryEntry,
  type Profile,
  type Role,
} from './api'

interface Option {
  value: string
  label: string
}

const toRole = (v: string): Role => (v === 'admin' ? 'admin' : 'resident')

function RoleControl({ value, onChange, disabled }: { value: string; onChange: (r: Role) => void; disabled?: boolean }) {
  return (
    <SegmentedControl
      aria-label={he.users.role}
      value={value}
      onChange={(v) => onChange(toRole(v))}
      disabled={disabled}
      data={[
        { value: 'resident', label: he.users.roleResident },
        { value: 'admin', label: he.users.roleAdmin },
      ]}
    />
  )
}

function ResidentSelect({ value, onChange, options }: { value: string | null; onChange: (id: string | null) => void; options: Option[] }) {
  return (
    <Select
      label={he.users.linkResident}
      placeholder={he.users.noLink}
      data={options}
      value={value}
      onChange={onChange}
      clearable
      searchable
      style={{ flex: 1, minWidth: 220 }}
    />
  )
}

function GroupSelect({ value, onChange, groups }: { value: string | null; onChange: (id: string) => void; groups: UserGroup[] }) {
  return (
    <Select label={he.permissions.group} data={groups.map((g) => ({ value: g.id, label: g.name }))} value={value}
      onChange={(id) => id && onChange(id)} allowDeselect={false} style={{ minWidth: 180 }} />
  )
}

const defaultGroupId = (groups: UserGroup[]): string | null => groups.find((g) => g.isDefault)?.id ?? null
/** The default group is stored as null, so the user follows a later change of default. */
const storedGroup = (id: string | null, groups: UserGroup[]): string | null => (id === defaultGroupId(groups) ? null : id)

function Identity({ p, plate, children }: { p: Profile; plate: number | null; children?: ReactNode }) {
  return (
    <Group gap="sm" wrap="nowrap" align="center">
      {plate !== null && <AptPlate number={plate} size="sm" />}
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} truncate>{p.full_name || p.email}</Text>
        {p.email && <Text size="sm" c="dimmed" truncate>{p.email}</Text>}
      </Stack>
      {children}
    </Group>
  )
}

interface RowProps { residents: DirectoryEntry[]; options: Option[]; groups: UserGroup[]; invited: ReadonlySet<string> }

/** Invited and never signed in: the badge and "שליחה חוזרת" (calls admin-invite-user again). */
function InvitedMark({ p }: { p: Profile }) {
  const invite = useInviteUsers()
  const resend = () => p.email && invite.mutate({ invites: [{ email: p.email }], groupId: null }, {
    onSuccess: (results) => (results.some((r) => r.outcome === 'resent' || r.outcome === 'sent') ? notifySuccess : notifyError)(summarize(results)),
    onError: (e) => notifyError(e.message),
  })
  return (
    <Group gap="xs" wrap="wrap">
      <Badge color="signal" c="signal.9">{he.users.invitedBadge}</Badge>
      {p.email && <Button variant="subtle" size="compact-md" mih={44} loading={invite.isPending} onClick={resend}>{he.users.resend}</Button>}
    </Group>
  )
}

function PendingRow({ p, residents, options, groups, invited }: RowProps & { p: Profile }) {
  const approve = useApproveProfile()
  const byEmail = residents.find((r) => r.email && r.email.toLowerCase() === p.email?.toLowerCase())
  const [residentId, setResidentId] = useState<string | null>(byEmail?.id ?? null)
  const [role, setRole] = useState<Role>('resident')
  const [picked, setPicked] = useState<string | null>(null)
  const groupId = picked ?? defaultGroupId(groups)
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const onApprove = () => {
    setState('busy')
    approve({ userId: p.user_id, residentId, role, groupId: storedGroup(groupId, groups) }).then(() => { setState('idle'); notifySuccess(he.toast.userApproved) }, () => setState('failed'))
  }
  return (
    <Card padding="md" data-testid={`pending-${p.user_id}`}>
      <Stack gap="sm">
        <Identity p={p} plate={null} />
        {invited.has(p.user_id) && <InvitedMark p={p} />}
        <Group align="flex-end" wrap="wrap" gap="sm">
          <ResidentSelect value={residentId} onChange={setResidentId} options={options} />
          <RoleControl value={role} onChange={setRole} />
          {role === 'resident' && <GroupSelect value={groupId} onChange={setPicked} groups={groups} />}
          <Button onClick={onApprove} loading={state === 'busy'}>{he.users.approve}</Button>
        </Group>
        {state === 'failed' && <Text c="debt.7" size="sm">{he.users.actionError}</Text>}
      </Stack>
    </Card>
  )
}

function UserControls({ p, options, groups, locked }: { p: Profile; options: Option[]; groups: UserGroup[]; locked: boolean }) {
  const update = useUpdateProfile()
  const patch = (values: Parameters<typeof update.mutate>[0]['patch']) => update.mutate({ userId: p.user_id, patch: values }, { onSuccess: () => notifySuccess(he.toast.userUpdated) })
  return (
    <>
      <Group align="flex-end" wrap="wrap" gap="sm">
        <ResidentSelect value={p.resident_id} onChange={(id) => patch({ resident_id: id })} options={options} />
        <RoleControl value={p.role} onChange={(role) => patch({ role })} disabled={locked} />
        {p.role !== 'admin' && <GroupSelect value={p.group_id ?? defaultGroupId(groups)} onChange={(id) => patch({ group_id: storedGroup(id, groups) })} groups={groups} />}
        <Button variant="subtle" color="debt" disabled={locked} onClick={() => patch({ status: 'pending' })}>
          {he.users.block}
        </Button>
      </Group>
      {update.isError && <Text c="debt.7" size="sm">{he.users.actionError}</Text>}
    </>
  )
}

/** An approved user: read-only by default (role and apartment in words); "עריכה" opens the controls. */
function summaryOf(p: Profile, linked: DirectoryEntry | undefined, groups: UserGroup[]): string {
  const group = groups.find((g) => g.id === (p.group_id ?? defaultGroupId(groups)))
  return [
    p.role === 'admin' ? he.users.roleAdmin : he.users.roleResident,
    linked ? he.apartment(linked.apartmentNumber) : he.users.noLink,
    ...(p.role !== 'admin' && group ? [he.users.groupSummary(group.name)] : []),
  ].join(' · ')
}

/** The user's ⋯ menu: "מחיקת משתמש", disabled for yourself and for the super admin. */
function UserMenu({ p, isMe, onDelete }: { p: Profile; isMe: boolean; onDelete: () => void }) {
  const blocked = isMe ? he.users.cannotDeleteSelf : p.is_super_admin ? he.users.cannotDeleteSuper : null
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={he.users.actions(p.full_name || p.email || '')}>
          <IconDots size={20} stroke={1.75} aria-hidden="true" />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item color="debt" leftSection={<IconTrash size={18} stroke={1.75} />} disabled={blocked !== null} onClick={onDelete}>
          {he.users.deleteUser}
          {blocked && <Text size="xs" c="dimmed">{blocked}</Text>}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

function UserRow({ p, residents, options, groups, invited, isMe, onDelete }: RowProps & { p: Profile; isMe: boolean; onDelete: () => void }) {
  const [editing, setEditing] = useState(false)
  const linked = residents.find((r) => r.id === p.resident_id)
  const summary = summaryOf(p, linked, groups)
  return (
    <Card padding="md" data-testid={`user-${p.user_id}`}>
      <Stack gap="sm">
        <Identity p={p} plate={linked?.apartmentNumber ?? null}>
          {p.is_super_admin && <Badge color="enamel" c="enamel.9">{he.users.superAdmin}</Badge>}
          {isMe && !p.is_super_admin && <Badge color="stone" c="stone.9">{he.users.you}</Badge>}
          <Button variant="subtle" px="xs" onClick={() => setEditing(!editing)} aria-expanded={editing}>
            {editing ? he.users.done : he.users.edit}
          </Button>
          <UserMenu p={p} isMe={isMe} onDelete={onDelete} />
        </Identity>
        {invited.has(p.user_id) && <InvitedMark p={p} />}
        {editing ? <UserControls p={p} options={options} groups={groups} locked={p.is_super_admin || isMe} /> : <Text size="sm" c="dimmed">{summary}</Text>}
      </Stack>
    </Card>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="sm">
      <Title order={2} size="h4">{title}</Title>
      {children}
    </Stack>
  )
}

/** Users invited by email who never signed in (user_sign_in_status). */
function useInvitedIds(): ReadonlySet<string> {
  const signIn = useSignInStatus()
  return useMemo(() => new Set([...(signIn.data ?? [])].filter(([, s]) => awaitingFirstSignIn(s)).map(([id]) => id)), [signIn.data])
}

export default function UsersPage() {
  const { profile: me } = useAuth()
  const profiles = useProfiles()
  const directory = useDirectory()
  const groups = useGroups()
  const invited = useInvitedIds()
  const [inviting, setInviting] = useState(false)
  const residents = useMemo(() => directory.data ?? [], [directory.data])
  const options = useMemo(() => residents.map((r) => ({ value: r.id, label: he.users.residentOption(r.apartmentNumber, r.full_name) })), [residents])
  const pending = profiles.data?.filter((p) => p.status === 'pending') ?? []
  const approved = profiles.data?.filter((p) => p.status === 'approved') ?? []
  const row: RowProps = { residents, options, groups: groups.data ?? [], invited }
  const [deleting, setDeleting] = useState<Profile | null>(null)
  const exportAction = useExportAction(
    he.export.files.users,
    () => usersRows(profiles.data ?? [], (id) => residents.find((r) => r.id === id)?.apartmentNumber ?? null),
    !!profiles.data && !!directory.data,
  )
  if (profiles.isError || directory.isError) return <Text c="debt.7">{he.tenants.loadError}</Text>
  return (
    <Stack gap="xl">
      <PageHeader title={he.nav.users} subtitle={he.nav.hints.users} secondaryAction={exportAction}
        action={{ label: he.invite.open, onClick: () => setInviting(true), icon: <IconUserPlus size={22} stroke={1.75} /> }} />
      {profiles.isLoading || directory.isLoading ? <ListSkeleton /> : (
        <>
          <Section title={he.users.pending}>
            {pending.length === 0
              ? <Card padding="md"><EmptyState title={he.users.noPending} body={he.users.noPendingBody} /></Card>
              : pending.map((p) => <PendingRow key={p.user_id} p={p} {...row} />)}
          </Section>
          <Section title={he.users.approved}>
            {approved.map((p) => <UserRow key={p.user_id} p={p} {...row} isMe={p.user_id === me?.user_id} onDelete={() => setDeleting(p)} />)}
          </Section>
          <DeleteUserDialog profile={deleting} onClose={() => setDeleting(null)} />
          <InviteDialog opened={inviting} onClose={() => setInviting(false)} />
        </>
      )}
    </Stack>
  )
}
