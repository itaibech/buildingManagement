import { ActionIcon, Button, Menu } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconCamera, IconEye, IconFile, IconPaperclip, IconReceipt, IconReplace, IconTrash } from '@tabler/icons-react'
import { useRef, useState, type RefObject } from 'react'
import { he } from '../../lib/he'
import { notifyError, notifySuccess } from '../../ui'
import { ConfirmDialog } from '../tenants/dialogs'
import { receiptUrl, useRemoveReceipt, useSetReceipt, type Expense } from './api'
import { RECEIPT_ACCEPT, receiptError } from './ledger'

const R = he.finance.receipts
const ICON = { size: 18, stroke: 1.75 } as const

/** Opens the window first (inside the tap) so mobile Safari doesn't block it, then points it at the signed URL. */
function openReceipt(path: string): void {
  const win = window.open('', '_blank')
  // Cut the back-reference (noopener can't be used: it makes window.open return null).
  if (win) win.opener = null
  receiptUrl(path).then((url) => { if (win) win.location.href = url }).catch(() => { win?.close(); notifyError(he.finance.receiptOpenFailed) })
}

/** A hidden file input; the visible buttons click it. Cleared after each pick so the same file can be picked again. */
function Picker({ inputRef, camera, onPick }: { inputRef: RefObject<HTMLInputElement | null>; camera?: boolean; onPick: (f: File) => void }) {
  return (
    <input ref={inputRef} type="file" hidden tabIndex={-1} aria-hidden="true"
      accept={camera ? 'image/*' : RECEIPT_ACCEPT} capture={camera ? 'environment' : undefined}
      onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) onPick(f) }} />
  )
}

/** No receipt yet: a paperclip. On a touch screen it offers the camera or a file; otherwise it opens the file picker. */
function AddReceipt({ busy, onFile, onCamera }: { busy: boolean; onFile: () => void; onCamera: () => void }) {
  const coarse = useMediaQuery('(pointer: coarse)')
  const button = (onClick?: () => void) => (
    <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={R.add} loading={busy} onClick={onClick}>
      <IconPaperclip size={20} stroke={1.75} aria-hidden="true" />
    </ActionIcon>
  )
  if (!coarse) return button(onFile)
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>{button()}</Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconCamera {...ICON} />} onClick={onCamera}>{R.takePhoto}</Menu.Item>
        <Menu.Item leftSection={<IconFile {...ICON} />} onClick={onFile}>{R.pickFile}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

interface ChipProps { name: string; busy: boolean; onView: () => void; onReplace: () => void; onRemove: () => void }

/** Has a receipt: a "קבלה" chip with view, replace and remove. */
function ReceiptChip({ name, busy, onView, onReplace, onRemove }: ChipProps) {
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <Button variant="light" color="enamel" radius="xl" h={44} px="sm" loading={busy} aria-label={R.actions(name)} title={name}
          leftSection={<IconReceipt {...ICON} aria-hidden="true" />}>{R.chip}</Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconEye {...ICON} />} onClick={onView}>{R.view}</Menu.Item>
        <Menu.Item leftSection={<IconReplace {...ICON} />} onClick={onReplace}>{R.replace}</Menu.Item>
        <Menu.Item color="debt" leftSection={<IconTrash {...ICON} />} onClick={onRemove}>{R.remove}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

/** An expense row's receipt: attach (image, PDF, Word), view, replace or remove. Admin-only, like the bucket. */
export function ReceiptControl({ expense }: { expense: Expense }) {
  const file = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const [confirming, setConfirming] = useState(false)
  const setReceipt = useSetReceipt()
  const remove = useRemoveReceipt()
  const path = expense.receipt_path
  const upload = (f: File) => {
    const error = receiptError(f)
    if (error) { notifyError(error); return }
    setReceipt.mutate({ expense, file: f }, { onSuccess: ({ oldStayed }) => (oldStayed ? notifyError(R.oldStayed) : notifySuccess(R.saved)) })
  }
  const confirmRemove = () => remove.mutate(expense, {
    onSuccess: ({ fileStayed }) => { (fileStayed ? notifyError : notifySuccess)(fileStayed ? R.fileStayed : R.removed); setConfirming(false) },
  })
  return (
    <>
      <Picker inputRef={file} onPick={upload} />
      <Picker inputRef={camera} camera onPick={upload} />
      {path ? (
        <ReceiptChip name={expense.receipt_name ?? R.chip} busy={setReceipt.isPending || remove.isPending}
          onView={() => openReceipt(path)} onReplace={() => file.current?.click()} onRemove={() => setConfirming(true)} />
      ) : (
        <AddReceipt busy={setReceipt.isPending} onFile={() => file.current?.click()} onCamera={() => camera.current?.click()} />
      )}
      <ConfirmDialog opened={confirming} title={R.removeConfirm} body={R.removeBody} confirmLabel={R.remove}
        loading={remove.isPending} failed={remove.isError} onClose={() => setConfirming(false)} onConfirm={confirmRemove} />
    </>
  )
}
