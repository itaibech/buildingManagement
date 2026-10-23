import { Card, Group, Stack, Text } from '@mantine/core'
import { formatDate } from '../../lib/format'
import { he } from '../../lib/he'
import { ListSkeleton, Money } from '../../ui'
import { useTaskLog, useTasks } from './api'

/** Task summary and its done log, newest first. */
export function TaskDetail({ taskId }: { taskId: string }) {
  const task = useTasks().data?.find((t) => t.id === taskId)
  const log = useTaskLog(taskId)
  if (!task) return null
  return (
    <Stack gap="sm">
      <Text c="dimmed" className="bm-num">
        {[task.vendor, he.maintenance.frequencies[task.frequency], task.next_due ? he.maintenance.due(formatDate(task.next_due)) : null].filter(Boolean).join(' · ')}
      </Text>
      <Text fw={600}>{he.maintenance.log}</Text>
      {log.isLoading && <ListSkeleton rows={2} />}
      {log.isError && <Text c="debt.7">{he.maintenance.errors.load}</Text>}
      {log.data?.length === 0 && <Text c="dimmed">{he.maintenance.noLog}</Text>}
      {log.data?.map((e) => (
        <Card key={e.id} padding="sm" data-testid={`log-${e.id}`}>
          <Group justify="space-between" wrap="nowrap">
            <Text className="bm-num" fw={600}>{formatDate(e.done_on)}</Text>
            {e.cost !== null && e.cost > 0 && <Money amount={e.cost} tone="neutral" size="sm" />}
          </Group>
          {e.note && <Text style={{ whiteSpace: 'pre-wrap' }}>{e.note}</Text>}
        </Card>
      ))}
    </Stack>
  )
}
