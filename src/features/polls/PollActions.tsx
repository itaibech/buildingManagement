import { Button, Group, Modal, Stack, Text } from '@mantine/core'
import { IconClipboardText, IconLock, IconPencil, IconPlayerPlay, IconPrinter, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { he } from '../../lib/he'
import { notifyError, notifySuccess } from '../../ui'
import { meetingISODate } from '../meetings/fmt'
import { FormModal } from '../tenants/dialogs'
import { useClosePoll, useDeletePoll, useOpenPoll } from './api'
import type { PollPhase } from './lifecycle'
import { PollForm } from './PollForm'
import type { Poll } from './types'

const ACT = he.polls.actions
const C = he.polls.confirm
const ICON = { size: 18, stroke: 1.75 } as const
type Pending = 'open' | 'close' | 'delete' | null

function Confirm({ kind, busy, onConfirm, onClose }: { kind: Pending; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const text = kind === 'open' ? [C.openTitle, C.openBody, ACT.open] : kind === 'close' ? [C.closeTitle, C.closeBody, ACT.close] : [C.deleteTitle, C.deleteBody, ACT.delete]
  return (
    <Modal opened={kind !== null} onClose={onClose} title={text[0]} centered radius="lg" closeOnClickOutside={false}>
      <Stack>
        <Text>{text[1]}</Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>{C.cancel}</Button>
          <Button color={kind === 'delete' ? 'debt' : 'enamel'} loading={busy} onClick={onConfirm}>{text[2]}</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

/** Admin: edit and open a draft, close an open poll, delete a draft. */
export function AdminActions({ poll, phase }: { poll: Poll; phase: PollPhase }) {
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const navigate = useNavigate()
  const open = useOpenPoll()
  const close = useClosePoll()
  const remove = useDeletePoll()
  const done = (msg: string) => () => { setPending(null); notifySuccess(msg) }
  const confirm = () => {
    if (pending === 'open') open.mutate(poll.id, { onSuccess: done(ACT.opened) })
    if (pending === 'close') close.mutate(poll.id, { onSuccess: done(ACT.closed) })
    if (pending === 'delete') remove.mutate(poll.id, { onSuccess: () => { done(ACT.deleted)(); void navigate('/polls') } })
  }
  return (
    <Group gap="sm" wrap="wrap">
      {phase === 'draft' && <Button leftSection={<IconPlayerPlay {...ICON} />} onClick={() => setPending('open')}>{ACT.open}</Button>}
      {phase === 'draft' && <Button variant="default" leftSection={<IconPencil {...ICON} />} onClick={() => setEditing(true)}>{ACT.edit}</Button>}
      {phase === 'draft' && <Button variant="subtle" color="debt" leftSection={<IconTrash {...ICON} />} onClick={() => setPending('delete')}>{ACT.delete}</Button>}
      {poll.status === 'open' && <Button color={phase === 'ended' ? 'signal' : 'enamel'} leftSection={<IconLock {...ICON} />} onClick={() => setPending('close')}>{ACT.close}</Button>}
      <Confirm kind={pending} busy={open.isPending || close.isPending || remove.isPending} onConfirm={confirm} onClose={() => setPending(null)} />
      <FormModal opened={editing} title={he.polls.form.editTitle} onClose={() => setEditing(false)}>
        {editing && <PollForm poll={poll} onDone={() => setEditing(false)} />}
      </FormModal>
    </Group>
  )
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    notifySuccess(ACT.copied)
  } catch {
    notifyError(ACT.copyFailed)
  }
}

/** window.print() with the PDF file name "סקר-<date>" (the title is restored afterwards). */
function print(poll: Poll): void {
  const previous = document.title
  document.title = he.polls.protocol.docTitle(meetingISODate(poll.closed_at ?? poll.closes_at))
  try {
    window.print()
  } finally {
    document.title = previous
  }
}

/** Results export: print / PDF, and "הוספה לפרוטוקול" (copies the result text for a meeting addendum). */
export function ExportActions({ poll, text }: { poll: Poll; text: string }) {
  return (
    <Group gap="sm" wrap="wrap">
      <Button variant="default" leftSection={<IconPrinter {...ICON} />} onClick={() => print(poll)}>{ACT.print}</Button>
      <Button variant="default" leftSection={<IconClipboardText {...ICON} />} onClick={() => void copy(text)}>{ACT.copyProtocol}</Button>
    </Group>
  )
}
