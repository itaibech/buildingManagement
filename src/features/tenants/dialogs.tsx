import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import type { ReactNode } from 'react'
import { he } from '../../lib/he'

/** A form sheet: full screen on mobile, a centered modal from 768px up. */
export function FormModal({ opened, title, onClose, children }: { opened: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const mobile = useMediaQuery('(max-width: 767px)')
  return (
    <Modal opened={opened} onClose={onClose} title={title} fullScreen={mobile} centered radius="lg"
      styles={{ title: { fontFamily: 'var(--bm-heading-font)', fontSize: '1.375rem' } }}>
      {children}
    </Modal>
  )
}

export interface ConfirmDialogProps {
  opened: boolean
  title: string
  body: string
  confirmLabel: string
  loading: boolean
  failed: boolean
  onConfirm: () => void
  onClose: () => void
}

/** Destructive confirmation: plain question, what else is affected, cancel + red confirm. */
export function ConfirmDialog({ opened, title, body, confirmLabel, loading, failed, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered radius="lg"
      styles={{ title: { fontWeight: 600, fontSize: '1.125rem' } }}>
      <Stack>
        <Text>{body}</Text>
        {failed && <Alert color="debt">{he.tenants.errors.delete}</Alert>}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>{he.tenants.cancel}</Button>
          <Button color="debt" loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
