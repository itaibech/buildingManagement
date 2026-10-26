import { Alert, Button, Group, Stack, Text } from '@mantine/core'
import { IconFilePlus, IconPrinter, IconSpeakerphone } from '@tabler/icons-react'
import { useState } from 'react'
import { he } from '../../lib/he'
import { AddendumDialog, PublishDialog } from './CloseoutDialogs'
import { EventLog } from './EventLog'
import { meetingDate } from './fmt'
import { isSigned, needsPublishReminder } from './lifecycle'
import { MeetingDocuments } from './MeetingDocuments'
import { MeetingEmailDialog } from './MeetingEmailDialog'
import { printProtocol } from './print'
import { ProtocolView } from './ProtocolView'
import { SignPanel } from './SignPanel'
import type { MeetingDetail } from './types'

type Dialog = 'publish' | 'addendum' | 'email' | null
const A = he.meetings.actions
const ICON = { size: 18, stroke: 1.75 } as const

/** Closed (admin): sign, publish, add corrections, print; published: the archived protocol, read-only, with print. */
export function ClosedMeeting({ meeting, isAdmin }: { meeting: MeetingDetail; isAdmin: boolean }) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const closed = meeting.status === 'closed'
  const close = () => setDialog(null)
  return (
    <Stack gap="md">
      {closed && needsPublishReminder(meeting) && <Alert color="signal">{he.meetings.publishReminder(meeting.title, 3)}</Alert>}
      <Group gap="sm" wrap="wrap">
        {closed && isAdmin && (
          <Button leftSection={<IconSpeakerphone {...ICON} />} onClick={() => setDialog('publish')} disabled={!isSigned(meeting)}>{A.publish}</Button>
        )}
        <Button variant={closed ? 'default' : 'filled'} leftSection={<IconPrinter {...ICON} />} onClick={() => printProtocol(meeting)}>{A.print}</Button>
        {isAdmin && <Button variant="default" leftSection={<IconFilePlus {...ICON} />} onClick={() => setDialog('addendum')}>{A.addendum}</Button>}
      </Group>
      {closed && isAdmin && !isSigned(meeting) && <Text size="sm" c="dimmed">{he.meetings.publish.needsSignatures}</Text>}
      {meeting.published_at && <Text size="sm" c="dimmed" className="bm-num">{he.meetings.publish.publishedAt(meetingDate(meeting.published_at))}</Text>}
      {closed && isAdmin && <SignPanel meeting={meeting} />}
      <ProtocolView meeting={meeting} />
      <MeetingDocuments meetingId={meeting.id} status={meeting.status} isAdmin={isAdmin} />
      {isAdmin && <EventLog meetingId={meeting.id} />}
      {isAdmin && (
        <>
          <PublishDialog meeting={meeting} opened={dialog === 'publish'} onClose={close} onPublished={(email) => setDialog(email ? 'email' : null)} />
          <AddendumDialog meetingId={meeting.id} opened={dialog === 'addendum'} onClose={close} />
          <MeetingEmailDialog opened={dialog === 'email'} onClose={close} meetingId={meeting.id} variant="published" title={meeting.title} />
        </>
      )}
    </Stack>
  )
}
