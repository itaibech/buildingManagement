import { Divider, Stack, Table, Text } from '@mantine/core'
import { Fragment } from 'react'
import { todayISO } from '../../lib/dates'
import { formatILS, HEBREW_MONTHS } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState } from '../../ui'
import { useDesktop } from './hooks'
import type { LedgerCell } from './ledger'

export interface LedgerGridProps {
  months: string[]
  cells: LedgerCell[]
}

const monthName = (month: string): string => HEBREW_MONTHS[Number(month.slice(5, 7)) - 1] ?? month
const amount = (n: number): string => (n === 0 ? '—' : formatILS(n))

/** Months that have happened: a future year shows nothing, the current year stops at this month. */
function pastMonths(months: string[], cells: LedgerCell[]) {
  const now = todayISO().slice(0, 7)
  return months.map((m, i) => ({ month: m, cell: cells[i] ?? { charged: 0, paid: 0 } })).filter((x) => x.month.slice(0, 7) <= now)
}

function totals(cells: LedgerCell[]): LedgerCell {
  return cells.reduce((t, c) => ({ charged: t.charged + c.charged, paid: t.paid + c.paid }), { charged: 0, paid: 0 })
}

function MobileList({ rows }: { rows: { month: string; cell: LedgerCell }[] }) {
  return (
    <Stack gap={0}>
      {rows.map(({ month, cell }, i) => (
        <Fragment key={month}>
          {i > 0 && <Divider color="stone.1" />}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 52, padding: '6px 0' }}>
            <Text fw={600} style={{ flex: 1 }}>{monthName(month)}</Text>
            <Stack gap={0} align="flex-end" className="bm-num">
              <Text size="sm">{he.finance.chargedAmount(amount(cell.charged))}</Text>
              <Text size="sm" c={cell.paid > 0 ? 'paid.7' : 'dimmed'}>{he.finance.paidAmount(amount(cell.paid))}</Text>
            </Stack>
          </div>
        </Fragment>
      ))}
    </Stack>
  )
}

function DesktopTable({ rows }: { rows: { month: string; cell: LedgerCell }[] }) {
  const sum = totals(rows.map((r) => r.cell))
  return (
    <Table.ScrollContainer minWidth={320}>
      <Table className="bm-num" verticalSpacing="sm" striped="even">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{he.finance.month}</Table.Th>
            <Table.Th ta="end">{he.finance.charged}</Table.Th>
            <Table.Th ta="end">{he.finance.paid}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map(({ month, cell }) => (
            <Table.Tr key={month}>
              <Table.Td fw={600}>{monthName(month)}</Table.Td>
              <Table.Td ta="end">{amount(cell.charged)}</Table.Td>
              <Table.Td ta="end" c={cell.paid > 0 ? 'paid.7' : undefined}>{amount(cell.paid)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
        <Table.Tfoot>
          <Table.Tr>
            <Table.Th>{he.finance.yearTotal}</Table.Th>
            <Table.Th ta="end">{formatILS(sum.charged)}</Table.Th>
            <Table.Th ta="end">{formatILS(sum.paid)}</Table.Th>
          </Table.Tr>
        </Table.Tfoot>
      </Table>
    </Table.ScrollContainer>
  )
}

/** One apartment's year: charged vs paid per month. A list on mobile, a table on desktop. */
export function LedgerGrid({ months, cells }: LedgerGridProps) {
  const desktop = useDesktop()
  const rows = pastMonths(months, cells)
  if (rows.length === 0) return <EmptyState title={he.finance.noLedgerYear} />
  if (desktop) return <DesktopTable rows={rows} />
  const sum = totals(rows.map((r) => r.cell))
  return (
    <Stack gap="xs">
      <MobileList rows={rows} />
      <Divider />
      <Text size="sm" fw={600} className="bm-num">{he.finance.yearSummary(formatILS(sum.charged), formatILS(sum.paid))}</Text>
    </Stack>
  )
}
