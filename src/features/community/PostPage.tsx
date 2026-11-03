import { ActionIcon, Alert, Button, Card, Group, Image, Menu, Stack, Text, Title } from '@mantine/core'
import { IconCheck, IconDots, IconEye, IconEyeOff, IconPencil, IconRefresh, IconTrash } from '@tabler/icons-react'
import { useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { BackLink, ListSkeleton, notifyError, notifySuccess, StatusBadge } from '../../ui'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { useDeletePost, useModerate, usePost, useUpdatePost, type PostDetail } from './api'
import { daysLeft, expiresSoon, isExpired, postState } from './board'
import { ModerateDialog } from './ModerateDialog'
import { AuthorLine } from './PostCard'
import { PostComments } from './PostComments'
import { PostForm } from './PostForm'

const C = he.community
const M = C.moderation
const ICON = { size: 18, stroke: 1.75 } as const

type Dialog = 'edit' | 'delete' | 'hide' | 'remove' | null
interface Role { mine: boolean; admin: boolean }

function ActionsMenu({ post, role, setDialog }: { post: PostDetail; role: Role; setDialog: (d: Dialog) => void }) {
  const update = useUpdatePost()
  const moderate = useModerate()
  const onError = () => notifyError(he.toast.failed)
  const renew = () => update.mutate({ id: post.id, patch: { expires_at: new Date().toISOString() } }, { onSuccess: () => notifySuccess(C.renewed), onError })
  const unhide = () => moderate.mutate({ kind: 'post', id: post.id, action: 'unhide' }, { onSuccess: () => notifySuccess(M.unhidden), onError })
  const others = role.admin && !role.mine
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={C.actions}><IconDots size={20} stroke={1.75} aria-hidden="true" /></ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {role.mine && <Menu.Item leftSection={<IconPencil {...ICON} />} onClick={() => setDialog('edit')}>{C.edit}</Menu.Item>}
        {role.mine && <Menu.Item leftSection={<IconRefresh {...ICON} />} onClick={renew}>{C.renew}</Menu.Item>}
        {role.mine && <Menu.Item color="debt" leftSection={<IconTrash {...ICON} />} onClick={() => setDialog('delete')}>{C.delete}</Menu.Item>}
        {role.admin && (post.hidden_at
          ? <Menu.Item leftSection={<IconEye {...ICON} />} onClick={unhide}>{M.unhide}</Menu.Item>
          : <Menu.Item leftSection={<IconEyeOff {...ICON} />} onClick={() => setDialog('hide')}>{M.hide}</Menu.Item>)}
        {others && <Menu.Item color="debt" leftSection={<IconTrash {...ICON} />} onClick={() => setDialog('remove')}>{M.remove}</Menu.Item>}
      </Menu.Dropdown>
    </Menu>
  )
}

/** "סמן כנפתר" / "החזרה לפעיל" for the author. */
function ResolveButton({ post }: { post: PostDetail }) {
  const update = useUpdatePost()
  const resolved = post.status === 'resolved'
  const toggle = () => update.mutate({ id: post.id, patch: { status: resolved ? 'active' : 'resolved' } }, {
    onSuccess: () => notifySuccess(resolved ? C.reopenedToast : C.resolvedToast), onError: () => notifyError(he.toast.failed),
  })
  return (
    <Button variant={resolved ? 'default' : 'light'} color={resolved ? undefined : 'paid'} loading={update.isPending} onClick={toggle}
      leftSection={resolved ? undefined : <IconCheck size={18} stroke={1.75} aria-hidden="true" />}>
      {resolved ? C.reopen : C.resolve}
    </Button>
  )
}

/** Hidden reason (author and admins), expired / expiring notices (author). */
function Notices({ post, mine }: { post: PostDetail; mine: boolean }) {
  return (
    <>
      {post.hidden_reason && <Alert color="debt">{C.hiddenReason(post.hidden_reason)}</Alert>}
      {mine && isExpired(post.expires_at) && <Alert color="signal">{C.expiredHint}</Alert>}
      {mine && expiresSoon(post.expires_at) && <Text size="sm" c="dimmed">{C.expiresIn(daysLeft(post.expires_at))}</Text>}
    </>
  )
}

