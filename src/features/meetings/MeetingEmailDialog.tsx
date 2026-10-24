import { Stack, Text } from '@mantine/core'
import { he } from '../../lib/he'
import { sendableCount, useEmailPreview, useSplitSend, type EmailRequest, type MeetingEmailVariant } from '../email/api'
import { PreviewInfo, SendActions } from '../email/parts'
import { FormModal } from '../tenants/dialogs'

interface Props { opened: boolean; onClose: () => void; meetingId: string; variant: MeetingEmailVariant; title: string }

function Body({ meetingId, variant, title, onClose }: Omit<Props, 'opened'>) {
  const req: EmailRequest = { kind: 'meeting', id: meetingId, variant, apartmentIds: 'all' }
  const preview = useEmailPreview(req)
  const send = useSplitSend()
  return (
    <Stack>
      <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{`${he.meetings.email.variants[variant]}: ${title}`}</Text>
      <PreviewInfo q={preview} />
      <SendActions count={sendableCount(preview.data)} loading={send.isPending} progress={send.progress}
        onSend={() => send.start(req, preview.data, onClose)} onCancel={onClose} />
    </Stack>
  )
}

/** Admin: email the invitation, its update or the published protocol to every apartment (Task 23 function, kind 'meeting'). */
export function MeetingEmailDialog({ opened, ...props }: Props) {
  return (
    <FormModal opened={opened} title={he.meetings.email.title} onClose={props.onClose} compact>
      {opened && <Body {...props} />}
    </FormModal>
  )
}
