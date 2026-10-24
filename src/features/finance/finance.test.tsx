// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
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
import { useDeleteExpense, useSaveExpense, type Template } from './api'

interface Call { table: string; op: string; args: unknown[] }
const db = vi.hoisted(() => ({
  admin: false, calls: [] as Call[], tables: {} as Record<string, unknown[]>, rpc: {} as Record<string, unknown>,
  /** `table.op` keys whose statement resolves with an error. */
  fail: new Set<string>(), removed: [] as string[][], removeError: null as { message: string } | null,
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

/** Chainable PostgREST stand-in: records every call, resolves to the table's rows. */
function builder(table: string) {
  const ops: string[] = []
  const result = () => (ops.some((op) => db.fail.has(`${table}.${op}`))
    ? { data: null, error: { message: 'boom' } }
    : { data: db.tables[table] ?? [], error: null })
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'lt', 'gte', 'order', 'in', 'insert', 'upsert', 'update', 'delete', 'limit']) {
    chain[op] = (...args: unknown[]) => { db.calls.push({ table, op, args }); ops.push(op); return chain }
  }
  chain.single = () => Promise.resolve({ data: { id: 'new' }, error: null })
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve)
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: (fn: string) => Promise.resolve({ data: db.rpc[fn] ?? null, error: null }),
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ error: null }),
        remove: (paths: string[]) => { db.removed.push(paths); return Promise.resolve({ error: db.removeError }) },
      }),
    },
  },
}))
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: db.admin, session: { user: { id: 'me' } } }) }))
vi.mock('../../ui/notify', () => ({ notifySuccess: toast.success, notifyError: toast.error }))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: toast.success, notifyError: toast.error }))

const wrap = (node: ReactNode, at = '/') =>
  render(
    <MantineProvider theme={theme}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[at]}>{node}</MemoryRouter>
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
  db.fail = new Set()
  db.removed = []
  db.removeError = null
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
    await waitFor(() => expect(db.calls.some((c) => c.table === 'apartment_ledger' && c.op === 'eq')).toBe(true))
    // The header shows the resident's own plate; the page itself shows none (and never another apartment's).
    expect(screen.queryAllByLabelText(/^דירה \d+$/)).toHaveLength(0)
    expect(screen.queryByText('יוסי')).toBeNull()
    const ledgerFilter = db.calls.find((c) => c.table === 'apartment_ledger' && c.op === 'eq')
    expect(ledgerFilter?.args).toEqual(['apartment_id', 'a1'])
    // Only its own apartment row is fetched (id + number), never the whole list.
    const aptCalls = db.calls.filter((c) => c.table === 'apartments')
    expect(aptCalls.map((c) => [c.op, ...c.args])).toEqual([['select', 'id, number, payment_method'], ['eq', 'id', 'a1']])
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

  it('applies the templates idempotently and reports added vs existing', async () => {
    const templates: Template[] = [
      { id: 't1', category_id: 'c1', category: 'ניקיון', amount: 600, vendor: 'ספק', label: 'ניקיון חודשי' },
      { id: 't2', category_id: 'c2', category: 'בזק', amount: 120, vendor: '', label: 'אינטרנט' },
    ]
    db.tables.expenses = [{ id: 'new-1' }] // the DB inserted one row and skipped the duplicate
    wrap(<ApplyTemplates month="2026-10-01" templates={templates} applied={new Set(['t2'])} onDone={vi.fn()} />)
    expect(screen.getByText(he.finance.alreadyApplied)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.finance.applyConfirm(1) }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(he.finance.templatesApplied(1, 1)))
    const upsert = db.calls.find((c) => c.table === 'expenses' && c.op === 'upsert')
    expect(upsert?.args[1]).toEqual({ onConflict: 'template_id,spent_on', ignoreDuplicates: true })
    expect(upsert?.args[0]).toEqual([
      { category_id: 'c1', amount: 600, vendor: 'ספק', note: 'ניקיון חודשי', spent_on: '2026-10-01', template_id: 't1' },
      { category_id: 'c2', amount: 120, vendor: '', note: 'אינטרנט', spent_on: '2026-10-01', template_id: 't2' },
    ])
  })

  it('disables applying when every template is already posted this month', () => {
    const templates: Template[] = [{ id: 't1', category_id: 'c1', category: 'ניקיון', amount: 600, vendor: '', label: 'ניקיון' }]
    wrap(<ApplyTemplates month="2026-10-01" templates={templates} applied={new Set(['t1'])} onDone={vi.fn()} />)
    expect(screen.getByRole('button', { name: he.finance.applyConfirm(0) })).toBeDisabled()
    expect(screen.getByText(he.finance.allApplied)).toBeInTheDocument()
  })

  it('keeps the levy submit disabled until the apartments are loaded', () => {
    db.tables.apartments = []
    wrap(<LevyForm onDone={vi.fn()} />)
    expect(screen.getByRole('button', { name: he.finance.addCharge })).toBeDisabled()
  })
})

describe('receipt cleanup', () => {
  const hookWrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  )

  it('tells the admin when the receipt file could not be removed (the row is already gone)', async () => {
    db.removeError = { message: 'storage down' }
    const { result } = renderHook(() => useDeleteExpense(), { wrapper: hookWrap })
    await act(() => result.current.mutateAsync({ id: 'e1', receipt_path: 'e1/r.pdf' }))
    expect(db.calls.some((c) => c.table === 'expenses' && c.op === 'delete')).toBe(true)
    expect(toast.error).toHaveBeenCalledWith(he.finance.receiptRemoveFailed)
  })

  it('removes the uploaded receipt when linking it to the expense fails', async () => {
    db.fail.add('expenses.update')
    const file = new File(['%PDF'], 'r.pdf', { type: 'application/pdf' })
    const { result } = renderHook(() => useSaveExpense(), { wrapper: hookWrap })
    const values = { category_id: 'c1', spent_on: '2026-10-01', amount: 5, vendor: '', note: '' }
    const out = await act(() => result.current.mutateAsync({ values, file }))
    expect(out.receiptFailed).toBe(true)
    expect(db.removed).toHaveLength(1)
    expect(db.removed[0]?.[0]).toMatch(/^new\/[0-9a-f-]+\.pdf$/)
  })
})

describe('finance UX', () => {
  it('resident finance shows how to pay with the committee details', async () => {
    db.tables.apartment_balances = [{ apartment_id: 'a1', number: 1, names: ['דנה'], balance: 330, scheduled: 0, fee: 330, fee_mode: 'building' }]
    db.tables.buildings = [{ id: 'b1', name: 'בניין', address: null, payment_instructions: 'ביט לגזבר', committee_contact: '050-0000009' }]
    wrap(<FinancePage />)
    expect(await screen.findByRole('heading', { name: he.pay.title })).toBeInTheDocument()
    expect(screen.getByText('ביט לגזבר')).toBeInTheDocument()
  })

  it('admin charges: one "new charge" action asks levy or single charge, and EV lives at /ev', async () => {
    db.admin = true
    wrap(<FinancePage />, '/?tab=charges')
    expect(screen.getByRole('link', { name: he.nav.ev })).toHaveAttribute('href', '/ev')
    expect(screen.queryByRole('tab', { name: 'טעינת רכב' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: he.finance.newLevy })).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: he.finance.newChargeChooser })[0] as HTMLElement)
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(he.finance.chooseLevy) }))
    expect(await screen.findByRole('dialog', { name: he.finance.newLevy })).toBeInTheDocument()
  })
})
