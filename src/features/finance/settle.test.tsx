// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatILS, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import type { LedgerRow } from './ledger'
import { SettleDebtForm } from './SettleDebtForm'

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, rpcCalls: [] as { fn: string; args: Record<string, unknown> }[] }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))

function builder(table: string) {
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'lt', 'gte', 'order', 'limit']) chain[op] = () => chain
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: db.tables[table] ?? [], error: null }).then(resolve)
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: Record<string, unknown>) => {
      db.rpcCalls.push({ fn, args })
      return Promise.resolve({ data: { months: 1, total: 1 }, error: null })
    },
  },
}))
vi.mock('../../ui/notify', () => ({ notifySuccess: toast.success, notifyError: toast.error, notifyInfo: toast.info }))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: toast.success, notifyError: toast.error, notifyInfo: toast.info }))

const wrap = (node: ReactNode) =>
  render(
    <MantineProvider theme={theme}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>
    </MantineProvider>,
  )

const row = (month: string, charged: number, paid: number): LedgerRow => ({ apartment_id: 'a1', month, charged, paid, adjusted: 0 })
// Jan 2024 open 300, Feb partial (150 open), Mar overpaid (credit 80), May 2025 open 100: balance 470.
const ROWS = [row('2024-01-01', 300, 0), row('2024-02-01', 200, 50), row('2024-03-01', 100, 180), row('2025-05-01', 100, 0)]
const confirm = () => screen.getByRole('button', { name: he.finance.settle.action })
// Testing Library collapses the NBSP inside formatILS output in the DOM text, not in the expected string.
const norm = (text: string): string => text.replace(/\s+/g, ' ').trim()
const lastCall = () => db.rpcCalls[db.rpcCalls.length - 1]

beforeEach(() => {
  db.tables = { buildings: [{ id: 'b1', name: 'x', address: null, payment_instructions: null, committee_contact: null, opening_cash_date: '2025-01-01' }] }
  db.rpcCalls = []
  toast.success.mockClear()
})

describe('SettleDebtForm', () => {
  it('lists every open month oldest first, all checked, with the summary', () => {
    wrap(<SettleDebtForm apartmentId="a1" rows={ROWS} onDone={() => undefined} />)
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.map((b) => b.getAttribute('aria-label'))).toEqual([monthLabel('2024-01'), monthLabel('2024-02'), monthLabel('2025-05')])
    boxes.forEach((b) => expect(b).toBeChecked())
    expect(screen.getByText(norm(he.finance.settle.summary(3, formatILS(470), formatILS(0))))).toBeInTheDocument()
    // Each row: what was charged, what was paid, and the open amount (May: only the 20 the credit leaves).
    const may = boxes[2]?.closest('label') as HTMLElement
    expect(within(may).getByText(norm(he.finance.settle.row(formatILS(100), formatILS(0))))).toBeInTheDocument()
    expect(within(may).getByText(norm(formatILS(20)))).toBeInTheDocument()
  })

  it('past-year months default to today, with the one-line explanation', async () => {
    const onDone = vi.fn()
    wrap(<SettleDebtForm apartmentId="a1" rows={ROWS} onDone={onDone} />)
    expect(screen.getByRole('switch', { name: new RegExp(he.finance.settle.datedToday) })).toBeChecked()
    expect(screen.getByText(he.finance.settle.pastYearHint)).toBeInTheDocument()
    fireEvent.click(confirm())
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(lastCall()).toEqual({ fn: 'settle_debt', args: {
      p_apartment_id: 'a1', p_months: ['2024-01-01', '2024-02-01', '2025-05-01'], p_mode: 'pay', p_method: 'transfer', p_date_mode: 'today', p_note: '',
    } })
    expect(toast.success).toHaveBeenCalledWith(he.finance.settle.done)
  })

  it('current-year months keep the debt-month date by default', async () => {
    const y = new Date().getFullYear()
    wrap(<SettleDebtForm apartmentId="a1" rows={[row(`${y}-01-01`, 300, 0)]} onDone={() => undefined} />)
    expect(screen.getByRole('switch', { name: new RegExp(he.finance.settle.datedToday) })).not.toBeChecked()
    expect(screen.queryByText(he.finance.settle.pastYearHint)).toBeNull()
    fireEvent.click(confirm())
    await waitFor(() => expect(lastCall()?.args.p_date_mode).toBe('debt_month'))
  })

  it('turning "today" off for old months warns about the cash opening date, and the choice sticks', async () => {
    wrap(<SettleDebtForm apartmentId="a1" rows={ROWS} onDone={() => undefined} />)
    const sw = screen.getByRole('switch', { name: new RegExp(he.finance.settle.datedToday) })
    expect(screen.queryByText(he.finance.settle.cashWarning('01/01/2025'))).toBeNull()
    fireEvent.click(sw)
    expect(await screen.findByText(he.finance.settle.cashWarning('01/01/2025'))).toBeInTheDocument()
    expect(screen.queryByText(he.finance.settle.pastYearHint)).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: monthLabel('2025-05') }))
    expect(sw).not.toBeChecked()
    fireEvent.click(confirm())
    await waitFor(() => expect(lastCall()?.args.p_date_mode).toBe('debt_month'))
  })

  it('quick selectors and unchecking update the summary', () => {
    wrap(<SettleDebtForm apartmentId="a1" rows={ROWS} onDone={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: he.finance.settle.before(2025) }))
    expect(screen.getByText(norm(he.finance.settle.summary(2, formatILS(450), formatILS(20))))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: monthLabel('2024-02') }))
    expect(screen.getByText(norm(he.finance.settle.summary(1, formatILS(300), formatILS(170))))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.finance.settle.all }))
    expect(screen.getByText(norm(he.finance.settle.summary(3, formatILS(470), formatILS(0))))).toBeInTheDocument()
  })

  it('nothing selected: the confirm is disabled', () => {
    wrap(<SettleDebtForm apartmentId="a1" rows={ROWS} onDone={() => undefined} />)
    screen.getAllByRole('checkbox').forEach((b) => fireEvent.click(b))
    expect(screen.getByText(he.finance.settle.noneSelected)).toBeInTheDocument()
    expect(confirm()).toBeDisabled()
  })

  it('a write-off needs a reason, then sends it', async () => {
    wrap(<SettleDebtForm apartmentId="a1" rows={ROWS} onDone={() => undefined} />)
    fireEvent.click(screen.getByRole('radio', { name: he.finance.settle.modes.write_off }))
    expect(screen.getByText(he.finance.settle.writeOffHint)).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: new RegExp(he.finance.settle.datedToday) })).not.toBeInTheDocument()
    fireEvent.click(confirm())
    expect(await screen.findByText(he.finance.settle.reasonRequired)).toBeInTheDocument()
    expect(db.rpcCalls).toHaveLength(0)
    fireEvent.change(screen.getByLabelText(he.finance.settle.reason, { exact: false }), { target: { value: 'חוב ישן' } })
    fireEvent.click(confirm())
    await waitFor(() => expect(lastCall()?.args).toMatchObject({ p_mode: 'write_off', p_note: 'חוב ישן' }))
  })
})
