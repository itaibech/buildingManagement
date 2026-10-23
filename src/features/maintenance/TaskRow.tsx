import { ActionIcon, Button, Card, Group, Menu, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconDots, IconPencil, IconTrash } from '@tabler/icons-react'
import { formatDate } from '../../lib/format'
import { he } from '../../lib/he'
import { StatusBadge } from '../../ui'
import type { Task } from './api'
import type { DueBucket } from './nextDue'

export interface TaskActions {
  onDone: (task: Task) => void
  onEdit: (task: Task) => void
  onDelete: (task: Task) => void
}

function ItemMenu({ task, actions }: { task: Task; actions: TaskActions }) {
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={he.maintenance.actions(task.title)}>
          <IconDots size={20} stroke={1.75} aria-hidden="true" />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconPencil size={18} stroke={1.75} />} onClick={() => actions.onEdit(task)}>{he.maintenance.edit}</Menu.Item>
        <Menu.Item color="debt" leftSection={<IconTrash size={18} stroke={1.75} />} onClick={() => actions.onDelete(task)}>{he.maintenance.delete}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

function Meta({ task }: { task: Task }) {
  const parts = [task.vendor, he.maintenance.frequencies[task.frequency], task.next_due ? he.maintenance.due(formatDate(task.next_due)) : null]
  return <Text size="sm" c="dimmed" className="bm-num">{parts.filter(Boolean).join(' · ')}</Text>
}

export interface TaskRowProps {
  task: Task
  bucket: DueBucket
  onOpen: (task: Task) => void
  /** Admin only: shows the done button and edit/delete menu. */
  actions?: TaskActions
  /** False in the grouped list, where the section heading already names the status. */
  showStatus?: boolean
}

/** One task: tap to open its done log; admins can mark it done, edit or delete it. */
export function TaskRow({ task, bucket, onOpen, actions, showStatus = true }: TaskRowProps) {
  return (
    <Card padding={0} data-testid={`task-${task.id}`}>
      <UnstyledButton onClick={() => onOpen(task)} aria-label={he.maintenance.openTask(task.title)} mih={44} p="md" className="bm-row" style={{ display: 'block', width: '100%' }}>
        <Stack gap={4}>
          <Group gap="sm" wrap="wrap">
            <Text fw={600}>{task.title}</Text>
            {showStatus && <StatusBadge kind="due" value={bucket} />}
          </Group>
          <Meta task={task} />
        </Stack>
      </UnstyledButton>
      {actions && (
        <Group justify="space-between" px="md" pb="sm" gap="xs">
          <Button variant="light" mih={44} onClick={() => actions.onDone(task)}>{he.maintenance.markDone}</Button>
          <ItemMenu task={task} actions={actions} />
        </Group>
      )}
    </Card>
  )
}
