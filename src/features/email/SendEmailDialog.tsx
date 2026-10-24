import { Group, Input, MultiSelect, SegmentedControl, Stack, Text, Textarea } from '@mantine/core'
import { useState } from 'react'
import { he } from '../../lib/he'
import { AptPlate } from '../../ui'
import { useApartments } from '../tenants/api'
import { FormModal } from '../tenants/dialogs'
import { sendableCount, useEmailPreview, useSplitSend, type EmailRequest } from './api'
import { PreviewInfo, SendActions } from './parts'

type Scope = 'all' | 'selected' | 'opener'

export interface SendEmailDialogProps {
  opened: boolean
  onClose: () => void
  kind: 'announcement' | 'ticket'
  refId: string
  /** The announcement / ticket title, shown at the top. */
  subject: string
}

/** Multi-select of the building's apartments, each option with its plate. */
export function ApartmentPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const apartments = useApartments()
  const data = (apartments.data ?? []).map((a) => ({ value: a.id, label: he.apartment(a.number), number: a.number }))
  const numberOf = (id: string): number => data.find((d) => d.value === id)?.number ?? 0
  return (
    <MultiSelect label={he.mail.apartments} placeholder={value.length ? undefined : he.mail.apartmentsPlaceholder} data={data}
      value={value} onChange={onChange} searchable hidePickedOptions={false} comboboxProps={{ withinPortal: true }}
      renderOption={({ option }) => <Group gap="sm" wrap="nowrap"><AptPlate number={numberOf(option.value)} size="sm" /><Text size="sm">{option.label}</Text></Group>} />
  )
}

function SendEmailForm({ kind, refId, subject, onClose }: Omit<SendEmailDialogProps, 'opened'>) {
  const scopes: Scope[] = kind === 'ticket' ? ['opener', 'all', 'selected'] : ['all', 'selected']
  const [scope, setScope] = useState<Scope>(scopes[0])
  const [selected, setSelected] = useState<string[]>([])
  const [note, setNote] = useState('')
  const ready = scope !== 'selected' || selected.length > 0
  const apartmentIds = scope === 'all' ? 'all' : scope === 'selected' ? selected : undefined
  const req: EmailRequest | null = ready ? { kind, id: refId, ...(apartmentIds ? { apartmentIds } : {}) } : null
  const preview = useEmailPreview(req)
  const send = useSplitSend()
  const onSend = () => req && send.start({ ...req, ...(note.trim() ? { note: note.trim() } : {}) }, preview.data, onClose)
  return (
    <Stack>
      <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{subject}</Text>
      <Input.Wrapper label={he.mail.scopeLabel}>
        <SegmentedControl fullWidth mt={4} size="md" value={scope} onChange={(v) => setScope(scopes.find((s) => s === v) ?? scopes[0])}
          data={scopes.map((s) => ({ value: s, label: he.mail.scopes[s] }))} />
      </Input.Wrapper>
      {scope === 'selected' && <ApartmentPicker value={selected} onChange={setSelected} />}
      {kind === 'ticket' && (
        <Textarea label={he.mail.note} description={he.mail.noteHint} autosize minRows={2} maxRows={6} maxLength={1000}
          value={note} onChange={(e) => setNote(e.currentTarget.value)} />
      )}
      <PreviewInfo q={preview} idle={!ready} />
      <SendActions count={ready ? sendableCount(preview.data) : 0} loading={send.isPending} progress={send.progress} onSend={onSend} onCancel={onClose} />
    </Stack>
  )
}

/** Admin: email an announcement or a service call to every apartment, chosen apartments, or (calls) the opener's. */
export function SendEmailDialog({ opened, ...props }: SendEmailDialogProps) {
  return (
    <FormModal opened={opened} title={he.mail.dialogTitle} onClose={props.onClose}>
      {opened && <SendEmailForm {...props} />}
    </FormModal>
  )
}
