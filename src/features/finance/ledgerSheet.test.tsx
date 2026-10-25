// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatILS, formatKwh } from '../../lib/format'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import type { ApartmentBalance } from './api'
import { ApartmentLedger } from './ApartmentLedger'

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, rpcCalls: [] as { fn: string; args: unknown }[] }))

function builder(table: string) {
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'lt', 'gte', 'order', 'limit']) chain[op] = () => chain
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: db.tables[table] ?? [], error: null }).then(resolve)
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => { db.rpcCalls.push({ fn, args }); return Promise.resolve({ data: {}, error: null }) },
  },
}))

const wrap = (node: ReactNode) =>
  render(
    <MantineProvider theme={theme}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>
    </MantineProvider>,
  )

const norm = (text: string): string => text.replace(/\s+/g, ' ').trim()
const S_CHIP = he.finance.special.chip('תיקון נזק')
const apt = (balance: number): ApartmentBalance =>
  ({ apartmentId: 'a19', number: 19, names: ['דייר לדוגמה'], balance, scheduled: 0, fee: 0, feeMode: 'exempt', isCommittee: false, standingOrder: false })
const ev = (month: string, id: string) =>
  ({ id, month, amount: 843.4, kind: 'extra', label: 'טעינת רכב חשמלי', note: '', settlement_id: null, special_id: null, ev_reading_id: `r-${id}`, ev_readings: { kwh: 1370.25 } })

// The screenshot's case: exempt from the fee, the whole debt is EV charging (3 × ₪843.40 = ₪2,530.20), the oldest from 2025.
const thisYear = new Date().getFullYear()
beforeEach(() => {
  db.rpcCalls = []
  db.tables = {
    apartment_ledger: [
      { apartment_id: 'a19', month: `${thisYear - 1}-11-01`, charged: 843.4, paid: 0, adjusted: 0 },
      { apartment_id: 'a19', month: `${thisYear - 1}-12-01`, charged: 843.4, paid: 0, adjusted: 0 },
      { apartment_id: 'a19', month: `${thisYear}-01-01`, charged: 843.4, paid: 0, adjusted: 0 },
    ],
    charges: [ev(`${thisYear - 1}-11-01`, 'c1'), ev(`${thisYear - 1}-12-01`, 'c2'), ev(`${thisYear}-01-01`, 'c3')],
    buildings: [],
  }
})

