import { Checkbox, Divider, Group, Stack, Text } from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { useState } from 'react'
import { he } from '../../lib/he'
import { AptPlate, Money } from '../../ui'
import type { ApartmentBalance } from '../finance/api'
import { sendableCount, useEmailPreview, useSendEmail, useSplitSend } from './api'
import { PreviewInfo, SendActions } from './parts'

/** One apartment's reminder: its balance, the recipients count, send. */
export function DebtReminderForm({ apartment, onDone }: { apartment: ApartmentBalance; onDone: () => void }) {
  const req = { kind: 'debt' as const, apartmentIds: [apartment.apartmentId] }
  const preview = useEmailPreview(req)
  const send = useSendEmail()
  return (
    <Stack>
      <Group gap="md" wrap="nowrap">
        <AptPlate number={apartment.number} size="lg" />
        <Stack gap={2}>
          <Text fw={600}>{he.mail.debt.title}</Text>
          <Money amount={apartment.balance} size="lg" />
        </Stack>
      </Group>
      <Text size="sm" c="dimmed">{he.mail.debt.body}</Text>
      <PreviewInfo q={preview} />
      <SendActions count={sendableCount(preview.data)} loading={send.isPending} onCancel={onDone}
        onSend={() => send.mutate(req, { onSuccess: onDone })} />
    </Stack>
  )
}

function DebtorRow({ row, checked, onToggle }: { row: ApartmentBalance; checked: boolean; onToggle: () => void }) {
  return (
    <Group gap="sm" wrap="nowrap" mih={44} px="xs">
      <Checkbox checked={checked} onChange={onToggle} aria-label={he.mail.debt.pick(row.number)} size="md" />
      <AptPlate number={row.number} size="sm" />
      <Text size="sm" truncate="end" style={{ flex: 1, minWidth: 0 }}>{row.names.join(', ') || he.finance.noResidents}</Text>
      <Money amount={row.balance} size="sm" />
    </Group>
  )
}

/** Every debtor, all checked: uncheck any, see the count, send personalised reminders. */
export function DebtBulkForm({ debtors, onDone }: { debtors: ApartmentBalance[]; onDone: () => void }) {
  const [picked, setPicked] = useState<string[]>(() => debtors.map((d) => d.apartmentId))
  const [debounced] = useDebouncedValue(picked, 300)
  const req = debounced.length ? { kind: 'debt' as const, apartmentIds: debounced } : null
  const preview = useEmailPreview(req)
  const send = useSplitSend()
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const all = picked.length === debtors.length
  const settled = debounced === picked
  return (
    <Stack>
      <Text size="sm" c="dimmed">{he.mail.debt.bulkBody}</Text>
      <Checkbox label={he.mail.debt.selectAll} checked={all} indeterminate={!all && picked.length > 0} size="md" px="xs"
        onChange={() => setPicked(all ? [] : debtors.map((d) => d.apartmentId))} />
      <Divider color="stone.1" />
      <Stack gap={0}>
        {debtors.map((d) => <DebtorRow key={d.apartmentId} row={d} checked={picked.includes(d.apartmentId)} onToggle={() => toggle(d.apartmentId)} />)}
      </Stack>
      {picked.length === 0 ? <Text size="sm" c="debt.7">{he.mail.debt.noneSelected}</Text> : <PreviewInfo q={preview} />}
      <SendActions count={picked.length && settled ? sendableCount(preview.data) : 0} loading={send.isPending} onCancel={onDone}
        progress={send.progress} onSend={() => send.start({ kind: 'debt', apartmentIds: picked }, preview.data, onDone)} />
    </Stack>
  )
}
