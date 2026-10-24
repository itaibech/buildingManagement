import { Alert, Button, Checkbox, Group, Stack, Text, Textarea } from '@mantine/core'
import { useState } from 'react'
import { he } from '../../lib/he'
import { notifySuccess } from '../../ui'
import { FormModal } from '../tenants/dialogs'
import { meetingRpc, useMeetingCall } from './api'
import { isSigned } from './lifecycle'
import type { MeetingDetail } from './types'

const P = he.meetings.publish
const AD = he.meetings.addendum

/** "פרסום הפרוטוקול": needs both signatures; optionally emails everyone afterwards. */
export function PublishDialog({ meeting, opened, onClose, onPublished }: { meeting: MeetingDetail; opened: boolean; onClose: () => void; onPublished: (email: boolean) => void }) {
  const call = useMeetingCall()
  const [email, setEmail] = useState(false)
  const signed = isSigned(meeting)
  const publish = () => call.mutate(() => meetingRpc.publish(meeting.id), { onSuccess: () => { notifySuccess(P.published); onPublished(email) } })
  return (
    <FormModal opened={opened} title={P.title} onClose={onClose} compact>
      <Stack>
        <Text>{P.body}</Text>
        {!signed && <Alert color="signal">{P.needsSignatures}</Alert>}
        <Checkbox size="md" label={P.email} checked={email} onChange={(e) => setEmail(e.currentTarget.checked)} />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>{he.meetings.invite.cancel}</Button>
          <Button onClick={publish} loading={call.isPending} disabled={!signed}>{P.confirm}</Button>
        </Group>
      </Stack>
    </FormModal>
  )
}

/** "תיקון לפרוטוקול": a correction with its own text and time, printed as an appendix. */
export function AddendumDialog({ meetingId, opened, onClose }: { meetingId: string; opened: boolean; onClose: () => void }) {
  const call = useMeetingCall()
  const [body, setBody] = useState('')
  const [tried, setTried] = useState(false)
  const save = () => {
    setTried(true)
    if (body.trim()) call.mutate(() => meetingRpc.addendum(meetingId, body.trim()), { onSuccess: () => { notifySuccess(AD.saved); setBody(''); onClose() } })
  }
  return (
    <FormModal opened={opened} title={AD.title} onClose={onClose}>
      <Stack>
        <Text size="sm" c="dimmed">{AD.body}</Text>
        <Textarea label={AD.text} withAsterisk autosize minRows={4} maxRows={12} maxLength={5000} value={body}
          onChange={(e) => setBody(e.currentTarget.value)} error={tried && !body.trim() ? AD.required : undefined} />
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>{AD.cancel}</Button>
          <Button onClick={save} loading={call.isPending}>{AD.save}</Button>
        </Group>
      </Stack>
    </FormModal>
  )
}
