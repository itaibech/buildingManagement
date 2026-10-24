import { Alert, Anchor, Button, Group, Loader, Text } from '@mantine/core'
import type { UseQueryResult } from '@tanstack/react-query'
import { he } from '../../lib/he'
import type { EmailPreview } from './api'

/** Shown while the function runs in dry run (no provider secrets yet): nothing is really sent. */
export function DryRunNotice() {
  return (
    <Alert color="signal" title={he.mail.notConfigured}>
      <Text size="sm">{he.mail.notConfiguredBody}</Text>
      <Anchor href={he.mail.setupUrl} target="_blank" rel="noopener noreferrer" size="sm" fw={600}>{he.mail.setupLink}</Anchor>
    </Alert>
  )
}

/** "יישלח ל-N נמענים", or why it can't be counted; plus the dry-run notice and apartments skipped (no debt). */
export function PreviewInfo({ q, idle = false }: { q: UseQueryResult<EmailPreview>; idle?: boolean }) {
  if (idle) return null
  if (q.isLoading) return <Group gap="xs"><Loader size="xs" /><Text size="sm" c="dimmed">{he.mail.counting}</Text></Group>
  if (q.isError) return <Alert color="debt">{q.error.message || he.mail.previewFailed}</Alert>
  if (!q.data) return null
  const { recipients, skipped, dryRun, remainingToday } = q.data
  return (
    <>
      <Text fw={600} c={recipients === 0 ? 'debt.7' : undefined} aria-live="polite" className="bm-num">
        {recipients === 0 ? he.mail.noRecipients : he.mail.willSend(recipients)}
      </Text>
      {skipped.length > 0 && <Text size="sm" c="dimmed" className="bm-num">{he.mail.skipped(skipped.join(', '))}</Text>}
      {!dryRun && <Text size="sm" c="dimmed" className="bm-num">{he.mail.remaining(remainingToday)}</Text>}
      {dryRun && <DryRunNotice />}
    </>
  )
}

/** Cancel + send. Send is enabled only once there is someone to send to. */
export function SendActions({ count, loading, onSend, onCancel }: { count: number; loading: boolean; onSend: () => void; onCancel: () => void }) {
  return (
    <Group justify="flex-end" gap="sm">
      <Button variant="default" onClick={onCancel}>{he.mail.cancel}</Button>
      <Button onClick={onSend} loading={loading} disabled={count === 0}>{he.mail.confirm}</Button>
    </Group>
  )
}