describe('apartment ledger sheet', () => {
  it('shows the balance once, with the state and what the debt is made of', async () => {
    wrap(<ApartmentLedger apartment={apt(2530.2)} />)
    expect(screen.getByText(he.home.owed)).toBeInTheDocument()
    expect(screen.queryByText(norm(he.home.balanceDue(formatILS(2530.2))))).toBeNull()
    expect(screen.getByText(he.fees.exemptBadge)).toBeInTheDocument()
    const line = await screen.findByText(new RegExp(he.finance.breakdownLabel))
    expect(line).toHaveTextContent(norm(`${he.finance.breakdown.fee} ${formatILS(0)}`))
    expect(line).toHaveTextContent(norm(`${he.finance.breakdown.ev} ${formatILS(2530.2)}`))
  })

  it('an imported EV charge (no meter reading, the EV label) still counts as EV charging', async () => {
    db.tables.charges = [ev(`${thisYear - 1}-11-01`, 'c1'), ev(`${thisYear - 1}-12-01`, 'c2'),
      { ...ev(`${thisYear}-01-01`, 'c3'), ev_reading_id: null, ev_readings: null }]
    wrap(<ApartmentLedger apartment={apt(2530.2)} />)
    expect(await screen.findByText(new RegExp(he.finance.breakdownLabel))).toHaveTextContent(norm(`${he.finance.breakdown.ev} ${formatILS(2530.2)}`))
  })

  it('opens the year of the oldest debt, with the chip, a collapsed quiet stretch, kWh and the open amount', async () => {
    wrap(<ApartmentLedger apartment={apt(2530.2)} />)
    expect(await screen.findByRole('button', { name: he.finance.openSince(thisYear - 1) })).toBeInTheDocument()
    expect(screen.getByText(String(thisYear - 1))).toBeInTheDocument()
    expect(screen.getByText(he.finance.noMovement('ינואר', 'אוקטובר'))).toBeInTheDocument()
    expect(screen.getAllByText(norm(he.finance.kwh(formatKwh(1370.25))))).toHaveLength(2)
    expect(screen.getAllByText(norm(he.finance.openAmount(formatILS(843.4))))).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: he.finance.nextYear }))
    expect(screen.getByText(String(thisYear))).toBeInTheDocument()
  })

  it('tapping a month shows its charges', async () => {
    wrap(<ApartmentLedger apartment={apt(2530.2)} />)
    fireEvent.click(await screen.findByRole('button', { name: he.finance.monthDetails(`נובמבר ${thisYear - 1}`) }))
    const details = await screen.findByRole('dialog', { name: he.finance.monthDetails(`נובמבר ${thisYear - 1}`) })
    expect(within(details).getByText('טעינת רכב חשמלי')).toBeInTheDocument()
  })

  it('a month paid by credit from another month explains it: paid in the month, credit, left open', async () => {
    db.tables.apartment_ledger = [
      { apartment_id: 'a19', month: `${thisYear}-01-01`, charged: 330, paid: 720, adjusted: 0 },
      { apartment_id: 'a19', month: `${thisYear}-02-01`, charged: 330, paid: 0, adjusted: 0 },
      { apartment_id: 'a19', month: `${thisYear}-03-01`, charged: 330, paid: 0, adjusted: 0 },
    ]
    db.tables.charges = []
    wrap(<ApartmentLedger apartment={apt(270)} />)
    expect(await screen.findByText(he.finance.alloc.legend)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: he.finance.monthDetails(`פברואר ${thisYear}`) }))
    const details = within(await screen.findByTestId('allocation'))
    expect(details.getByText(he.finance.alloc.fromCredit).parentElement?.parentElement?.textContent).toContain('60.00')
    expect(details.getByText(he.finance.alloc.open).parentElement?.parentElement?.textContent).toContain('270.00')
  })

  it('admins settle from the sheet; no settle button without a debt', async () => {
    const { unmount } = wrap(<ApartmentLedger apartment={apt(2530.2)} />)
    expect(screen.getByRole('button', { name: he.finance.recordPayment })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.finance.settle.action }))
    expect(await screen.findByRole('radio', { name: he.finance.settle.modes.write_off })).toBeInTheDocument()
    unmount()
    wrap(<ApartmentLedger apartment={apt(0)} />)
    expect(screen.queryByRole('button', { name: he.finance.settle.action })).toBeNull()
  })

  it('a write-off is marked on its month, with the reason and an undo', async () => {
    db.tables.apartment_ledger = [{ apartment_id: 'a19', month: `${thisYear}-01-01`, charged: 0, paid: 0, adjusted: -843.4 }]
    db.tables.charges = [ev(`${thisYear}-01-01`, 'c3'),
      { id: 'w1', month: `${thisYear}-01-01`, amount: -843.4, kind: 'adjustment', label: 'מחיקת חוב', note: 'חוב ישן', settlement_id: 's1', special_id: null, ev_reading_id: null, ev_readings: null }]
    wrap(<ApartmentLedger apartment={apt(0)} />)
    expect(await screen.findByText(norm(he.finance.writtenOff(formatILS(843.4))))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.finance.monthDetails(`ינואר ${thisYear}`) }))
    const details = await screen.findByRole('dialog', { name: he.finance.monthDetails(`ינואר ${thisYear}`) })
    expect(within(details).getByText(he.finance.writeOffReason('חוב ישן'))).toBeInTheDocument()
    // jsdom never finishes the popover's fade-in (display stays none), so the role query includes hidden nodes.
    fireEvent.click(within(details).getByRole('button', { name: he.finance.undoWriteOff, hidden: true }))
    // A confirm names every month of that settlement and its total; nothing is undone before it.
    const confirm = await screen.findByRole('dialog', { name: he.finance.undoWriteOffConfirm })
    expect(within(confirm).getByText(norm(he.finance.undoWriteOffBody(`ינואר ${thisYear}`, formatILS(843.4))))).toBeInTheDocument()
    expect(db.rpcCalls).toEqual([])
    fireEvent.click(within(confirm).getByRole('button', { name: he.finance.undoWriteOff }))
    await vi.waitFor(() => expect(db.rpcCalls).toEqual([{ fn: 'undo_settlement', args: { p_settlement_id: 's1' } }]))
  })

  it('a special charge shows its ✦ chip, its own debt line, the linked payment and an undo', async () => {
    const special = { id: 'x1', month: `${thisYear}-01-01`, amount: 2006, kind: 'extra', label: 'תיקון נזק', note: 'נזק בלובי', settlement_id: null, special_id: 'sp1', ev_reading_id: null, ev_readings: null }
    db.tables.apartment_ledger = [{ apartment_id: 'a19', month: `${thisYear}-01-01`, charged: 2006, paid: 1000, adjusted: 0 }]
    db.tables.charges = [special]
    db.tables.payments = [{ id: 'p1', special_id: 'sp1', for_month: `${thisYear}-01-01`, paid_on: `${thisYear}-01-01`, amount: 1000 }]
    wrap(<ApartmentLedger apartment={apt(1006)} />)
    expect(await screen.findByText(S_CHIP)).toBeInTheDocument()
    expect(await screen.findByText(new RegExp(he.finance.breakdownLabel))).toHaveTextContent(norm(`${he.finance.breakdown.special} ${formatILS(1006)}`))
    fireEvent.click(screen.getByRole('button', { name: he.finance.monthDetails(`ינואר ${thisYear}`) }))
    const details = await screen.findByRole('dialog', { name: he.finance.monthDetails(`ינואר ${thisYear}`) })
    expect(within(details).getByText(norm(he.finance.special.paidWith(formatILS(1000))))).toBeInTheDocument()
    fireEvent.click(within(details).getByRole('button', { name: he.finance.special.undo, hidden: true }))
    // The confirm names the linked payment that goes too.
    const confirm = await screen.findByRole('dialog', { name: he.finance.deleteChargeConfirm(formatILS(2006)) })
    const S = he.finance.special
    expect(await within(confirm).findByText(norm(S.undoBody([S.partCharge(formatILS(2006)), S.partPayment(formatILS(1000))])))).toBeInTheDocument()
    expect(db.rpcCalls).toEqual([])
    fireEvent.click(within(confirm).getByRole('button', { name: S.undo }))
    await vi.waitFor(() => expect(db.rpcCalls).toEqual([{ fn: 'undo_special_charge', args: { p_special_id: 'sp1' } }]))
  })

  it('admins add a special charge from the sheet', async () => {
    wrap(<ApartmentLedger apartment={apt(0)} />)
    fireEvent.click(screen.getByRole('button', { name: he.finance.special.action }))
    expect(await screen.findByRole('button', { name: he.finance.special.save })).toBeInTheDocument()
  })
})
