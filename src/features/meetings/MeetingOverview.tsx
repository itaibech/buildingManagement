import { Button, Group, Stack } from '@mantine/core'
import { IconPencil, IconPlayerPlay, IconSend, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { he } from '../../lib/he'
import { notifySuccess } from '../../ui'
import { useApartments } from '../tenants/api'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { meetingRpc, useMeetingCall } from './api'
import { EventLog } from './EventLog'
import { InviteDialog } from './InviteDialog'
import { actionsFor, type MeetingAction } from './lifecycle'
import { MeetingDetails } from './MeetingDetails'
import { MeetingEmailDialog } from './MeetingEmailDialog'
import { MeetingForm } from './MeetingForm'
import type { MeetingDetail } from './types'

type Dialog = 'edit' | 'invite' | 'updateInvite' | 'delete' | 'emailInvite' | 'emailUpdate' | null
const A = he.meetings.actions
const ICON = { size: 18, stroke: 1.75 } as const
const ICONS: Partial<Record<MeetingAction, typeof IconPencil>> = { edit: IconPencil, invite: IconSend, updateInvite: IconSend, run: IconPlayerPlay, delete: IconTrash }

function Actions({ meeting, onAction }: { meeting: MeetingDetail; onAction: (a: MeetingAction) => void }) {
  return (
    <Group gap="sm" wrap="wrap">
      {actionsFor(meeting.status).map((a, i) => {
        const Icon = ICONS[a] ?? IconPencil
        return (
          <Button key={a} variant={i === 0 ? 'filled' : a === 'delete' ? 'subtle' : 'default'} color={a === 'delete' ? 'debt' : undefined}
            leftSection={<Icon {...ICON} />} onClick={() => onAction(a)}>{A[a]}</Button>
        )
      })}
    </Group>
  )
}

function Dialogs({ meeting, dialog, setDialog }: { meeting: MeetingDetail; dialog: Dialog; setDialog: (d: Dialog) => void }) {
  const call = useMeetingCall()
  const navigate = useNavigate()
  const close = () => setDialog(null)
  const remove = () => call.mutate(() => meetingRpc.remove(meeting.id), { onSuccess: () => { notifySuccess(he.meetings.deleted); navigate('/meetings') } })
  const invite = dialog === 'invite' || dialog === 'updateInvite'
  return (
    <>
      <FormModal opened={dialog === 'edit'} title={he.meetings.form.editTitle} onClose={close}>
        {dialog === 'edit' && <MeetingForm meeting={meeting} onDone={close} />}
      </FormModal>
      <InviteDialog opened={invite} meeting={meeting} mode={dialog === 'updateInvite' ? 'update' : 'invite'} onClose={close}
        onSent={(email) => setDialog(email ? (dialog === 'invite' ? 'emailInvite' : 'emailUpdate') : null)} />
      <MeetingEmailDialog opened={dialog === 'emailInvite' || dialog === 'emailUpdate'} onClose={close} meetingId={meeting.id}
        title={meeting.title} variant={dialog === 'emailUpdate' ? 'update' : 'invite'} />
      <ConfirmDialog opened={dialog === 'delete'} title={he.meetings.deleteTitle} body={he.meetings.deleteBody} confirmLabel={A.delete}
        loading={call.isPending} failed={call.isError} onConfirm={remove} onClose={close} />
    </>
  )
}

/** Draft / invited: the invitation's details, the actions of the state and (admins) the history. */
export function MeetingOverview({ meeting, isAdmin, onRun }: { meeting: MeetingDetail; isAdmin: boolean; onRun: () => void }) {
  const apartments = useApartments()
  const [dialog, setDialog] = useState<Dialog>(null)
  const onAction = (a: MeetingAction) => (a === 'run' ? onRun() : setDialog(a === 'edit' || a === 'invite' || a === 'updateInvite' || a === 'delete' ? a : null))
  return (
    <Stack gap="md">
      {isAdmin && <Actions meeting={meeting} onAction={onAction} />}
      <MeetingDetails meeting={meeting} total={apartments.data?.length ?? null} />
      {isAdmin && <EventLog meetingId={meeting.id} />}
      {isAdmin && <Dialogs meeting={meeting} dialog={dialog} setDialog={setDialog} />}
    </Stack>
  )
}
