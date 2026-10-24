import { Divider, Stack, Table, Text } from '@mantine/core'
import { Fragment, type CSSProperties } from 'react'
import { todayISO } from '../../lib/dates'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState } from '../../ui'
import type { ApartmentCharge, SpecialPayment } from './api'
import { useDesktop } from './hooks'
import { monthName, yearMonths, type LedgerRow } from './ledger'
import { MonthCell, type MonthView } from './LedgerMonth'
import { groupLedgerMonths, runningBalances, type PlanRow } from './settlement'

export interface LedgerGridProps {
  year: number
  /** Every ledger row of the apartment (earlier years feed the running balance). */
  rows: readonly LedgerRow[]
  charges: readonly ApartmentCharge[]
  /** Payments recorded with special charges (shown in the month's details). */
  specialPayments?: readonly SpecialPayment[]
  /** The open months (settlementPlan of everything). */
  open: readonly PlanRow[]
  /** Admins may undo a write-off from a month's details. */
  admin?: boolean
}

type Item = { type: 'month'; view: MonthView } | { type: 'empty'; from: string; to: string }

const amount = (n: number): string => (n === 0 ? '—' : formatILS(n))
const OPEN_ROW: CSSProperties = { background: 'var(--mantine-color-debt-0)' }

/** The year's months that have happened, as month views, with each quiet stretch folded into one item. */
function buildItems({ year, rows, charges, open, specialPayments = [] }: LedgerGridProps): { items: Item[]; views: MonthView[] } {
  const now = todayISO().slice(0, 7)
  const months = yearMonths(year).filter((m) => m.slice(0, 7) <= now)
  const byMonth = new Map(rows.filter((r) => months.includes(r.month)).map((r) => [r.month, r]))
  const balances = runningBalances(rows, months)
  const views = months.map((month, i): MonthView => {
    const r = byMonth.get(month)
    const adjusted = r?.adjusted ?? 0
    return {
      month, gross: Math.round(((r?.charged ?? 0) - adjusted) * 100) / 100, paid: r?.paid ?? 0, adjusted,
      open: open.find((p) => p.month === month)?.open ?? 0, balance: balances[i] ?? 0, charges: charges.filter((c) => c.month === month),
      specialPayments: specialPayments.filter((p) => p.month === month),
    }
  })
  const items = groupLedgerMonths(months, byMonth).map((g): Item =>
    g.type === 'empty' ? g : { type: 'month', view: views[months.indexOf(g.month)] as MonthView })
  return { items, views }
}

const quiet = (from: string, to: string): string => he.finance.noMovement(monthName(from), monthName(to))
const sumOf = (views: MonthView[], pick: (v: MonthView) => number): number => Math.round(views.reduce((t, v) => t + pick(v) * 100, 0)) / 100

function DesktopTable({ items, views, admin }: { items: Item[]; views: MonthView[]; admin: boolean }) {
  return (
    <Table.ScrollContainer minWidth={340}>
      <Table className="bm-num" verticalSpacing="sm" horizontalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{he.finance.month}</Table.Th>
            <Table.Th ta="end">{he.finance.charged}</Table.Th>
            <Table.Th ta="end">{he.finance.paid}</Table.Th>
            <Table.Th ta="end">{he.finance.runningBalance}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map((it) => it.type === 'empty' ? (
            <Table.Tr key={it.from}><Table.Td colSpan={4} c="dimmed" fz="sm">{quiet(it.from, it.to)}</Table.Td></Table.Tr>
          ) : (
            <Table.Tr key={it.view.month} style={it.view.open > 0 ? OPEN_ROW : undefined} aria-label={it.view.open > 0 ? he.finance.openMonth : undefined}>
              <Table.Td><MonthCell v={it.view} admin={admin} /></Table.Td>
              <Table.Td ta="end">{amount(it.view.gross)}</Table.Td>
              <Table.Td ta="end" c={it.view.paid > 0 ? 'paid.7' : undefined}>{amount(it.view.paid)}</Table.Td>
              <Table.Td ta="end" c={it.view.balance > 0 ? 'debt.6' : undefined}>{formatILS(it.view.balance)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
        <Table.Tfoot>
          <Table.Tr>
            <Table.Th>{he.finance.yearTotal}</Table.Th>
            <Table.Th ta="end">{formatILS(sumOf(views, (v) => v.gross))}</Table.Th>
            <Table.Th ta="end">{formatILS(sumOf(views, (v) => v.paid))}</Table.Th>
            <Table.Th ta="end">{formatILS(views[views.length - 1]?.balance ?? 0)}</Table.Th>
          </Table.Tr>
        </Table.Tfoot>
      </Table>
    </Table.ScrollContainer>
  )
}

const GRID: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 6.5rem 6.5rem', alignItems: 'center', columnGap: 8 }

/** Mobile: month | charge | paid, the open amount as a small line under the month. */
function MobileList({ items, admin }: { items: Item[]; admin: boolean }) {
  return (
    <Stack gap={0} className="bm-num">
      <div style={{ ...GRID, paddingBottom: 4 }}>
        <Text size="xs" c="dimmed">{he.finance.month}</Text>
        <Text size="xs" c="dimmed" ta="end">{he.finance.charged}</Text>
        <Text size="xs" c="dimmed" ta="end">{he.finance.paid}</Text>
      </div>
      {items.map((it) => (
        <Fragment key={it.type === 'empty' ? it.from : it.view.month}>
          <Divider color="stone.1" />
          {it.type === 'empty' ? <Text size="sm" c="dimmed" py="xs">{quiet(it.from, it.to)}</Text> : (
            <div style={{ ...GRID, minHeight: 52, padding: '4px 6px', margin: '0 -6px', borderRadius: 8, ...(it.view.open > 0 ? OPEN_ROW : {}) }}>
              <MonthCell v={it.view} admin={admin} />
              <Text size="sm" ta="end">{amount(it.view.gross)}</Text>
              <Text size="sm" ta="end" c={it.view.paid > 0 ? 'paid.7' : 'dimmed'}>{amount(it.view.paid)}</Text>
            </div>
          )}
        </Fragment>
      ))}
    </Stack>
  )
}

/** One apartment's year: charge, payment and running balance per month; open months highlighted. */
export function LedgerGrid(props: LedgerGridProps) {
  const desktop = useDesktop()
  const { items, views } = buildItems(props)
  if (views.length === 0) return <EmptyState title={he.finance.noLedgerYear} />
  if (desktop) return <DesktopTable items={items} views={views} admin={props.admin ?? false} />
  return (
    <Stack gap="xs">
      <MobileList items={items} admin={props.admin ?? false} />
      <Divider />
      <Text size="sm" fw={600} className="bm-num">{he.finance.yearSummary(formatILS(sumOf(views, (v) => v.gross)), formatILS(sumOf(views, (v) => v.paid)))}</Text>
    </Stack>
  )
}
