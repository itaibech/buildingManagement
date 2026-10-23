import { ActionIcon, Divider, Group, Stack, Table, Text } from '@mantine/core'
import { IconPencil } from '@tabler/icons-react'
import { Fragment } from 'react'
import { formatILS, formatKwh, formatRate, HEBREW_MONTHS } from '../../lib/format'
import { he } from '../../lib/he'
import { DeleteButton, Row } from '../finance/fields'
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

function MobileList({ rows, onEdit, onDelete }: HistoryProps) {
  return (
    <Stack gap={0}>
      {rows.map((r, i) => (
        <Fragment key={r.id}>
          {i > 0 && <Divider color="stone.1" />}
          <Row title={monthName(r.month)} onClick={() => onEdit(r.id)} label={he.ev.editReading(monthName(r.month))}
            meta={<>{`${he.ev.reading} ${formatKwh(r.reading)} · ${he.ev.kwhValue(dash(r.kwh, formatKwh))} · ${dash(r.rate, formatRate)}`}<br />
              {`${he.ev.paid} ${formatILS(r.paid)} · `}<Text span c={diffColor(r.diff)} inherit>{`${he.ev.diff} ${signed(r.diff)}`}</Text></>}
            end={<Text fw={600} className="bm-num">{dash(r.amount, formatILS)}</Text>}
            trailing={<DeleteButton label={he.ev.deleteReading(monthName(r.month))} onClick={() => onDelete(r.id)} />} />
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
