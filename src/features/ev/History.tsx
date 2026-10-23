import { ActionIcon, Divider, Group, Stack, Table, Text, UnstyledButton } from '@mantine/core'
import { IconPencil } from '@tabler/icons-react'
import { Fragment } from 'react'
import { formatILS, formatKwh, formatRate, HEBREW_MONTHS } from '../../lib/format'
import { he } from '../../lib/he'
import { DeleteButton } from '../finance/fields'
import { useDesktop } from '../finance/hooks'
import type { HistoryRow } from './evMath'

export interface HistoryProps { rows: HistoryRow[]; onEdit: (id: string) => void; onDelete: (id: string) => void }

const monthName = (month: string): string => HEBREW_MONTHS[Number(month.slice(5, 7)) - 1] ?? month
const dash = (n: number | null, f: (n: number) => string): string => (n === null ? '—' : f(n))
const diffColor = (n: number): string | undefined => (n < 0 ? 'debt.6' : n > 0 ? 'paid.7' : undefined)
const signed = (n: number): string => (n > 0 ? `+${formatILS(n)}` : formatILS(n))

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={label} onClick={onClick}>
      <IconPencil size={20} stroke={1.75} aria-hidden="true" />
    </ActionIcon>
  )
}

/** Mobile row: month and amount on top, then the sheet's numbers on two full-width lines; tap to edit. */
function MobileRow({ r, onEdit, onDelete }: { r: HistoryRow; onEdit: () => void; onDelete: () => void }) {
  return (
    <Group gap={0} wrap="nowrap" mih={56} px="md" py={6}>
      <UnstyledButton onClick={onEdit} aria-label={he.ev.editReading(monthName(r.month))} mih={44} className="bm-row" style={{ flex: 1, minWidth: 0 }}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text fw={600}>{monthName(r.month)}</Text>
          <Text fw={600} className="bm-num">{dash(r.amount, formatILS)}</Text>
        </Group>
        <Text size="sm" c="dimmed" className="bm-num">
          {`${he.ev.reading} ${formatKwh(r.reading)} · ${he.ev.kwhValue(dash(r.kwh, formatKwh))} · ${dash(r.rate, formatRate)}`}
        </Text>
        <Text size="sm" c="dimmed" className="bm-num">
          {`${he.ev.paid} ${formatILS(r.paid)} · `}<Text span inherit c={diffColor(r.diff)}>{`${he.ev.diff} ${signed(r.diff)}`}</Text>
        </Text>
      </UnstyledButton>
      <DeleteButton label={he.ev.deleteReading(monthName(r.month))} onClick={onDelete} />
    </Group>
  )
}

function MobileList({ rows, onEdit, onDelete }: HistoryProps) {
  return (
    <Stack gap={0}>
      {rows.map((r, i) => (
        <Fragment key={r.id}>
          {i > 0 && <Divider color="stone.1" />}
          <MobileRow r={r} onEdit={() => onEdit(r.id)} onDelete={() => onDelete(r.id)} />
        </Fragment>
      ))}
    </Stack>
  )
}

const COLUMNS = [he.ev.reading, he.ev.kwh, he.ev.rate, he.ev.amount, he.ev.paid, he.ev.diff] as const

function DesktopTable({ rows, onEdit, onDelete }: HistoryProps) {
  return (
    <Table.ScrollContainer minWidth={720}>
      <Table className="bm-num" verticalSpacing="xs" striped="even">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{he.ev.month}</Table.Th>
            {COLUMNS.map((c) => <Table.Th key={c} ta="end">{c}</Table.Th>)}
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td fw={600}>{monthName(r.month)}</Table.Td>
              <Table.Td ta="end">{formatKwh(r.reading)}</Table.Td>
              <Table.Td ta="end">{dash(r.kwh, formatKwh)}</Table.Td>
              <Table.Td ta="end">{dash(r.rate, formatRate)}</Table.Td>
              <Table.Td ta="end">{dash(r.amount, formatILS)}</Table.Td>
              <Table.Td ta="end">{formatILS(r.paid)}</Table.Td>
              <Table.Td ta="end" c={diffColor(r.diff)}>{signed(r.diff)}</Table.Td>
              <Table.Td>
                <Group gap={0} wrap="nowrap" justify="flex-end">
                  <EditButton label={he.ev.editReading(monthName(r.month))} onClick={() => onEdit(r.id)} />
                  <DeleteButton label={he.ev.deleteReading(monthName(r.month))} onClick={() => onDelete(r.id)} />
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  )
}

/** A charger's months in the sheet's columns: a list on mobile (tap to edit), a table on desktop. */
export function History(props: HistoryProps) {
  return useDesktop() ? <DesktopTable {...props} /> : <MobileList {...props} />
}
