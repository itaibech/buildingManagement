import { ActionIcon, Box, Card, Group, Menu, Stack, Text, Textarea, Title } from '@mantine/core'
import { IconDots, IconEyeOff, IconEye, IconSend, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { notifyError, notifySuccess } from '../../ui'
import { useAddComment, useDeleteComment, useModerate, type PostComment } from './api'
import { hasText, limitMessage, MAX_COMMENT } from './board'
import { ModerateDialog } from './ModerateDialog'
import { AuthorLine } from './PostCard'

const C = he.community
const M = C.moderation
const ICON = { size: 18, stroke: 1.75 } as const

type Pending = { action: 'hide' | 'delete'; comment: PostComment } | null

function CommentMenu({ c, mine, admin, onModerate }: { c: PostComment; mine: boolean; admin: boolean; onModerate: (p: Pending) => void }) {
  const del = useDeleteComment()
  const moderate = useModerate()
  const onError = () => notifyError(he.toast.failed)
  if (!mine && !admin) return null
  const unhide = () => moderate.mutate({ kind: 'comment', id: c.id, action: 'unhide' }, { onSuccess: () => notifySuccess(M.unhidden), onError })
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={C.commentActions}><IconDots size={18} stroke={1.75} aria-hidden="true" /></ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {mine && <Menu.Item color="debt" leftSection={<IconTrash {...ICON} />}
          onClick={() => del.mutate(c.id, { onSuccess: () => notifySuccess(C.commentDeleted), onError })}>{C.deleteComment}</Menu.Item>}
        {admin && !mine && (c.hidden_at
          ? <Menu.Item leftSection={<IconEye {...ICON} />} onClick={unhide}>{M.unhide}</Menu.Item>
          : <Menu.Item leftSection={<IconEyeOff {...ICON} />} onClick={() => onModerate({ action: 'hide', comment: c })}>{M.hide}</Menu.Item>)}
        {admin && !mine && <Menu.Item color="debt" leftSection={<IconTrash {...ICON} />}
          onClick={() => onModerate({ action: 'delete', comment: c })}>{M.remove}</Menu.Item>}
      </Menu.Dropdown>
    </Menu>
  )
}

function CommentItem({ c, onModerate }: { c: PostComment; onModerate: (p: Pending) => void }) {
  const { isAdmin, session } = useAuth()
  const mine = !!c.author_id && c.author_id === session?.user.id
  return (
    <Box py="xs" data-testid="comment">
      <Group gap="xs" justify="space-between" wrap="nowrap">
        <AuthorLine author={c.author} at={c.created_at} />
        <CommentMenu c={c} mine={mine} admin={isAdmin} onModerate={onModerate} />
      </Group>
      {c.hidden_reason && <Text size="sm" c="debt.7">{C.hiddenReason(c.hidden_reason)}</Text>}
      <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} c={c.hidden_at ? 'dimmed' : undefined}>{c.body}</Text>
    </Box>
  )
}

function Composer({ postId }: { postId: string }) {
  const [body, setBody] = useState('')
  const add = useAddComment()
  const send = () => {
    const text = body.trim()
    if (!hasText(text)) return
    add.mutate({ postId, body: text }, {
      onSuccess: () => setBody(''),
      onError: (e) => notifyError(limitMessage(e, { post: C.errors.postLimit, comment: C.errors.commentLimit }) ?? he.toast.failed),
    })
  }
  return (
    <Group className="bm-composer" gap="xs" wrap="nowrap" align="flex-end">
      <Textarea aria-label={C.comment} placeholder={C.commentPlaceholder} autosize minRows={1} maxRows={5} maxLength={MAX_COMMENT}
        value={body} onChange={(e) => setBody(e.currentTarget.value)} style={{ flex: 1 }} />
      <ActionIcon size={44} aria-label={C.sendComment} onClick={send} loading={add.isPending} disabled={!hasText(body)}>
        <IconSend size={20} stroke={1.75} className="bm-mirror" />
      </ActionIcon>
    </Group>
  )
}

/** The admin's reason dialog for hiding or deleting a comment. */
function CommentModeration({ pending, close }: { pending: Pending; close: () => void }) {
  const moderate = useModerate()
  const hide = pending?.action === 'hide'
  const onConfirm = (reason: string) => {
    if (!pending) return
    moderate.mutate({ kind: 'comment', id: pending.comment.id, action: pending.action, reason },
      { onSuccess: () => { notifySuccess(hide ? M.hidden : M.removed); close() } })
  }
  return (
    <ModerateDialog key={pending?.comment.id ?? 'none'} opened={pending !== null} title={hide ? M.hideComment : M.removeComment}
      confirmLabel={hide ? M.hide : M.remove} loading={moderate.isPending} failed={moderate.isError} onConfirm={onConfirm} onClose={close} />
  )
}

/** The thread (oldest first) and the composer; no composer on a hidden post. */
export function PostComments({ postId, comments, canComment }: { postId: string; comments: PostComment[]; canComment: boolean }) {
  const [pending, setPending] = useState<Pending>(null)
  return (
    <Stack gap="xs">
      <Title order={2} size="h4">{C.comments}</Title>
      <Card padding="md">
        {comments.length === 0 && <Text c="dimmed">{C.noComments}</Text>}
        <Stack gap={0} className="bm-divided">
          {comments.map((c) => <CommentItem key={c.id} c={c} onModerate={setPending} />)}
        </Stack>
      </Card>
      {canComment && <Composer postId={postId} />}
      <CommentModeration pending={pending} close={() => setPending(null)} />
    </Stack>
  )
}
