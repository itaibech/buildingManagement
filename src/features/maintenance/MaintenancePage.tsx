import { Stack, Text, Title } from '@mantine/core'
import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, notifySuccess, PageHeader } from '../../ui'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { todayISO } from '../../lib/dates'
import { tasksRows } from '../export/buildWorkbook'
import { useExportAction } from '../export/useExport'
import { fetchLastDone, useDeleteTask, useTasks, type Task } from './api'
import { DoneForm } from './DoneForm'
import { dueBucket, type DueBucket } from './nextDue'
import { TaskDetail } from './TaskDetail'
import { TaskForm } from './TaskForm'
import { TaskRow, type TaskActions } from './TaskRow'

type Dialog = { kind: 'add' } | { kind: 'edit' | 'delete' | 'done' | 'detail'; task: Task } | null

const ORDER: DueBucket[] = ['overdue', 'soon', 'later', 'none']

function Dialogs({ dialog, close }: { dialog: Dialog; close: () => void }) {
  const del = useDeleteTask()
  const task = dialog && dialog.kind !== 'add' ? dialog.task : undefined
  const onDelete = () => task && del.mutate(task.id, { onSuccess: () => { notifySuccess(he.maintenance.deleted); close() } })
  const kind = dialog?.kind
  const title = kind === 'add' ? he.maintenance.add : kind === 'edit' ? he.maintenance.edit : kind === 'done' ? he.maintenance.markDoneTitle(task?.title ?? '') : (task?.title ?? '')
  return (
    <>
      <FormModal opened={!!dialog && kind !== 'delete'} title={title} onClose={close}>
        {kind === 'add' && <TaskForm onDone={close} />}
        {dialog?.kind === 'edit' && <TaskForm key={dialog.task.id} task={dialog.task} onDone={close} />}
        {dialog?.kind === 'done' && <DoneForm key={dialog.task.id} task={dialog.task} onDone={close} />}
        {dialog?.kind === 'detail' && <TaskDetail taskId={dialog.task.id} />}
      </FormModal>
      <ConfirmDialog opened={kind === 'delete'} title={he.maintenance.deleteConfirm(task?.title ?? '')} body={he.maintenance.deleteBody}
        confirmLabel={he.maintenance.delete} loading={del.isPending} failed={del.isError} onClose={close} onConfirm={onDelete} />
    </>
  )
}

function Groups({ tasks, onOpen, actions }: { tasks: Task[]; onOpen: (t: Task) => void; actions?: TaskActions }) {
  const groups = useMemo(() => {
    const today = todayISO()
    return ORDER.map((bucket) => ({ bucket, items: tasks.filter((t) => dueBucket(t.next_due, today) === bucket) })).filter((g) => g.items.length)
  }, [tasks])
  return (
    <>
      {groups.map(({ bucket, items }) => (
        <Stack key={bucket} gap="sm" component="section" aria-label={he.dueStatus[bucket]}>
          <Title order={2} size="h4">{he.dueStatus[bucket]}</Title>
          {items.map((t) => <TaskRow key={t.id} task={t} bucket={bucket} onOpen={onOpen} actions={actions} />)}
        </Stack>
      ))}
    </>
  )
}

/** Recurring building maintenance grouped by urgency. Admins add, edit, delete and mark tasks done. */
export default function MaintenancePage() {
  const { isAdmin } = useAuth()
  const list = useTasks()
  const [dialog, setDialog] = useState<Dialog>(null)
  const add = isAdmin ? { label: he.maintenance.add, onClick: () => setDialog({ kind: 'add' }) } : undefined
  const actions: TaskActions | undefined = isAdmin
    ? { onDone: (task) => setDialog({ kind: 'done', task }), onEdit: (task) => setDialog({ kind: 'edit', task }), onDelete: (task) => setDialog({ kind: 'delete', task }) }
    : undefined
  const exportAction = useExportAction(he.export.files.maintenance, async () => tasksRows(list.data ?? [], await fetchLastDone()), !!list.data)
  return (
    <Stack gap="lg">
      <PageHeader title={he.nav.maintenance} action={add} secondaryAction={exportAction} />
      {list.isError && <Text c="debt.7">{he.maintenance.errors.load}</Text>}
      {list.isLoading && <ListSkeleton rows={4} />}
      {list.data?.length === 0 && <EmptyState title={he.maintenance.empty} body={he.maintenance.emptyBody} action={add} />}
      {list.data && <Groups tasks={list.data} onOpen={(task) => setDialog({ kind: 'detail', task })} actions={actions} />}
      <Dialogs dialog={dialog} close={() => setDialog(null)} />
    </Stack>
  )
}
