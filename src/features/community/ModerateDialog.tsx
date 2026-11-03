import { Alert, Button, Group, Modal, Stack, Textarea } from '@mantine/core'
import { useState } from 'react'
import { he } from '../../lib/he'

const M = he.community.moderation

export interface ModerateDialogProps {
  opened: boolean
  title: string
  confirmLabel: string
  loading: boolean
  failed: boolean
  onConfirm: (reason: string) => void
  onClose: () => void
}

/** Admin: hide or delete with a reason (required, up to 300 characters), shown to the author. */
export function ModerateDialog({ opened, title, confirmLabel, loading, failed, onConfirm, onClose }: ModerateDialogProps) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const confirm = () => {
    if (reason.trim()) onConfirm(reason.trim())
    else setError(M.reasonRequired)
  }
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered radius="lg" closeOnClickOutside={false}
      styles={{ title: { fontWeight: 600, fontSize: '1.125rem' } }}>
      <Stack>
        <Textarea label={M.reason} description={M.reasonHint} withAsterisk data-autofocus autosize minRows={2} maxLength={300}
          value={reason} error={error} onChange={(e) => { setReason(e.currentTarget.value); setError(null) }} />
        {failed && <Alert color="debt">{he.toast.failed}</Alert>}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>{he.tenants.cancel}</Button>
          <Button color="debt" loading={loading} onClick={confirm}>{confirmLabel}</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
