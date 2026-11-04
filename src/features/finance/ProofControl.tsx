import { ActionIcon, Button, CloseButton, FileButton, Group, Image, Menu, Stack, Text, ThemeIcon } from '@mantine/core'
import { IconEye, IconFileTypePdf, IconPaperclip, IconPhoto, IconReplace, IconTrash } from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { he } from '../../lib/he'
import { notifyError, notifySuccess } from '../../ui'
import { ConfirmDialog } from '../tenants/dialogs'
import { proofUrl, useRemoveProof, useSetProof, type Payment } from './api'
import { PROOF_ACCEPT, proofError, proofMime } from './ledger'

const P = he.finance.proof
const ICON = { size: 18, stroke: 1.75 } as const
// Browsers outside Safari can't draw HEIC: those (and PDFs) get an icon instead of a thumbnail.
const DRAWABLE = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** Opens the window first (inside the tap) so mobile Safari doesn't block it, then points it at a 60-second signed URL. */
function openProof(path: string): void {
  const win = window.open('', '_blank')
  // Cut the back-reference (noopener can't be used: it makes window.open return null).
  if (win) win.opener = null
  proofUrl(path).then((url) => { if (win) win.location.href = url }).catch(() => { win?.close(); notifyError(P.openFailed) })
}

/** A local preview of the picked file: a thumbnail for JPG / PNG / WEBP, else a PDF or image icon. */
function Thumb({ file }: { file: File }) {
  const mime = proofMime(file)
  const url = useMemo(() => (mime && DRAWABLE.has(mime) ? URL.createObjectURL(file) : null), [file, mime])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  if (url) return <Image src={url} alt={P.preview} w={56} h={56} radius="sm" fit="cover" />
  return (
    <ThemeIcon variant="light" color="stone" size={56} radius="sm" aria-label={P.preview}>
      {mime === 'application/pdf' ? <IconFileTypePdf size={28} stroke={1.5} /> : <IconPhoto size={28} stroke={1.5} />}
    </ThemeIcon>
  )
}

/** The dialogs' optional "אסמכתת העברה": pick (camera, gallery or file on a phone), preview, remove before saving. */
export function ProofField({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  const [error, setError] = useState<string | null>(null)
  const pick = (f: File | null) => {
    const err = f ? proofError(f) : null
    setError(err)
    onChange(err ? null : f)
  }
  return (
    <Stack gap={4}>
      <Text size="sm" fw={600}>{P.label}</Text>
      {file ? (
        <Group gap="sm" wrap="nowrap">
          <Thumb file={file} />
          <Text size="sm" truncate="end" style={{ flex: 1 }}>{file.name}</Text>
          <CloseButton size={44} aria-label={P.removePicked} onClick={() => pick(null)} />
        </Group>
      ) : (
        <FileButton accept={PROOF_ACCEPT} onChange={pick}>
          {(props) => <Button variant="default" leftSection={<IconPaperclip {...ICON} />} {...props}>{P.attach}</Button>}
        </FileButton>
      )}
      <Text size="xs" c={error ? 'debt.7' : 'dimmed'} role={error ? 'alert' : undefined}>{error ?? P.hint}</Text>
    </Stack>
  )
}

/** 📎 on a row whose payment has a proof: tapping opens it (admins, and residents for their own apartment). */
export function ProofButton({ path }: { path: string }) {
  return (
    <ActionIcon variant="subtle" color="enamel" size={44} aria-label={P.open} title={P.open} onClick={() => openProof(path)}>
      <IconPaperclip size={20} stroke={1.75} aria-hidden="true" />
    </ActionIcon>
  )
}

interface ChipProps { busy: boolean; onView: () => void; onReplace: () => void; onRemove: () => void }

/** Has a proof: a 📎 "אסמכתה" chip with view, replace and remove. */
function ProofChip({ busy, onView, onReplace, onRemove }: ChipProps) {
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <Button variant="light" color="enamel" radius="xl" h={44} px="sm" loading={busy} aria-label={P.actions}
          leftSection={<IconPaperclip {...ICON} aria-hidden="true" />}>{P.chip}</Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconEye {...ICON} />} onClick={onView}>{P.view}</Menu.Item>
        <Menu.Item leftSection={<IconReplace {...ICON} />} onClick={onReplace}>{P.replace}</Menu.Item>
        <Menu.Item color="debt" leftSection={<IconTrash {...ICON} />} onClick={onRemove}>{P.remove}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

/** Admin: a payment row's proof. Add (camera, gallery or file), view, replace or remove. */
export function ProofControl({ payment }: { payment: Pick<Payment, 'id' | 'proof_path'> }) {
  const input = useRef<HTMLInputElement>(null)
  const [confirming, setConfirming] = useState(false)
  const set = useSetProof()
  const remove = useRemoveProof()
  const path = payment.proof_path
  const upload = (f: File) => {
    const error = proofError(f)
    if (error) { notifyError(error); return }
    set.mutate({ payment, file: f }, { onSuccess: ({ oldStayed }) => (oldStayed ? notifyError(P.fileStayed) : notifySuccess(P.saved)) })
  }
  const confirmRemove = () => remove.mutate(payment, {
    onSuccess: ({ fileStayed }) => { (fileStayed ? notifyError : notifySuccess)(fileStayed ? P.fileStayed : P.removed); setConfirming(false) },
  })
  return (
    <>
      <input ref={input} type="file" hidden tabIndex={-1} aria-hidden="true" accept={PROOF_ACCEPT}
        onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) upload(f) }} />
      {path ? (
        <ProofChip busy={set.isPending || remove.isPending} onView={() => openProof(path)}
          onReplace={() => input.current?.click()} onRemove={() => setConfirming(true)} />
      ) : (
        <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={P.add} title={P.add} loading={set.isPending} onClick={() => input.current?.click()}>
          <IconPaperclip size={20} stroke={1.75} aria-hidden="true" />
        </ActionIcon>
      )}
      <ConfirmDialog opened={confirming} title={P.removeConfirm} body={P.removeBody} confirmLabel={P.remove}
        loading={remove.isPending} failed={remove.isError} onClose={() => setConfirming(false)} onConfirm={confirmRemove} />
    </>
  )
}
