import { ActionIcon, Badge, Button, Center, FileButton, Group, Image, Input, Modal, Stack, Switch, Text, UnstyledButton } from '@mantine/core'
import { IconFileText, IconPaperclip, IconPhoto, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { he } from '../../lib/he'
import { notifyError, notifySuccess, PasteButton, PasteHint, usePasteFile } from '../../ui'
import { ConfirmDialog } from '../tenants/dialogs'
import { signTicketFile, useDeleteTicketFile, useSetFileVisibility, useThumbnails, useUploadTicketFiles, type TicketFile } from './detailsApi'
import { defaultVisible, FILE_ACCEPT, isImagePath, MAX_FILES, validateFiles } from './files'

const T = he.ticketDetails
const THUMB = 56
const ICON = { size: 22, stroke: 1.75 } as const

function Thumb({ file, url }: { file: TicketFile; url: string | undefined }) {
  const [broken, setBroken] = useState(false)
  const image = isImagePath(file.path)
  if (image && url && !broken) return <Image src={url} alt="" w={THUMB} h={THUMB} radius={8} fit="cover" bg="stone.1" onError={() => setBroken(true)} />
  return (
    <Center w={THUMB} h={THUMB} bg="stone.1" c="stone.7" style={{ borderRadius: 8, flexShrink: 0 }}>
      {image ? <IconPhoto {...ICON} aria-hidden="true" /> : <IconFileText {...ICON} aria-hidden="true" />}
    </Center>
  )
}

interface RowProps { file: TicketFile; url: string | undefined; admin: boolean; onOpen: () => void; onDelete: () => void }

function FileRow({ file, url, admin, onOpen, onDelete }: RowProps) {
  const visibility = useSetFileVisibility()
  const toggle = (visible: boolean) => visibility.mutate({ id: file.id, visible }, { onError: () => notifyError(he.toast.failed) })
  return (
    <Group gap="sm" wrap="nowrap" mih={56} data-testid="ticket-file">
      <UnstyledButton onClick={onOpen} aria-label={T.openFile(file.file_name)} style={{ flex: 1, minWidth: 0 }}>
        <Group gap="sm" wrap="nowrap">
          <Thumb file={file} url={url} />
          <Text size="sm" fw={600} truncate="end" style={{ minWidth: 0 }}>{file.file_name}</Text>
        </Group>
      </UnstyledButton>
      {admin && !file.visible_to_residents && <Badge color="stone" variant="light" style={{ flexShrink: 0 }}>{T.committeeOnly}</Badge>}
      {admin && (
        <Switch aria-label={`${T.visible}: ${file.file_name}`} checked={file.visible_to_residents} size="md"
          onChange={(e) => toggle(e.currentTarget.checked)} disabled={visibility.isPending} />
      )}
      {admin && (
        <ActionIcon variant="subtle" color="debt" size={44} aria-label={T.deleteFile(file.file_name)} onClick={onDelete}>
          <IconTrash size={18} stroke={1.75} />
        </ActionIcon>
      )}
    </Group>
  )
}

/** Admin: pick or paste files; images default to visible, PDF / Word to the committee only. */
function Uploader({ ticketId, count }: { ticketId: string; count: number }) {
  const upload = useUploadTicketFiles()
  const [error, setError] = useState<string | null>(null)
  const add = (files: File[]) => {
    const problem = validateFiles(files, count)
    setError(problem)
    if (problem || files.length === 0) return
    upload.mutate({ ticketId, files: files.map((file) => ({ file, visible: defaultVisible(file) })) }, {
      onSuccess: (failed) => (failed ? notifyError(T.uploadFailed(failed)) : notifySuccess(T.uploaded(files.length))),
      onError: () => notifyError(he.toast.failed),
    })
  }
  const zone = usePasteFile({ accept: FILE_ACCEPT, onFile: (f) => add([f]), enabled: count < MAX_FILES })
  return (
    <Input.Wrapper ref={zone} description={T.filesHint} error={error}>
      {count < MAX_FILES && (
        <Group gap="xs" mt={4}>
          <FileButton onChange={add} accept={FILE_ACCEPT} multiple>
            {(props) => <Button {...props} variant="light" mih={44} loading={upload.isPending} leftSection={<IconPaperclip size={18} stroke={1.75} />}>{T.addFiles}</Button>}
          </FileButton>
          <PasteButton onFile={(f) => add([f])} disabled={upload.isPending} />
        </Group>
      )}
      <PasteHint />
    </Input.Wrapper>
  )
}

/** Images open in a preview, other files download; each link is signed on click for a minute. */
function useOpener() {
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null)
  const open = async (file: TicketFile) => {
    try {
      const image = isImagePath(file.path) && !/\.(heic|heif)$/i.test(file.path)
      const url = await signTicketFile(file, !image)
      if (image) setPreview({ name: file.file_name, url })
      else window.location.assign(url)
    } catch {
      notifyError(T.errors.open)
    }
  }
  return { preview, close: () => setPreview(null), open: (f: TicketFile) => void open(f) }
}

export interface TicketFilesProps { ticketId: string; files: TicketFile[]; admin: boolean }

/** The ticket's attachments. Admins also add, delete and choose what residents see. */
export function TicketFiles({ ticketId, files, admin }: TicketFilesProps) {
  const thumbs = useThumbnails(files)
  const opener = useOpener()
  const remove = useDeleteTicketFile()
  const [removing, setRemoving] = useState<TicketFile | null>(null)
  const confirm = () => removing && remove.mutate(removing, { onSuccess: () => { notifySuccess(T.fileDeleted); setRemoving(null) } })
  if (!admin && files.length === 0) return null
  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">{T.files}</Text>
      {files.map((f) => (
        <FileRow key={f.id} file={f} url={thumbs.data?.[f.path]} admin={admin} onOpen={() => opener.open(f)} onDelete={() => setRemoving(f)} />
      ))}
      {admin && <Uploader ticketId={ticketId} count={files.length} />}
      <Modal opened={!!opener.preview} onClose={opener.close} size="xl" centered radius="lg" padding="xs" title={opener.preview?.name ?? ''}>
        {opener.preview && <Image src={opener.preview.url} alt={opener.preview.name} radius={10} fit="contain" mah="80vh" />}
      </Modal>
      <ConfirmDialog opened={!!removing} title={T.deleteFileConfirm(removing?.file_name ?? '')} body={T.deleteFileBody}
        confirmLabel={T.deleteFileLabel} loading={remove.isPending} failed={remove.isError} onClose={() => setRemoving(null)} onConfirm={confirm} />
    </Stack>
  )
}
