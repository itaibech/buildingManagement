import { Alert, Button, Checkbox, Group, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { he } from '../../lib/he'
import { notifySuccess } from '../../ui'
import { FormModal } from '../tenants/dialogs'
import { meetingRpc, useMeetingCall } from './api'
import { daysUntil } from './fmt'
import { isShortNotice } from './lifecycle'
import type { Meeting } from './types'

const I = he.meetings.invite

export interface InviteDialogProps {
  opened: boolean
  meeting: Meeting
  mode: 'invite' | 'update'
  onClose: () => void
  /** After a successful send; `email` = the admin asked to email everyone too, `details` = with each topic's details. */
  onSent: (email: boolean, details: boolean) => void
}

function ShortNotice({ meeting, confirmed, onConfirm }: { meeting: Meeting; confirmed: boolean; onConfirm: (v: boolean) => void }) {
  return (
    <Alert color="signal" title={I.shortNotice}>
      <Stack gap="xs">
        <Text size="sm">{I.shortNoticeBody(he.meetings.days(daysUntil(meeting.scheduled_at)))}</Text>
        <Checkbox label={I.shortNoticeConfirm} checked={confirmed} onChange={(e) => onConfirm(e.currentTarget.checked)} size="md" />
      </Stack>
    </Alert>
  )
}

function Body({ meeting, mode, onClose, onSent }: Omit<InviteDialogProps, 'opened'>) {
  const call = useMeetingCall()
  const short = mode === 'invite' && isShortNotice(meeting.scheduled_at)
  const [confirmed, setConfirmed] = useState(false)
  const [email, setEmail] = useState(false)
  const [details, setDetails] = useState(false)
  const send = () => call.mutate(() => (mode === 'invite' ? meetingRpc.invite(meeting.id, confirmed, details) : meetingRpc.updateInvite(meeting.id, details)), {
    onSuccess: () => { notifySuccess(mode === 'invite' ? I.sent : I.updated); onSent(email, details) },
  })
  return (
    <Stack>
      <Text>{mode === 'invite' ? I.body : I.updateBody}</Text>
      {short && <ShortNotice meeting={meeting} confirmed={confirmed} onConfirm={setConfirmed} />}
      <Checkbox label={I.details} description={I.detailsHint} checked={details} onChange={(e) => setDetails(e.currentTarget.checked)} size="md" />
      <Checkbox label={I.email} checked={email} onChange={(e) => setEmail(e.currentTarget.checked)} size="md" />
      <Group justify="flex-end" gap="sm">
        <Button variant="default" onClick={onClose}>{I.cancel}</Button>
        <Button onClick={send} loading={call.isPending} disabled={short && !confirmed}>{mode === 'invite' ? I.send : I.sendUpdate}</Button>
      </Group>
    </Stack>
  )
}

/** "שליחת זימון" / "עדכון זימון": announces the meeting to everyone; under 5 days ahead asks for an explicit confirmation. */
export function InviteDialog({ opened, ...props }: InviteDialogProps) {
  return (
    <FormModal opened={opened} title={props.mode === 'invite' ? I.title : I.updateTitle} onClose={props.onClose} compact>
      {opened && <Body {...props} />}
    </FormModal>
  )
}