function Summary({ post, mine, menu }: { post: PostDetail; mine: boolean; menu: ReactNode }) {
  const state = postState(post)
  return (
    <Card padding="md">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text size="sm" c="dimmed">{C.categories[post.category]}</Text>
            <Title order={1} fz={{ base: 'h3', sm: 'h2' }} style={{ overflowWrap: 'anywhere' }}>{post.title}</Title>
          </Stack>
          <Group gap={0} wrap="nowrap" style={{ flexShrink: 0 }}>
            {state !== 'active' && <StatusBadge kind="community" value={state} />}
            {menu}
          </Group>
        </Group>
        <AuthorLine author={post.author} at={post.created_at} />
        <Notices post={post} mine={mine} />
        {post.body && <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{post.body}</Text>}
        {post.photoUrl && <Image src={post.photoUrl} alt={C.photoAlt(post.title)} radius={10} fit="contain" mah={360} bg="stone.1" />}
        {mine && <Group><ResolveButton post={post} /></Group>}
      </Stack>
    </Card>
  )
}

function Dialogs({ post, dialog, close }: { post: PostDetail; dialog: Dialog; close: () => void }) {
  const navigate = useNavigate()
  const del = useDeletePost()
  const moderate = useModerate()
  const leave = (msg: string) => { notifySuccess(msg); void navigate('/community', { replace: true }) }
  const hide = dialog === 'hide'
  const onModerated = () => {
    if (!hide) return leave(M.removed)
    notifySuccess(M.hidden)
    close()
  }
  const onModerate = (reason: string) => moderate.mutate(
    { kind: 'post', id: post.id, action: hide ? 'hide' : 'delete', reason, photoPath: post.photo_path }, { onSuccess: onModerated },
  )
  return (
    <>
      <FormModal opened={dialog === 'edit'} title={C.edit} onClose={close}>
        {dialog === 'edit' && <PostForm post={post} onDone={close} />}
      </FormModal>
      <ConfirmDialog opened={dialog === 'delete'} title={C.deleteConfirm(post.title)} body={C.deleteBody} confirmLabel={C.delete}
        loading={del.isPending} failed={del.isError} onClose={close} onConfirm={() => del.mutate(post, { onSuccess: () => leave(C.deleted) })} />
      <ModerateDialog key={dialog ?? 'none'} opened={hide || dialog === 'remove'} title={hide ? M.hidePost : M.removePost}
        confirmLabel={hide ? M.hide : M.remove} loading={moderate.isPending} failed={moderate.isError} onConfirm={onModerate} onClose={close} />
    </>
  )
}

/** One post: details, the author's and admins' actions, and the comment thread. */
export default function PostPage() {
  const { id = '' } = useParams()
  const { isAdmin, session } = useAuth()
  const query = usePost(id)
  const [dialog, setDialog] = useState<Dialog>(null)
  const post = query.data
  if (query.isLoading) return <ListSkeleton />
  if (!post) return <Stack align="flex-start"><BackLink to="/community" label={C.back} /><Text>{query.isError ? C.errors.load : C.notFound}</Text></Stack>
  const role: Role = { mine: !!post.author_id && post.author_id === session?.user.id, admin: isAdmin }
  const menu = role.mine || role.admin ? <ActionsMenu post={post} role={role} setDialog={setDialog} /> : null
  return (
    <Stack gap="md">
      <BackLink to="/community" label={C.back} />
      <Summary post={post} mine={role.mine} menu={menu} />
      <PostComments postId={post.id} comments={post.comments} canComment={post.hidden_at === null} />
      <Dialogs post={post} dialog={dialog} close={() => setDialog(null)} />
    </Stack>
  )
}
