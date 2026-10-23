import { Card, Stack, Text } from '@mantine/core'
import { formatDate } from '../../lib/format'
import { he } from '../../lib/he'
import { ListSkeleton } from '../../ui'
import { useTaskLog, type Task } from './api'

/** Task summary and its done log, newest first. */
export function TaskDetail({ task }: { task: Task }) {
  const log = useTaskLog(task.id)
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
          <Text className="bm-num" fw={600}>{formatDate(e.done_on)}</Text>
          {e.note && <Text style={{ whiteSpace: 'pre-wrap' }}>{e.note}</Text>}
        </Card>
      ))}
    </Stack>
  )
}
