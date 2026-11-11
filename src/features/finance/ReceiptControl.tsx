import { ActionIcon, Box, Button, Group, Menu, Stack, Text, UnstyledButton } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconCamera, IconFile, IconPaperclip, IconTrash } from '@tabler/icons-react'
import { useRef, useState, type RefObject } from 'react'
import { he } from '../../lib/he'
import { notifyError, notifySuccess, PasteButton, PasteHint, usePasteFile } from '../../ui'
import { useTicketFiles } from '../tickets/detailsApi'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { receiptUrl, useAddReceipts, useCopyTicketFiles, useRemoveReceipt, type Expense } from './api'
import { RECEIPT_ACCEPT } from './ledger'
import { ThumbBox, TicketFilesPick } from './ReceiptsField'
import { isCopied, MAX_RECEIPTS, preselected, receiptsProblem, type ExpenseReceipt } from './receiptsApi'

const R = he.finance.receipts
const ICON = { size: 18, stroke: 1.75 } as const

/** Opens the window first (inside the tap) so mobile Safari doesn't block it, then points it at the signed URL. */
function openReceipt(path: string): void {
  const win = window.open('', '_blank')
  // Cut the back-reference (noopener can't be used: it makes window.open return null).
  if (win) win.opener = null
  receiptUrl(path).then((url) => { if (win) win.location.href = url }).catch(() => { win?.close(); notifyError(he.finance.receiptOpenFailed) })
}

/** A hidden file input; the visible buttons click it. Cleared after each pick so the same files can be picked again. */
function Picker({ inputRef, camera, onPick }: { inputRef: RefObject<HTMLInputElement | null>; camera?: boolean; onPick: (f: File[]) => void }) {
  return (
    <input ref={inputRef} type="file" hidden tabIndex={-1} aria-hidden="true" multiple={!camera}
      accept={camera ? 'image/*' : RECEIPT_ACCEPT} capture={camera ? 'environment' : undefined}
      onChange={(e) => { const f = Array.from(e.currentTarget.files ?? []); e.currentTarget.value = ''; if (f.length) onPick(f) }} />
  )
}

/** "n receipts saved", or which files didn't make it. */
function reportAdded(total: number, failed: readonly string[]): void {
  if (failed.length > 0) notifyError(R.failed([...failed]))
  else notifySuccess(R.saved(total))
}

/** Checks the files against the room left, uploads them and says how it went. */
function useUpload(expense: Expense) {
  const add = useAddReceipts()
  const upload = (files: File[]) => {
    const problem = receiptsProblem(files, MAX_RECEIPTS - expense.receipts.length)
    if (problem) { notifyError(problem); return }
    add.mutate({ expenseId: expense.id, files }, {
      onSuccess: (failed) => reportAdded(files.length, failed),
    })
  }
  return { upload, busy: add.isPending }
}

/** "הוספת קבלות": the file picker; on a touch screen it also offers the camera. Plus paste. */
function AddButtons({ busy, full, onPick }: { busy: boolean; full: boolean; onPick: (f: File[]) => void }) {
  const coarse = useMediaQuery('(pointer: coarse)')
  const file = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const openFiles = () => file.current?.click()
  const openCamera = () => camera.current?.click()
  const trigger = (
    <Button variant="default" mih={44} loading={busy} disabled={full} onClick={coarse ? undefined : openFiles} leftSection={<IconPaperclip {...ICON} />}>
      {R.addMore}
    </Button>
  )
  return (
    <Group gap="xs">
      <Picker inputRef={file} onPick={onPick} />
      <Picker inputRef={camera} camera onPick={onPick} />
      {coarse ? (
        <Menu position="bottom-start" withinPortal>
          <Menu.Target>{trigger}</Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconCamera {...ICON} />} onClick={openCamera}>{R.takePhoto}</Menu.Item>
            <Menu.Item leftSection={<IconFile {...ICON} />} onClick={openFiles}>{R.pickFile}</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      ) : trigger}
      <PasteButton onFile={(f) => onPick([f])} disabled={full || busy} />
    </Group>
  )
}

/** One receipt: tap to open it (a signed URL, made on the tap), or remove it. */
function ReceiptLine({ receipt, onRemove }: { receipt: ExpenseReceipt; onRemove: () => void }) {
  return (
    <Group gap="sm" wrap="nowrap" mih={56} data-testid="receipt-line">
      <UnstyledButton onClick={() => openReceipt(receipt.path)} aria-label={R.view(receipt.file_name)} style={{ flex: 1, minWidth: 0 }}>
        <Group gap="sm" wrap="nowrap">
          <ThumbBox src={null} image={receipt.mime.startsWith('image/')} />
          <Text size="sm" fw={600} truncate="end" style={{ minWidth: 0 }}>{receipt.file_name}</Text>
        </Group>
      </UnstyledButton>
      <ActionIcon variant="subtle" color="debt" size={44} aria-label={R.removeOne(receipt.file_name)} onClick={onRemove}>
        <IconTrash {...ICON} />
      </ActionIcon>
    </Group>
  )
}

