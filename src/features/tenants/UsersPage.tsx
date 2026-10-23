import { Badge, Button, Card, Group, SegmentedControl, Select, Stack, Text, Title } from '@mantine/core'
import { useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { AptPlate, EmptyState, ListSkeleton, notifySuccess, PageHeader } from '../../ui'
import {
  useApproveProfile,
  useDirectory,
  useProfiles,
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

function PendingRow({ p, residents, options }: { p: Profile; residents: DirectoryEntry[]; options: Option[] }) {
  const approve = useApproveProfile()
  const byEmail = residents.find((r) => r.email && r.email.toLowerCase() === p.email?.toLowerCase())
  const [residentId, setResidentId] = useState<string | null>(byEmail?.id ?? null)
  const [role, setRole] = useState<Role>('resident')
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const onApprove = () => {
    setState('busy')
    approve({ userId: p.user_id, residentId, role }).then(() => { setState('idle'); notifySuccess(he.toast.userApproved) }, () => setState('failed'))
  }
  return (
    <Card padding="md" data-testid={`pending-${p.user_id}`}>
      <Stack gap="sm">
        <Identity p={p} plate={null} />
        <Group align="flex-end" wrap="wrap" gap="sm">
          <ResidentSelect value={residentId} onChange={setResidentId} options={options} />
          <RoleControl value={role} onChange={setRole} />
          <Button onClick={onApprove} loading={state === 'busy'}>{he.users.approve}</Button>
        </Group>
        {state === 'failed' && <Text c="debt.7" size="sm">{he.users.actionError}</Text>}
      </Stack>
    </Card>
  )
}

function UserRow({ p, residents, options, isMe }: { p: Profile; residents: DirectoryEntry[]; options: Option[]; isMe: boolean }) {
  const update = useUpdateProfile()
  const locked = p.is_super_admin || isMe
  const linked = residents.find((r) => r.id === p.resident_id)
  const patch = (values: Parameters<typeof update.mutate>[0]['patch']) => update.mutate({ userId: p.user_id, patch: values }, { onSuccess: () => notifySuccess(he.toast.userUpdated) })
  return (
    <Card padding="md" data-testid={`user-${p.user_id}`}>
      <Stack gap="sm">
        <Identity p={p} plate={linked?.apartmentNumber ?? null}>
          {p.is_super_admin && <Badge color="enamel" c="enamel.9">{he.users.superAdmin}</Badge>}
          {isMe && !p.is_super_admin && <Badge color="stone" c="stone.9">{he.users.you}</Badge>}
        </Identity>
        <Group align="flex-end" wrap="wrap" gap="sm">
          <ResidentSelect value={p.resident_id} onChange={(id) => patch({ resident_id: id })} options={options} />
          <RoleControl value={p.role} onChange={(role) => patch({ role })} disabled={locked} />
          <Button variant="subtle" color="debt" disabled={locked} onClick={() => patch({ status: 'pending' })}>
            {he.users.block}
          </Button>
        </Group>
        {update.isError && <Text c="debt.7" size="sm">{he.users.actionError}</Text>}
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

export default function UsersPage() {
  const { profile: me } = useAuth()
  const profiles = useProfiles()
  const directory = useDirectory()
  const residents = useMemo(() => directory.data ?? [], [directory.data])
  const options = useMemo(() => residents.map((r) => ({ value: r.id, label: he.users.residentOption(r.apartmentNumber, r.full_name) })), [residents])
  const pending = profiles.data?.filter((p) => p.status === 'pending') ?? []
  const approved = profiles.data?.filter((p) => p.status === 'approved') ?? []
  const row = { residents, options }
  if (profiles.isError || directory.isError) return <Text c="debt.7">{he.tenants.loadError}</Text>
  return (
    <Stack gap="xl">
      <PageHeader title={he.nav.users} />
      {profiles.isLoading || directory.isLoading ? <ListSkeleton /> : (
        <>
          <Section title={he.users.pending}>
            {pending.length === 0
              ? <Card padding="md"><EmptyState title={he.users.noPending} body={he.users.noPendingBody} /></Card>
              : pending.map((p) => <PendingRow key={p.user_id} p={p} {...row} />)}
          </Section>
          <Section title={he.users.approved}>
            {approved.map((p) => <UserRow key={p.user_id} p={p} {...row} isMe={p.user_id === me?.user_id} />)}
          </Section>
        </>
      )}
    </Stack>
  )
}
