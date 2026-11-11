import { Button, Center, Checkbox, CloseButton, FileButton, Group, Image, Stack, Text } from '@mantine/core'
import { IconFileText, IconPaperclip, IconPhoto } from '@tabler/icons-react'
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { he } from '../../lib/he'
import { PasteButton, PasteHint, usePasteFile } from '../../ui'
import { useThumbnails, type TicketFile } from '../tickets/detailsApi'
import { RECEIPT_ACCEPT, receiptMime } from './ledger'
import { receiptsProblem } from './receiptsApi'

const R = he.finance.receipts
const THUMB = 56
const ICON = { size: 22, stroke: 1.75 } as const
const DRAWABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

/** A 56px square: the picture when the browser can draw it, else a photo or document icon. */
export function ThumbBox({ src, image }: { src: string | null | undefined; image: boolean }) {
  const [broken, setBroken] = useState(false)
  if (src && !broken) return <Image src={src} alt="" w={THUMB} h={THUMB} radius={8} fit="cover" bg="stone.1" onError={() => setBroken(true)} />
  return (
    <Center w={THUMB} h={THUMB} bg="stone.1" c="stone.7" style={{ borderRadius: 8, flexShrink: 0 }}>
      {image ? <IconPhoto {...ICON} aria-hidden="true" /> : <IconFileText {...ICON} aria-hidden="true" />}
    </Center>
  )
}

/** A local preview of a picked file (the object URL is released when it goes). */
function LocalThumb({ file }: { file: File }) {
  const mime = receiptMime(file) ?? ''
  const url = useMemo(() => (DRAWABLE.has(mime) ? URL.createObjectURL(file) : null), [file, mime])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  return <ThumbBox src={url} image={mime.startsWith('image/')} />
}

/** The files picked so far, each with its thumbnail and a remove button. */
function PickedList({ files, onRemove }: { files: readonly File[]; onRemove: (i: number) => void }) {
  return (
    <Stack gap={4}>
      {files.map((f, i) => (
        <Group key={`${f.name}-${f.size}-${f.lastModified}-${i}`} gap="sm" wrap="nowrap" data-testid="picked-receipt">
          <LocalThumb file={f} />
          <Text size="sm" truncate="end" style={{ flex: 1, minWidth: 0 }}>{f.name}</Text>
          <CloseButton size={44} aria-label={he.finance.removeReceipt(f.name)} onClick={() => onRemove(i)} />
        </Group>
      ))}
    </Stack>
  )
}

export interface ReceiptsFieldProps {
  files: File[]
  /** A state setter: pastes in quick succession each add to the latest list. */
  onChange: Dispatch<SetStateAction<File[]>>
  /** How many more receipts the expense can take besides `files` (10, less the ticket files ticked). */
  room: number
}

/** "קבלות": pick several files, or paste screenshots one by one; each is checked like a picked file. Up to 10. */
export function ReceiptsField({ files, onChange, room }: ReceiptsFieldProps) {
  const [error, setError] = useState<string | null>(null)
  const add = (picked: File[]) => {
    const problem = receiptsProblem(picked, room - files.length)
    setError(problem)
    if (!problem && picked.length > 0) onChange((prev) => [...prev, ...picked].slice(0, room))
  }
  const zone = usePasteFile({ accept: RECEIPT_ACCEPT, onFile: (f) => add([f]) })
  const full = files.length >= room
  return (
    <Stack gap={4} ref={zone}>
      <Text size="sm" fw={600}>{he.finance.receipt}</Text>
      <PickedList files={files} onRemove={(i) => { setError(null); onChange((prev) => prev.filter((_, j) => j !== i)) }} />
      <Group gap="xs">
        <FileButton accept={RECEIPT_ACCEPT} multiple onChange={add} disabled={full}>
          {(props) => <Button variant="default" mih={44} disabled={full} leftSection={<IconPaperclip size={18} stroke={1.75} />} {...props}>{he.finance.attachReceipt}</Button>}
        </FileButton>
        <PasteButton onFile={(f) => add([f])} disabled={full} />
      </Group>
      <Text size="xs" c={error ? 'debt.7' : 'dimmed'}>{error ?? he.finance.receiptHint}</Text>
      <PasteHint />
    </Stack>
  )
}

interface TicketPickProps {
  files: readonly TicketFile[]
  selected: ReadonlySet<string>
  onToggle: (path: string, on: boolean) => void
  /** Paths that can't be ticked (already copied in). */
  done?: ReadonlySet<string>
  /** No more room: only ticked files can change. */
  full?: boolean
}

/** "קבצים מהתקלה": the ticket's attachments as tickable thumbnails. They are copied, never moved. */
export function TicketFilesPick({ files, selected, onToggle, done, full }: TicketPickProps) {
  const thumbs = useThumbnails(files).data ?? {}
  if (files.length === 0) return null
  return (
    <Stack gap={4} data-testid="ticket-files-pick">
      <Text size="sm" fw={600}>{R.fromTicket}</Text>
      <Text size="xs" c="dimmed">{R.fromTicketHint}</Text>
      {files.map((f) => {
        const copied = done?.has(f.path) ?? false
        const on = selected.has(f.path)
        return (
          <Group key={f.path} gap="sm" wrap="nowrap" mih={56}>
            <Checkbox size="md" aria-label={R.pickTicketFile(f.file_name)} checked={on || copied} disabled={copied || (!!full && !on)}
              onChange={(e) => onToggle(f.path, e.currentTarget.checked)} styles={{ body: { minHeight: 44, alignItems: 'center' } }} />
            <ThumbBox src={thumbs[f.path]} image={/\.(jpg|jpeg|png|webp|heic|heif)$/i.test(f.path)} />
            <Text size="sm" truncate="end" style={{ flex: 1, minWidth: 0 }}>{f.file_name}</Text>
            {copied && <Text size="xs" c="dimmed">{R.copied}</Text>}
          </Group>
        )
      })}
    </Stack>
  )
}
