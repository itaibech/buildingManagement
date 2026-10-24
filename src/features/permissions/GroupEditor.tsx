import { Badge, Button, Card, Divider, Group as Row, Stack, Switch, Text, Title } from '@mantine/core'
import { IconLock, IconPencil } from '@tabler/icons-react'
import { Fragment, useState } from 'react'
import { he } from '../../lib/he'
import { PERMISSIONS, type PermissionDef } from '../../lib/permissions'
import { notifySuccess } from '../../ui'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { useDeleteGroup, useSetDefaultGroup, useTogglePermission, type Group } from './api'
import { GroupForm } from './GroupForm'

const ICON = { size: 18, stroke: 1.75 } as const

/** One catalog entry: label and description, its switch (home: locked on). */
function PermissionToggle({ def, group }: { def: PermissionDef; group: Group }) {
  const toggle = useTogglePermission()
  const on = def.locked || group.permissions.has(def.key)
  const label = (
    <Row gap={6} wrap="nowrap">
      {def.locked && <IconLock {...ICON} aria-hidden="true" color="var(--mantine-color-stone-6)" />}
      <Text fw={600} span>{def.label}</Text>
      {def.locked && <Text size="xs" c="dimmed" span>{he.permissions.alwaysOn}</Text>}
    </Row>
  )
  const onChange = (next: boolean) =>
    toggle.mutate({ groupId: group.id, key: def.key, on: next }, { onSuccess: () => notifySuccess(he.permissions.saved) })
  return (
    <Switch size="md" py="xs" mih={44} label={label} description={def.description} checked={on} disabled={def.locked || toggle.isPending}
      onChange={(e) => onChange(e.currentTarget.checked)} styles={{ body: { justifyContent: 'space-between' }, labelWrapper: { flex: 1 } }} />
  )
}

function DeleteGroup({ group, onDeleted }: { group: Group; onDeleted: () => void }) {
  const remove = useDeleteGroup()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="subtle" color="debt" disabled={group.isDefault} onClick={() => setOpen(true)}>{he.permissions.delete}</Button>
      <ConfirmDialog opened={open} title={he.permissions.deleteTitle(group.name)} body={he.permissions.deleteBody}
        confirmLabel={he.permissions.deleteConfirm} loading={remove.isPending} failed={remove.isError} onClose={() => setOpen(false)}
        onConfirm={() => remove.mutate(group.id, { onSuccess: () => { setOpen(false); notifySuccess(he.permissions.deleted); onDeleted() } })} />
    </>
  )
}

function EditorHeader({ group, onEdit }: { group: Group; onEdit: () => void }) {
  return (
    <Row justify="space-between" wrap="nowrap" align="flex-start">
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Row gap="xs">
          <Title order={2} size="h4">{group.name}</Title>
          {group.isDefault && <Badge color="enamel" c="enamel.9">{he.permissions.default}</Badge>}
        </Row>
        {group.description && <Text size="sm" c="dimmed">{group.description}</Text>}
      </Stack>
      <Button variant="subtle" px="xs" leftSection={<IconPencil {...ICON} />} onClick={onEdit}>{he.permissions.edit}</Button>
    </Row>
  )
}

/** The selected group: its toggles (each saved at once), rename, make default, delete. */
export function GroupEditor({ group, onDeleted }: { group: Group; onDeleted: () => void }) {
  const setDefault = useSetDefaultGroup()
  const [renaming, setRenaming] = useState(false)
  return (
    <Card data-testid="group-editor">
      <EditorHeader group={group} onEdit={() => setRenaming(true)} />
      <Text fw={600} mt="md" mb={4}>{he.permissions.pages}</Text>
      <Stack gap={0}>
        {PERMISSIONS.map((def, i) => (
          <Fragment key={def.key}>
            {i > 0 && <Divider color="stone.1" />}
            <PermissionToggle def={def} group={group} />
          </Fragment>
        ))}
      </Stack>
      <Row justify="space-between" mt="md" wrap="wrap" gap="sm">
        {!group.isDefault && (
          <Button variant="light" loading={setDefault.isPending}
            onClick={() => setDefault.mutate(group.id, { onSuccess: () => notifySuccess(he.permissions.defaultSet) })}>
            {he.permissions.setDefault}
          </Button>
        )}
        <DeleteGroup group={group} onDeleted={onDeleted} />
      </Row>
      <FormModal compact opened={renaming} title={group.name} onClose={() => setRenaming(false)}>
        {renaming && <GroupForm group={group} onDone={() => setRenaming(false)} />}
      </FormModal>
    </Card>
  )
}
