import { Button, Card, Group, Image, Stack, Text, Title } from '@mantine/core'
import { IconSignature, IconUpload } from '@tabler/icons-react'
import { useState } from 'react'
import { he } from '../../lib/he'
import { useMeetingFileUrls } from './api'
import { meetingDate } from './fmt'
import { DrawSignatureDialog, ScanDialog } from './SignDialogs'
import type { MeetingDetail, Signature, SignatureRole } from './types'

const S = he.meetings.sign

function RoleSignature({ label, s, url, onSign }: { label: string; s: Signature | undefined; url: string | undefined; onSign: () => void }) {
  return (
    <Card padding="sm">
      <Stack gap={6}>
        <Text fw={600}>{label}</Text>
        {s ? <Text size="sm" className="bm-num">{S.signedBy(s.signer_name, meetingDate(s.signed_at))}</Text> : <Text size="sm" c="signal.9">{S.missing}</Text>}
        {s?.method === 'drawn' && url && <Image src={url} alt={`${label}: ${s.signer_name}`} h={80} w="auto" fit="contain" />}
        {s?.method === 'scan' && <Text size="sm" c="dimmed">{S.scannedLabel}</Text>}
        <Button variant={s ? 'subtle' : 'light'} leftSection={<IconSignature size={18} stroke={1.75} />} onClick={onSign} style={{ alignSelf: 'flex-start' }}>
          {s ? S.replace : S.draw}
        </Button>
      </Stack>
    </Card>
  )
}

/** Closed meeting: the chair's and the recorder's signatures (drawn or a scan), plus optional attendee signatures. */
export function SignPanel({ meeting }: { meeting: MeetingDetail }) {
  const [role, setRole] = useState<SignatureRole | null>(null)
  const [scan, setScan] = useState(false)
  const urls = useMeetingFileUrls(meeting.signatures.map((s) => s.image_path)).data ?? {}
  const of = (r: SignatureRole) => meeting.signatures.find((s) => s.role === r)
  const attendees = meeting.signatures.filter((s) => s.role === 'attendee')
  return (
    <Card>
      <Stack gap="sm">
        <Title order={2} size="h4">{S.title}</Title>
        <Text size="sm" c="dimmed">{S.hint}</Text>
        {(['chair', 'secretary'] as const).map((r) => {
          const s = of(r)
          return <RoleSignature key={r} label={S.roles[r]} s={s} url={s ? urls[s.image_path] : undefined} onSign={() => setRole(r)} />
        })}
        {attendees.map((s) => <Text key={s.id} size="sm" className="bm-num">{`${S.roles.attendee}: ${S.signedBy(s.signer_name, meetingDate(s.signed_at))}`}</Text>)}
        <Group gap="sm" wrap="wrap">
          <Button variant="default" leftSection={<IconSignature size={18} stroke={1.75} />} onClick={() => setRole('attendee')}>{S.addAttendee}</Button>
          <Button variant="default" leftSection={<IconUpload size={18} stroke={1.75} />} onClick={() => setScan(true)}>{S.scan}</Button>
        </Group>
      </Stack>
      <DrawSignatureDialog meeting={meeting} role={role} onClose={() => setRole(null)} />
      <ScanDialog meeting={meeting} opened={scan} onClose={() => setScan(false)} />
    </Card>
  )
}
