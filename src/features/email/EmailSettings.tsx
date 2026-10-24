import { Badge, Button, Card, Divider, Group, Stack, Text, Title } from '@mantine/core'
import { IconMailForward } from '@tabler/icons-react'
import { Fragment } from 'react'
import { formatDate } from '../../lib/format'
import { he } from '../../lib/he'
import { ListSkeleton } from '../../ui'
import { useEmailLog, useEmailPreview, useSendEmail } from './api'
import { DryRunNotice } from './parts'

const TEST = { kind: 'test' as const }
const time = (iso: string): string => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

function History() {
  const log = useEmailLog()
  if (log.isLoading) return <ListSkeleton rows={3} />
  if (log.isError) return <Text size="sm" c="debt.7">{he.mail.settings.loadFailed}</Text>
  if (!log.data?.length) return <Text size="sm" c="dimmed">{he.mail.settings.empty}</Text>
  return (
    <Stack gap={0}>
      {log.data.map((r, i) => (
        <Fragment key={r.id}>
          {i > 0 && <Divider color="stone.1" />}
          <Group justify="space-between" wrap="nowrap" py="xs" gap="sm">
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Text size="sm" fw={600}>{he.mail.settings.kinds[r.kind] ?? r.kind}</Text>
              <Text size="sm" c="dimmed" className="bm-num">{he.mail.settings.counts(r.recipients, r.sent, r.failed)}</Text>
            </Stack>
            <Stack gap={2} align="flex-end" style={{ flexShrink: 0 }}>
              <Text size="sm" c="dimmed" className="bm-num">{`${formatDate(new Date(r.created_at))} ${time(r.created_at)}`}</Text>
              {r.dry_run && <Badge size="sm" color="stone" variant="light">{he.mail.settings.dryRun}</Badge>}
            </Stack>
          </Group>
        </Fragment>
      ))}
    </Stack>
  )
}

/** Settings card (admin): test email, dry-run notice and the latest sends. */
export function EmailSettings() {
  const status = useEmailPreview(TEST)
  const send = useSendEmail()
  return (
    <Card maw={720}>
      <Title order={2} size="h4">{he.mail.settings.title}</Title>
      <Text size="sm" c="dimmed" mb="sm">{he.mail.settings.body}</Text>
      <Stack>
        {status.data?.dryRun && <DryRunNotice />}
        <Button variant="light" leftSection={<IconMailForward size={20} stroke={1.75} aria-hidden="true" />} loading={send.isPending}
          onClick={() => send.mutate(TEST)} w={{ base: '100%', sm: 'auto' }} style={{ alignSelf: 'flex-start' }}>
          {he.mail.settings.test}
        </Button>
        <Title order={3} size="h5">{he.mail.settings.history}</Title>
        <History />
      </Stack>
    </Card>
  )
}
