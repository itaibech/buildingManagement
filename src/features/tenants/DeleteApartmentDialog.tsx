import { Alert, Badge, Button, Group, Modal, Stack, Text, TextInput, UnstyledButton } from '@mantine/core'
import { useState } from 'react'
import { he } from '../../lib/he'
import { ListSkeleton } from '../../ui'
import {
  hasHistory, useApartmentHistory, useArchiveApartment, useDeleteApartment, useDeleteApartmentCascade,
  type Apartment, type ApartmentHistory,
} from './api'

type Step = 'overview' | 'purge'
const COUNT_KEYS = ['residents', 'payments', 'charges', 'ev_readings', 'tickets', 'meetings'] as const
const t = he.tenants.removal

function Counts({ h }: { h: ApartmentHistory }) {
  const lines = COUNT_KEYS.filter((k) => h[k] > 0).map((k) => t.counts[k](h[k]))
  if (lines.length === 0) return null
  return (
    <Stack gap={2}>
      <Text fw={600}>{t.exists}</Text>
      <Text size="sm" c="dimmed" className="bm-num">{lines.join(' · ')}</Text>
    </Stack>
  )
}

function Choice({ title, hint, badge, danger, onClick }: { title: string; hint: string; badge?: string; danger?: boolean; onClick: () => void }) {
  return (
    <UnstyledButton onClick={onClick} p="md" mih={56} className="bm-row"
      style={{ border: `1px solid var(--mantine-color-${danger ? 'debt-3' : 'stone-3'})`, borderRadius: 'var(--mantine-radius-md)' }}>
      <Group gap="xs"><Text fw={600} c={danger ? 'debt.7' : undefined}>{title}</Text>{badge && <Badge color="paid" c="paid.9">{badge}</Badge>}</Group>
      <Text size="sm" c="dimmed">{hint}</Text>
    </UnstyledButton>
  )
}

interface Props { apartment: Apartment; opened: boolean; onClose: () => void; onDeleted: () => void; onArchived: () => void }

function Purge({ apartment, onBack, onDeleted }: { apartment: Apartment; onBack: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState('')
  const purge = useDeleteApartmentCascade()
  return (
    <Stack>
      <Text>{t.purgeHint}</Text>
      <Text size="sm" c="dimmed">{t.purgeKeeps}</Text>
      <TextInput label={t.typeNumber(apartment.number)} value={typed} onChange={(e) => setTyped(e.currentTarget.value)} inputMode="numeric" dir="ltr" />
      {purge.isError && <Alert color="debt">{he.tenants.errors.delete}</Alert>}
      <Group justify="flex-end" gap="sm">
        <Button variant="default" onClick={onBack}>{t.back}</Button>
        <Button color="debt" disabled={typed.trim() !== String(apartment.number)} loading={purge.isPending}
          onClick={() => purge.mutate({ id: apartment.id, number: apartment.number }, { onSuccess: onDeleted })}>{t.purgeConfirm}</Button>
      </Group>
    </Stack>
  )
}

function Overview({ apartment, h, onClose, onDeleted, onArchived, onPurge }: Omit<Props, 'opened'> & { h: ApartmentHistory; onPurge: () => void }) {
  const remove = useDeleteApartment()
  const archive = useArchiveApartment()
  const failed = remove.isError || archive.isError
  return (
    <Stack>
      <Counts h={h} />
      {hasHistory(h) ? (
        <>
          <Text>{t.hasHistory}</Text>
          <Choice title={t.archive} hint={t.archiveHint} badge={t.archiveRecommended} onClick={() => archive.mutate(apartment.id, { onSuccess: onArchived })} />
          <Choice title={t.purge} hint={t.purgeHint} danger onClick={onPurge} />
        </>
      ) : <Text>{t.noHistory}</Text>}
      {failed && <Alert color="debt">{he.tenants.errors.delete}</Alert>}
      <Group justify="flex-end" gap="sm">
        <Button variant="default" onClick={onClose}>{he.tenants.cancel}</Button>
        {!hasHistory(h) && <Button color="debt" loading={remove.isPending} onClick={() => remove.mutate(apartment.id, { onSuccess: onDeleted })}>{he.tenants.deleteApartment}</Button>}
      </Group>
    </Stack>
  )
}

/** Two steps: what the apartment holds, then a simple delete (no history), or archive / permanent delete. */
export function DeleteApartmentDialog({ apartment, opened, onClose, onDeleted, onArchived }: Props) {
  const [step, setStep] = useState<Step>('overview')
  const history = useApartmentHistory(apartment.id, opened)
  const close = () => { setStep('overview'); onClose() }
  return (
    <Modal opened={opened} onClose={close} title={he.tenants.deleteApartmentConfirm(apartment.number)} centered radius="lg"
      styles={{ title: { fontWeight: 600, fontSize: '1.125rem' } }}>
      {!history.data ? (history.isError ? <Alert color="debt">{he.tenants.loadError}</Alert> : <Stack gap="xs"><Text size="sm" c="dimmed">{t.loading}</Text><ListSkeleton rows={2} /></Stack>)
        : step === 'purge' ? <Purge apartment={apartment} onBack={() => setStep('overview')} onDeleted={onDeleted} />
          : <Overview apartment={apartment} h={history.data} onClose={close} onDeleted={onDeleted} onArchived={onArchived} onPurge={() => setStep('purge')} />}
    </Modal>
  )
}
