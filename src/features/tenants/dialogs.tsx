import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import type { ReactNode } from 'react'
import { he } from '../../lib/he'

/**
 * A form sheet: full screen on mobile, a centered modal from 768px up. `compact`: a short sheet, never full screen.
 * A click outside never closes it (that loses typed input by accident); only ✕, the form's cancel, or Esc do.
 */
export function FormModal({ opened, title, onClose, children, compact = false }: { opened: boolean; title: string; onClose: () => void; children: ReactNode; compact?: boolean }) {
  const mobile = useMediaQuery('(max-width: 767px)')
  return (
    <Modal opened={opened} onClose={onClose} title={title} fullScreen={mobile && !compact} centered radius="lg"
      size={compact ? 'md' : 'lg'} closeOnClickOutside={false}
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
  /** Shown instead of the generic failure when the reason is known. */
  failedMessage?: string
  onConfirm: () => void
  onClose: () => void
}

/** Destructive confirmation: plain question, what else is affected, cancel + red confirm. */
export function ConfirmDialog({ opened, title, body, confirmLabel, loading, failed, failedMessage, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered radius="lg"
      styles={{ title: { fontWeight: 600, fontSize: '1.125rem' } }}>
      <Stack>
        <Text>{body}</Text>
        {failed && <Alert color="debt">{failedMessage ?? he.tenants.errors.delete}</Alert>}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>{he.tenants.cancel}</Button>
          <Button color="debt" loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
