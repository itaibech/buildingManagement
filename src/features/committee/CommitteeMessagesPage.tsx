import { Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core'
import { IconMailForward } from '@tabler/icons-react'
import { formatDate } from '../../lib/format'
import { he } from '../../lib/he'
import { AptPlate, EmptyState, ListSkeleton, PageHeader } from '../../ui'
import { LoadError } from '../home/parts'
import { replyHref, useCommitteeMessages, type CommitteeMessage } from './api'

const I = he.committee.inbox

function MessageCard({ m }: { m: CommitteeMessage }) {
  const href = replyHref(m)
  const name = m.sender_name || I.unknownSender
  return (
    <Card>
      <Group gap="sm" wrap="nowrap" align="flex-start" mb="xs">
        {m.apartment_number !== null && <AptPlate number={m.apartment_number} size="sm" />}
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Title order={2} size="h5">{m.subject}</Title>
          <Text size="sm" c="dimmed" className="bm-num">{`${name} · ${formatDate(m.created_at)}`}</Text>
        </Stack>
        <Badge color={m.recipient_id ? 'enamel' : 'stone'} variant="light">{m.recipient_id ? I.toMe : I.toAll}</Badge>
      </Group>
      <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</Text>
      {href
        ? <Button component="a" href={href} variant="light" mt="sm" leftSection={<IconMailForward size={20} stroke={1.75} aria-hidden="true" />}
            aria-label={I.replyLabel(name)} style={{ alignSelf: 'flex-start' }}>{I.reply}</Button>
        : <Text size="sm" c="dimmed" mt="sm">{I.noEmail}</Text>}
    </Card>
  )
}

/** Admin "פניות דיירים": the messages residents sent to the whole committee or to this admin, newest first. */
export default function CommitteeMessagesPage() {
  const { data, isLoading, isError, refetch } = useCommitteeMessages()
  return (
    <Stack gap="md">
      <PageHeader title={I.title} />
      {isLoading && <ListSkeleton rows={3} />}
      {isError && <Card><LoadError onRetry={() => void refetch()} /></Card>}
      {data?.length === 0 && <Card><EmptyState title={I.empty} body={I.emptyBody} /></Card>}
      {data?.map((m) => <MessageCard key={m.id} m={m} />)}
    </Stack>
  )
}
