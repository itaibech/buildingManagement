import { ActionIcon, Box, Card, Group, Stack, Text, Textarea, Title } from '@mantine/core'
import { IconSend } from '@tabler/icons-react'
import { useState } from 'react'
import { formatDate } from '../../lib/format'
import { he } from '../../lib/he'
import { notifyError } from '../../ui'
import { useAddComment, type TicketComment } from './api'

function CommentItem({ c }: { c: TicketComment }) {
  return (
    <Box py="xs">
      <Group gap="xs" justify="space-between" wrap="nowrap">
        <Text fw={600} size="sm" data-testid="comment-author">{c.authorName ?? he.tickets.someone}</Text>
        <Text size="sm" c="dimmed" className="bm-num">{formatDate(c.created_at)}</Text>
      </Group>
      <Text style={{ whiteSpace: 'pre-wrap' }}>{c.body}</Text>
    </Box>
  )
}

function Composer({ ticketId }: { ticketId: string }) {
  const [body, setBody] = useState('')
  const add = useAddComment()
  const send = () => {
    const text = body.trim()
    if (!text) return
    add.mutate({ ticketId, body: text }, { onSuccess: () => setBody(''), onError: () => notifyError(he.toast.failed) })
  }
  return (
    <Group className="bm-composer" gap="xs" wrap="nowrap" align="flex-end">
      <Textarea aria-label={he.tickets.comment} placeholder={he.tickets.commentPlaceholder} autosize minRows={1} maxRows={5}
        value={body} onChange={(e) => setBody(e.currentTarget.value)} style={{ flex: 1 }} />
      <ActionIcon size={44} aria-label={he.tickets.sendComment} onClick={send} loading={add.isPending} disabled={!body.trim()}>
        <IconSend size={20} stroke={1.75} className="bm-mirror" />
      </ActionIcon>
    </Group>
  )
}

/** Comment thread (oldest first) with a composer that sticks above the tab bar on mobile. */
export function TicketComments({ ticketId, comments }: { ticketId: string; comments: TicketComment[] }) {
  return (
    <Stack gap="xs">
      <Title order={2} size="h4">{he.tickets.comments}</Title>
      <Card padding="md">
        {comments.length === 0 && <Text c="dimmed">{he.tickets.noComments}</Text>}
        <Stack gap={0} className="bm-divided">
          {comments.map((c) => <CommentItem key={c.id} c={c} />)}
        </Stack>
      </Card>
      <Composer ticketId={ticketId} />
    </Stack>
  )
}