/** The expense's ticket files that aren't receipts yet, to copy in (also the retry after a failed copy). */
function TicketCopy({ expense }: { expense: Expense }) {
  const files = useTicketFiles(expense.ticket_id ?? '', !!expense.ticket_id).data ?? []
  const copy = useCopyTicketFiles()
  const done = new Set(files.filter((f) => isCopied(f, expense.receipts)).map((f) => f.path))
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null)
  const selected = chosen ?? new Set(files.filter((f) => preselected(f) && !done.has(f.path)).map((f) => f.path))
  const picked = files.filter((f) => selected.has(f.path) && !done.has(f.path))
  const room = MAX_RECEIPTS - expense.receipts.length
  const toggle = (path: string, on: boolean) => setChosen(new Set([...selected].filter((p) => p !== path).concat(on ? [path] : [])))
  const run = () => copy.mutate({ expenseId: expense.id, files: picked }, {
    onSuccess: (failed) => { setChosen(null); reportAdded(picked.length, failed) },
  })
  if (files.length === 0 || done.size === files.length) return null
  return (
    <Stack gap="xs">
      <TicketFilesPick files={files} selected={selected} done={done} full={picked.length >= room} onToggle={toggle} />
      <Button variant="light" mih={44} loading={copy.isPending} disabled={picked.length === 0 || picked.length > room} onClick={run}>{R.copy(picked.length)}</Button>
    </Stack>
  )
}

/** "קבלות ההוצאה": the list (open or remove each), add more (up to 10), and the ticket's files when it came from one. */
function ReceiptsSheet({ expense, upload, busy }: { expense: Expense; upload: (f: File[]) => void; busy: boolean }) {
  const remove = useRemoveReceipt()
  const [removing, setRemoving] = useState<ExpenseReceipt | null>(null)
  const zone = usePasteFile({ accept: RECEIPT_ACCEPT, onFile: (f) => upload([f]), enabled: !busy })
  const confirm = () => removing && remove.mutate(removing, {
    onSuccess: ({ fileStayed }) => { (fileStayed ? notifyError : notifySuccess)(fileStayed ? R.fileStayed : R.removed); setRemoving(null) },
  })
  const full = expense.receipts.length >= MAX_RECEIPTS
  return (
    <Stack ref={zone}>
      {expense.receipts.length === 0 && <Text c="dimmed">{R.none}</Text>}
      {expense.receipts.map((r) => <ReceiptLine key={r.id} receipt={r} onRemove={() => setRemoving(r)} />)}
      <AddButtons busy={busy} full={full} onPick={upload} />
      <Text size="xs" c="dimmed">{full ? R.full : he.finance.receiptHint}</Text>
      <PasteHint />
      {expense.ticket_id && <TicketCopy expense={expense} />}
      <ConfirmDialog opened={!!removing} title={R.removeConfirm} body={R.removeBody} confirmLabel={R.remove}
        loading={remove.isPending} failed={remove.isError} onClose={() => setRemoving(null)} onConfirm={confirm} />
    </Stack>
  )
}

/** An expense row's receipts: 📎 with the count; tapping opens the list. Ctrl+V on the focused 📎 attaches a screenshot. */
export function ReceiptControl({ expense }: { expense: Expense }) {
  const [open, setOpen] = useState(false)
  const { upload, busy } = useUpload(expense)
  const zone = usePasteFile({ accept: RECEIPT_ACCEPT, onFile: (f) => upload([f]), enabled: !busy && !open })
  const n = expense.receipts.length
  return (
    <Box ref={zone} display="contents">
      {n === 0 ? (
        <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={R.add} loading={busy} onClick={() => setOpen(true)}>
          <IconPaperclip size={20} stroke={1.75} aria-hidden="true" />
        </ActionIcon>
      ) : (
        <Button variant="light" color="enamel" radius="xl" h={44} px="sm" loading={busy} aria-label={R.open(n)} onClick={() => setOpen(true)}
          leftSection={<IconPaperclip {...ICON} aria-hidden="true" />}>{n}</Button>
      )}
      <FormModal opened={open} title={R.title} compact onClose={() => setOpen(false)}>
        {open && <ReceiptsSheet expense={expense} upload={upload} busy={busy} />}
      </FormModal>
    </Box>
  )
}
