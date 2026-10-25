import { Alert, Badge, Button, Card, Group as Row, SimpleGrid, Stack, Text } from '@mantine/core'
import { IconLock } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { he } from '../../lib/he'
import { ListSkeleton, PageHeader } from '../../ui'
import { LoadFailed } from '../finance/cards'
import { FormModal } from '../tenants/dialogs'
import { useProfiles } from '../tenants/api'
import { PERMISSIONS_SEEN_KEY } from '../home/checklist'
import { useGroups, type Group } from './api'
import { memberCounts } from './groups'
import { GroupEditor } from './GroupEditor'
import { GroupForm } from './GroupForm'

function GroupCard({ group, members, selected, onSelect }: { group: Group; members: number; selected: boolean; onSelect: () => void }) {
  return (
    <Card padding="md" data-testid={`group-${group.name}`} style={selected ? { borderColor: 'var(--mantine-color-enamel-6)' } : undefined}>
      <Row justify="space-between" wrap="nowrap">
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Row gap="xs">
            <Text fw={600} truncate>{group.name}</Text>
            {group.isDefault && <Badge color="enamel" c="enamel.9">{he.permissions.default}</Badge>}
          </Row>
          <Text size="sm" c="dimmed" className="bm-num">{he.permissions.members(members)}</Text>
        </Stack>
        <Button variant={selected ? 'light' : 'subtle'} px="xs" onClick={onSelect} aria-pressed={selected}>{he.permissions.edit}</Button>
      </Row>
    </Card>
  )
}

function GroupList({ groups, selectedId, onSelect }: { groups: Group[]; selectedId: string; onSelect: (id: string) => void }) {
  const profiles = useProfiles()
  const counts = useMemo(() => memberCounts(groups, profiles.data ?? []), [groups, profiles.data])
  return (
    <Stack gap="sm">
      <Text fw={600}>{he.permissions.groups}</Text>
      {groups.map((g) => (
        <GroupCard key={g.id} group={g} members={counts.get(g.id) ?? 0} selected={g.id === selectedId} onSelect={() => onSelect(g.id)} />
      ))}
    </Stack>
  )
}

/** Admin "הרשאות וקבוצות": user groups and the pages each one sees. The server enforces every toggle. */
export default function PermissionsPage() {
  // The home setup checklist's "סקירת הרשאות הדיירים" step: done once the admin has opened this page.
  useEffect(() => { localStorage.setItem(PERMISSIONS_SEEN_KEY, 'true') }, [])
  const q = useGroups()
  const [picked, setPicked] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const groups = q.data ?? []
  const selected = groups.find((g) => g.id === picked) ?? groups.find((g) => g.isDefault) ?? groups[0]
  return (
    <Stack gap="lg">
      <PageHeader title={he.permissions.title} action={{ label: he.permissions.newGroup, onClick: () => setCreating(true) }} />
      <Text c="dimmed" maw={720}>{he.permissions.help}</Text>
      <Alert color="enamel" icon={<IconLock size={20} stroke={1.75} />} maw={720}>{he.permissions.confidential}</Alert>
      {q.isLoading && <ListSkeleton rows={4} />}
      {q.isError && <LoadFailed onRetry={() => void q.refetch()} />}
      {selected && (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg" style={{ alignItems: 'start' }}>
          <GroupList groups={groups} selectedId={selected.id} onSelect={setPicked} />
          <GroupEditor key={selected.id} group={selected} onDeleted={() => setPicked(null)} />
        </SimpleGrid>
      )}
      <FormModal compact opened={creating} title={he.permissions.newGroup} onClose={() => setCreating(false)}>
        {creating && <GroupForm onDone={() => setCreating(false)} />}
      </FormModal>
    </Stack>
  )
}
