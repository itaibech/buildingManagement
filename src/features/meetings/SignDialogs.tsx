import { Alert, Button, FileInput, Group, Stack, Text, TextInput } from '@mantine/core'
import { useState } from 'react'
import { he } from '../../lib/he'
import { notifySuccess } from '../../ui'
import { FormModal } from '../tenants/dialogs'
import { fileProblem, meetingRpc, uploadMeetingFile, useMeetingCall } from './api'
import { SignaturePad } from './SignaturePad'
import type { MeetingDetail, SignatureRole } from './types'

const S = he.meetings.sign

interface DrawProps { meeting: MeetingDetail; role: SignatureRole | null; onClose: () => void }

/** A drawn signature for a role: the signer's full name and the pad; stored as a PNG, then recorded by sign_meeting. */
export function DrawSignatureDialog({ meeting, role, onClose }: DrawProps) {
  const call = useMeetingCall()
  const initial = role === 'chair' ? meeting.chair_name : role === 'secretary' ? meeting.secretary_name : ''
  const [name, setName] = useState(initial)
  const save = (png: Blob) => role && name.trim() && call.mutate(async () => {
    const path = await uploadMeetingFile(meeting.id, png)
    await meetingRpc.sign(meeting.id, role, name.trim(), path, 'drawn')
  }, { onSuccess: () => { notifySuccess(S.signed); onClose() } })
  return (
    <FormModal opened={role !== null} title={role ? `${S.draw}: ${S.roles[role]}` : S.draw} onClose={onClose}>
      {role && (
        <Stack key={role}>
          <TextInput label={S.signerName} withAsterisk value={name} onChange={(e) => setName(e.currentTarget.value)}
            error={!name.trim() ? he.meetings.errors.name : undefined} />
          <SignaturePad onSave={save} saving={call.isPending} />
        </Stack>
      )}
    </FormModal>
  )
}

/** A scanned protocol signed on paper: one file stands for both the chair's and the recorder's signatures. */
export function ScanDialog({ meeting, opened, onClose }: { meeting: MeetingDetail; opened: boolean; onClose: () => void }) {
  const call = useMeetingCall()
  const [file, setFile] = useState<File | null>(null)
  const problem = file ? fileProblem(file) : null
  const save = () => file && !problem && call.mutate(async () => {
    const path = await uploadMeetingFile(meeting.id, file)
    await meetingRpc.sign(meeting.id, 'chair', meeting.chair_name, path, 'scan')
    await meetingRpc.sign(meeting.id, 'secretary', meeting.secretary_name, path, 'scan')
  }, { onSuccess: () => { notifySuccess(S.scanned); onClose() } })
  return (
    <FormModal opened={opened} title={S.scan} onClose={onClose} compact>
      <Stack>
        <Text size="sm">{S.scanHint}</Text>
        <FileInput label={S.scanFile} accept="image/*,application/pdf" value={file} onChange={setFile} clearable />
        {problem && <Alert color="debt">{problem === 'size' ? S.fileTooBig : S.fileType}</Alert>}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>{S.cancel}</Button>
          <Button onClick={save} loading={call.isPending} disabled={!file || !!problem}>{S.scanSave}</Button>
        </Group>
      </Stack>
    </FormModal>
  )
}
