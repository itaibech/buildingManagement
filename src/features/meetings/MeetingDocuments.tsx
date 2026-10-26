import { ActionIcon, Anchor, Button, Card, FileButton, Group, Stack, Text, Title } from '@mantine/core'
import { IconFileText, IconPaperclip, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { he } from '../../lib/he'
import { notifyError, notifySuccess } from '../../ui'
import { ConfirmDialog } from '../tenants/dialogs'
import { addMeetingDocument, documentProblem, removeMeetingDocument, useDocumentCall, useMeetingDocuments, type MeetingDocument } from './api'
import type { MeetingStatus } from './types'

const T = he.meetings.documents
const ICON = { size: 18, stroke: 1.75 } as const
const ACCEPT = 'application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp,image/heic,image/heif'

/** Same rules as the bucket: add until published, remove until closed. */
const canAdd = (s: MeetingStatus): boolean => s !== 'published'
const canRemove = (s: MeetingStatus): boolean => s === 'draft' || s === 'invited' || s === 'in_progress'

const fileSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? T.sizeMb((bytes / (1024 * 1024)).toFixed(1)) : T.sizeKb(Math.max(1, Math.ceil(bytes / 1024)))

function DocumentRow({ doc, onRemove }: { doc: MeetingDocument; onRemove: (() => void) | null }) {
  return (
    <Group gap="xs" wrap="nowrap" mih={44}>
      <IconFileText {...ICON} aria-hidden="true" style={{ flexShrink: 0 }} />
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        {doc.url
          ? <Anchor href={doc.url} target="_blank" rel="noopener noreferrer" aria-label={T.download(doc.file_name)} style={{ overflowWrap: 'anywhere' }}>{doc.file_name}</Anchor>
          : <Text style={{ overflowWrap: 'anywhere' }}>{doc.file_name}</Text>}
        <Text size="xs" c="dimmed" className="bm-num" dir="ltr" style={{ alignSelf: 'flex-start' }}>{fileSize(doc.size_bytes)}</Text>
      </Stack>
      {onRemove && (
        <ActionIcon variant="subtle" color="debt" size={44} aria-label={T.remove(doc.file_name)} onClick={onRemove}><IconTrash {...ICON} /></ActionIcon>
      )}
    </Group>
  )
}

function Upload({ meetingId }: { meetingId: string }) {
  const call = useDocumentCall(meetingId)
  const pick = (file: File | null) => {
    if (!file) return
    const problem = documentProblem(file)
    if (problem) return notifyError(problem === 'size' ? T.fileTooBig : T.fileType)
    call.mutate(() => addMeetingDocument(meetingId, file), { onSuccess: () => notifySuccess(T.uploaded) })
  }
  return (
    <Stack gap={4}>
      <FileButton onChange={pick} accept={ACCEPT}>
        {(props) => <Button {...props} variant="default" loading={call.isPending} leftSection={<IconPaperclip {...ICON} />}
          style={{ alignSelf: 'flex-start' }}>{T.upload}</Button>}
      </FileButton>
      <Text size="xs" c="dimmed">{T.hint}</Text>
    </Stack>
  )
}

/** "מסמכים": the meeting's attached documents with download links; admins add and remove them while the state allows. */
export function MeetingDocuments({ meetingId, status, isAdmin }: { meetingId: string; status: MeetingStatus; isAdmin: boolean }) {
  const docs = useMeetingDocuments(meetingId)
  const remove = useDocumentCall(meetingId)
  const [removing, setRemoving] = useState<MeetingDocument | null>(null)
  const list = docs.data ?? []
  if (!isAdmin && list.length === 0) return null
  const confirm = () => removing && remove.mutate(() => removeMeetingDocument(removing), {
    onSuccess: () => { notifySuccess(T.removed); setRemoving(null) },
  })
  return (
    <Card>
      <Stack gap="sm">
        <Title order={2} size="h4">{T.title}</Title>
        {list.length === 0 && <Text size="sm" c="dimmed">{T.empty}</Text>}
        {list.map((d) => <DocumentRow key={d.id} doc={d} onRemove={isAdmin && canRemove(status) ? () => setRemoving(d) : null} />)}
        {isAdmin && canAdd(status) && <Upload meetingId={meetingId} />}
      </Stack>
      <ConfirmDialog opened={removing !== null} title={T.removeTitle} body={T.removeBody(removing?.file_name ?? '')} confirmLabel={T.removeConfirm}
        loading={remove.isPending} failed={remove.isError} failedMessage={T.removeFailed} onConfirm={confirm} onClose={() => setRemoving(null)} />
    </Card>
  )
}
