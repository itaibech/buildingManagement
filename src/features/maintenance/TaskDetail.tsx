import { Anchor, Card, Group, Stack, Text } from '@mantine/core'
import { IconFileText } from '@tabler/icons-react'
import { useAuth } from '../../auth/AuthProvider'
import { formatDate } from '../../lib/format'
import { he } from '../../lib/he'
import { ListSkeleton, Money } from '../../ui'
import { useSupplierFileUrls } from '../suppliers/files'
import { useTaskLog, useTasks, type LogEntry } from './api'

/** The attached inspection report: a download link for admins (the bucket is admin-only), its name for everyone else. */
function Report({ entry, url }: { entry: LogEntry; url: string | undefined }) {
  if (!entry.report_name) return null
  return (
    <Group gap={6} wrap="nowrap" mih={44}>
      <IconFileText size={18} stroke={1.75} aria-hidden="true" style={{ flexShrink: 0 }} />
      {url
        ? <Anchor href={url} target="_blank" rel="noopener noreferrer" aria-label={he.maintenance.reportOpen(entry.report_name)}
            mih={44} style={{ display: 'inline-flex', alignItems: 'center', overflowWrap: 'anywhere' }}>{entry.report_name}</Anchor>
        : <Text size="sm" style={{ overflowWrap: 'anywhere' }}>{entry.report_name}</Text>}
    </Group>
  )
}

/** Task summary and its done log, newest first. */
export function TaskDetail({ taskId }: { taskId: string }) {
  const { isAdmin } = useAuth()
  const task = useTasks().data?.find((t) => t.id === taskId)
  const log = useTaskLog(taskId)
  const reports = (isAdmin ? log.data ?? [] : []).flatMap((e) => (e.report_path ? [{ path: e.report_path, name: e.report_name ?? '' }] : []))
  const urls = useSupplierFileUrls(reports)
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
          <Report entry={e} url={e.report_path ? urls.data?.[e.report_path] : undefined} />
        </Card>
      ))}
    </Stack>
  )
}
