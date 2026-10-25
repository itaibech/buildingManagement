import { Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, notifySuccess, PageHeader } from '../../ui'
import { SendEmailDialog } from '../email/SendEmailDialog'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { AnnouncementForm } from './AnnouncementForm'
import { AnnouncementItem, type AdminActions } from './AnnouncementItem'
import { useAnnouncements, useDeleteAnnouncement, useExpiredAnnouncements, useMarkRead, type Announcement } from './api'

type Dialog = { kind: 'add' } | { kind: 'edit' | 'delete' | 'email'; item: Announcement } | null

function ExpiredSection({ actions }: { actions?: AdminActions }) {
  const { data } = useExpiredAnnouncements()
  if (!data?.length) return null
  return (
    <Stack gap="sm">
      <Title order={2} size="h4">{he.announcements.expiredSection}</Title>
      {data.map((a) => <AnnouncementItem key={a.id} item={a} expired actions={actions} />)}
    </Stack>
  )
}

function Dialogs({ dialog, close }: { dialog: Dialog; close: () => void }) {
  const del = useDeleteAnnouncement()
  const item = dialog && dialog.kind !== 'add' ? dialog.item : undefined
  const onDelete = () => item && del.mutate(item.id, { onSuccess: () => { notifySuccess(he.announcements.deleted); close() } })
  return (
    <>
      <FormModal opened={dialog?.kind === 'add' || dialog?.kind === 'edit'} title={dialog?.kind === 'edit' ? he.announcements.edit : he.announcements.add} onClose={close}>
        {dialog?.kind === 'add' && <AnnouncementForm onDone={close} />}
        {dialog?.kind === 'edit' && <AnnouncementForm key={dialog.item.id} announcement={dialog.item} onDone={close} />}
      </FormModal>
      <ConfirmDialog opened={dialog?.kind === 'delete'} title={he.announcements.deleteConfirm(item?.title ?? '')} body={he.announcements.deleteBody}
        confirmLabel={he.announcements.delete} loading={del.isPending} failed={del.isError} onClose={close} onConfirm={onDelete} />
      <SendEmailDialog opened={dialog?.kind === 'email'} onClose={close} kind="announcement" refId={item?.id ?? ''} subject={item?.title ?? ''} />
    </>
  )
}

/** Building notices: pinned first, then newest. Admins publish, edit and delete. */
export default function AnnouncementsPage() {
  const { isAdmin } = useAuth()
  const list = useAnnouncements()
  const markRead = useMarkRead()
  const [dialog, setDialog] = useState<Dialog>(null)
  // ?open=<id> (the home "הודעה אחרונה" row) opens that item expanded, marks it read and scrolls to it.
  const [params] = useSearchParams()
  const openId = params.get('open')
  const add = isAdmin ? { label: he.announcements.add, onClick: () => setDialog({ kind: 'add' }) } : undefined
  const actions: AdminActions | undefined = isAdmin
    ? {
      onEdit: (item) => setDialog({ kind: 'edit', item }), onDelete: (item) => setDialog({ kind: 'delete', item }),
      onEmail: (item) => setDialog({ kind: 'email', item }),
    }
    : undefined
  return (
    <Stack gap="md">
      <PageHeader title={he.nav.announcements} action={add} />
      {list.isError && <Text c="debt.7">{he.announcements.errors.load}</Text>}
      {list.isLoading && <ListSkeleton rows={4} />}
      {list.data?.length === 0 && <EmptyState title={he.announcements.empty} body={he.announcements.emptyBody} action={add} />}
      {list.data?.map((a) => <AnnouncementItem key={a.id} item={a} actions={actions} focused={a.id === openId} onOpen={(i) => markRead.mutate(i.id)} />)}
      {isAdmin && <ExpiredSection actions={actions} />}
      <Dialogs dialog={dialog} close={() => setDialog(null)} />
    </Stack>
  )
}
