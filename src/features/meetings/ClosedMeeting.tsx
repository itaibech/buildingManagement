import { Alert, Button, Group, Stack, Text } from '@mantine/core'
import { IconEdit, IconFilePlus, IconPrinter, IconSpeakerphone } from '@tabler/icons-react'
import { useState } from 'react'
import { he } from '../../lib/he'
import { AddendumDialog, PublishDialog, ReopenDialog } from './CloseoutDialogs'
import { EventLog } from './EventLog'
import { meetingDate } from './fmt'
import { isSigned, needsPublishReminder, reopenBlock } from './lifecycle'
import { MeetingDocuments } from './MeetingDocuments'
import { MeetingEmailDialog } from './MeetingEmailDialog'
import { printProtocol } from './print'
import { ProtocolView } from './ProtocolView'
import { SignPanel } from './SignPanel'
import type { MeetingDetail } from './types'

type Dialog = 'publish' | 'addendum' | 'email' | 'reopen' | null
const A = he.meetings.actions
const ICON = { size: 18, stroke: 1.75 } as const

/** Admin, closed: "עריכת הפרוטוקול" (reopen for correction), enabled only while unsigned and without addenda. */
function ReopenButton({ block, onOpen }: { block: ReturnType<typeof reopenBlock>; onOpen: () => void }) {
  return (
    <Button variant="default" leftSection={<IconEdit {...ICON} />} onClick={onOpen} disabled={block !== null}
      aria-describedby={block ? 'bm-reopen-block' : undefined}>{A.editProtocol}</Button>
  )
}

/** Closed (admin): sign, publish, edit or add corrections, print; published: the archived protocol, read-only, with print. */
export function ClosedMeeting({ meeting, isAdmin }: { meeting: MeetingDetail; isAdmin: boolean }) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const closed = meeting.status === 'closed'
  const close = () => setDialog(null)
  const block = reopenBlock(meeting)
  return (
    <Stack gap="md">
      {closed && needsPublishReminder(meeting) && <Alert color="signal">{he.meetings.publishReminder(meeting.title, 3)}</Alert>}
      <Group gap="sm" wrap="wrap">
        {closed && isAdmin && (
          <Button leftSection={<IconSpeakerphone {...ICON} />} onClick={() => setDialog('publish')} disabled={!isSigned(meeting)}>{A.publish}</Button>
        )}
        <Button variant={closed ? 'default' : 'filled'} leftSection={<IconPrinter {...ICON} />} onClick={() => printProtocol(meeting)}>{A.print}</Button>
        {closed && isAdmin && <ReopenButton block={block} onOpen={() => setDialog('reopen')} />}
        {isAdmin && <Button variant="default" leftSection={<IconFilePlus {...ICON} />} onClick={() => setDialog('addendum')}>{A.addendum}</Button>}
      </Group>
      {closed && isAdmin && block && <Text id="bm-reopen-block" size="sm" c="dimmed">{he.meetings.reopen[block]}</Text>}
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
          <ReopenDialog meetingId={meeting.id} opened={dialog === 'reopen'} onClose={close} />
          <MeetingEmailDialog opened={dialog === 'email'} onClose={close} meetingId={meeting.id} variant="published" title={meeting.title} />
        </>
      )}
    </Stack>
  )
}
