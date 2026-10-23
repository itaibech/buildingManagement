// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { todayISO } from '../../lib/dates'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import { LevyForm } from './ChargeForms'
import { ApplyTemplates } from './ExpenseForms'
import FinancePage from './FinancePage'
import { PaymentForm } from './PaymentForm'
import type { Template } from './api'

interface Call { table: string; op: string; args: unknown[] }
const db = vi.hoisted(() => ({ admin: false, calls: [] as Call[], tables: {} as Record<string, unknown[]>, rpc: {} as Record<string, unknown> }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

/** Chainable PostgREST stand-in: records every call, resolves to the table's rows. */
function builder(table: string) {
  const result = () => ({ data: db.tables[table] ?? [], error: null })
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'lt', 'gte', 'order', 'in', 'insert', 'upsert', 'update', 'delete']) {
    chain[op] = (...args: unknown[]) => { db.calls.push({ table, op, args }); return chain }
  }
  chain.single = () => Promise.resolve({ data: { id: 'new' }, error: null })
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve)
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: (fn: string) => Promise.resolve({ data: db.rpc[fn] ?? null, error: null }),
    storage: { from: () => ({ upload: () => Promise.resolve({ error: null }), remove: () => Promise.resolve({ error: null }) }) },
  },
}))
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: db.admin, session: { user: { id: 'me' } } }) }))
vi.mock('../../ui/notify', () => ({ notifySuccess: toast.success, notifyError: toast.error }))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: toast.success, notifyError: toast.error }))

const wrap = (node: ReactNode) =>
  render(
    <MantineProvider theme={theme}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>{node}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )

const year = todayISO().slice(0, 4)
const APARTMENTS = [{ id: 'a1', number: 1 }, { id: 'a2', number: 2 }, { id: 'a3', number: 3 }]
const RESIDENTS = [{ id: 'r1', apartment_id: 'a1', full_name: 'דנה' }, { id: 'r2', apartment_id: 'a2', full_name: 'יוסי' }]
const inserts = (table: string) => db.calls.filter((c) => c.table === table && c.op === 'insert').map((c) => c.args[0])

beforeEach(() => {
  db.admin = false
  db.calls = []
  db.rpc = { my_apartment_id: 'a1', collection_summary: [] }
  db.tables = { apartments: APARTMENTS, residents: RESIDENTS }
  toast.success.mockClear()
  toast.error.mockClear()
})

describe('resident finance page', () => {
  it('renders no other apartment plate, even if the server returned other rows', async () => {
    db.tables.apartment_ledger = [
      { apartment_id: 'a1', month: `${year}-01-01`, charged: 390, paid: 390 },
      { apartment_id: 'a2', month: `${year}-01-01`, charged: 390, paid: 0 },
    ]
    db.tables.apartment_balances = [{ apartment_id: 'a1', balance: 0, scheduled_charges: 0 }]
    wrap(<FinancePage />)
    expect(await screen.findByText(he.finance.myLedger)).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByLabelText(/^דירה \d+$/).length).toBeGreaterThan(0))
    const plates = screen.getAllByLabelText(/^דירה \d+$/).map((el) => el.getAttribute('aria-label'))
    expect(new Set(plates)).toEqual(new Set([he.apartment(1)]))
    expect(screen.queryByText('יוסי')).toBeNull()
    const ledgerFilter = db.calls.find((c) => c.table === 'apartment_ledger' && c.op === 'eq')
    expect(ledgerFilter?.args).toEqual(['apartment_id', 'a1'])
  })

  it('shows the balance sentence and upcoming charges', async () => {
    db.tables.apartment_balances = [{ apartment_id: 'a1', balance: 0, scheduled_charges: 500 }]
    wrap(<FinancePage />)
    expect(await screen.findByText(he.home.allPaid)).toBeInTheDocument()
    expect(screen.getByText(/חיובים עתידיים/)).toBeInTheDocument()
  })
})

describe('admin balances', () => {
  it('sorts by debt and marks debtors with the debt tone', async () => {
    db.admin = true
    db.tables.apartment_balances = [
      { apartment_id: 'a1', balance: -100, scheduled_charges: 0 },
      { apartment_id: 'a2', balance: 50, scheduled_charges: 0 },
      { apartment_id: 'a3', balance: 900, scheduled_charges: 0 },
    ]
    wrap(<FinancePage />)
    const rows = await screen.findAllByRole('button', { name: /פתיחת הכרטסת/ })
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([he.finance.openLedger(3), he.finance.openLedger(2), he.finance.openLedger(1)])
    expect(within(rows[0]!).getByText(/900/)).toHaveAttribute('data-tone', 'debt')
    expect(within(rows[2]!).getByText(/100/)).toHaveAttribute('data-tone', 'paid')
  })
})

describe('forms', () => {
  it('records a payment with an explicit date and method, then toasts', async () => {
    const onDone = vi.fn()
    wrap(<PaymentForm apartmentId="a2" onDone={onDone} />)
    fireEvent.change(screen.getByLabelText(new RegExp(he.finance.amount)), { target: { value: '390' } })
    fireEvent.click(screen.getByRole('button', { name: he.finance.recordPayment }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(he.finance.paymentRecorded))
    expect(inserts('payments')).toEqual([{ apartment_id: 'a2', paid_on: todayISO(), amount: 390, method: 'transfer', note: '' }])
    expect(onDone).toHaveBeenCalled()
  })

  it('levies every apartment with one charge row each', async () => {
    wrap(<LevyForm onDone={vi.fn()} />)
    await screen.findByText(he.finance.allApartments(3))
    fireEvent.change(screen.getByLabelText(new RegExp(he.finance.levyLabel)), { target: { value: 'שיפוץ' } })
    fireEvent.change(screen.getByLabelText(new RegExp(he.finance.amountPerApartment)), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: he.finance.addCharge }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(he.finance.chargeAdded))
    const rows = inserts('charges')[0] as { apartment_id: string; kind: string; amount: number; month: string }[]
    expect(rows.map((r) => r.apartment_id)).toEqual(['a1', 'a2', 'a3'])
    expect(rows.every((r) => r.kind === 'levy' && r.amount === 500 && r.month.endsWith('-01'))).toBe(true)
  })

  it('applies the templates as expenses dated the first of the month', async () => {
    const templates: Template[] = [{ id: 't1', category_id: 'c1', category: 'ניקיון', amount: 600, vendor: 'ספק', label: 'ניקיון חודשי' }]
    wrap(<ApplyTemplates month="2026-10-01" templates={templates} onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: he.finance.applyConfirm(1) }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(he.finance.templatesApplied(1)))
    expect(inserts('expenses')).toEqual([[{ category_id: 'c1', amount: 600, vendor: 'ספק', note: 'ניקיון חודשי', spent_on: '2026-10-01' }]])
  })
})
