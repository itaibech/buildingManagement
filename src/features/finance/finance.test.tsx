// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { todayISO } from '../../lib/dates'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import { LevyForm } from './ChargeForms'
import { ApplyTemplates } from './ExpenseForms'
import FinancePage from './FinancePage'
import { PaymentForm } from './PaymentForm'
import { paymentMeta } from './ledger'
import { receiptsOf, useDeleteExpense, useSaveExpense, useUndoSpecialCharge, type Template } from './api'

interface Call { table: string; op: string; args: unknown[] }
const db = vi.hoisted(() => ({
  admin: false, granted: [] as string[], calls: [] as Call[], tables: {} as Record<string, unknown[]>, rpc: {} as Record<string, unknown>,
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
  chain.single = () => Promise.resolve(ops.some((op) => db.fail.has(`${table}.${op}`)) ? { data: null, error: { message: 'boom' } } : { data: { id: 'new' }, error: null })
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
        remove: (paths: string[]) => { db.removed.push(paths); return Promise.resolve({ data: db.removeError ? null : paths.map((name) => ({ name })), error: db.removeError }) },
      }),
    },
  },
}))
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    isAdmin: db.admin, session: { user: { id: 'me' } },
    can: (need: string | string[]) => db.admin || (typeof need === 'string' ? [need] : need).some((k) => db.granted.includes(k)),
  }),
}))
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
const norm = (text: string): string => text.replace(/\s+/g, ' ').trim()
const APARTMENTS = [{ id: 'a1', number: 1 }, { id: 'a2', number: 2 }, { id: 'a3', number: 3 }]
const RESIDENTS = [{ id: 'r1', apartment_id: 'a1', full_name: 'דנה' }, { id: 'r2', apartment_id: 'a2', full_name: 'יוסי' }]
const inserts = (table: string) => db.calls.filter((c) => c.table === table && c.op === 'insert').map((c) => c.args[0])

beforeEach(() => {
  db.admin = false
  db.granted = ['home', 'finance_own', 'finance_reports', 'ev_own']
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
    expect(aptCalls.map((c) => [c.op, ...c.args])).toEqual([['select', 'id, number'], ['eq', 'id', 'a1']])
  })

  it('shows the balance sentence and upcoming charges', async () => {
    db.tables.apartment_balances = [{ apartment_id: 'a1', balance: 0, scheduled_charges: 500 }]
    wrap(<FinancePage />)
    expect(await screen.findByText(he.home.allPaid)).toBeInTheDocument()
    expect(screen.getByText(/חיובים עתידיים/)).toBeInTheDocument()
  })
})

describe('resident finance by permission', () => {
  const tablesRead = () => new Set(db.calls.map((c) => c.table))

  it('finance_own only: "הכספים שלי" without the building reports', async () => {
    db.granted = ['home', 'finance_own']
    db.tables.apartment_balances = [{ apartment_id: 'a1', balance: 120, scheduled_charges: 0 }]
    wrap(<FinancePage />)
    expect(await screen.findByRole('heading', { name: he.finance.myMoney })).toBeInTheDocument()
    expect(screen.getByText(he.finance.myLedger)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: he.finance.buildingReports })).toBeNull()
    expect(screen.queryByText(he.finance.cash)).toBeNull()
  })

  it('finance_reports only: building aggregates, no own money, no apartment rows or names', async () => {
    db.granted = ['home', 'finance_reports']
    db.rpc.collection_summary = [{ apartments_total: 6, apartments_paid_up: 4, amount_due_total: 1200 }]
    db.rpc.building_expense_report = [
      { category_id: 'c1', category: 'ניקיון', sort_order: 1, month: `${year}-02-01`, total: 300 },
      { category_id: 'c1', category: 'ניקיון', sort_order: 1, month: `${year}-03-01`, total: 200 },
    ]
    db.rpc.budget_for_year = [{ category_id: 'c1', category: 'ניקיון', sort_order: 1, amount: 1000, source: 'default' }]
    db.rpc.budget_summary = [{ expected_income: 12000, actual_income: 9000, actual_expenses: 500, projected_expenses: 0, expected_balance: 11500 }]
    db.tables.building_cash = [{ balance: 5000 }]
    wrap(<FinancePage />)
    expect(await screen.findByRole('heading', { name: he.finance.buildingReports })).toBeInTheDocument()
    expect(await screen.findByText(he.home.collected(4, 6))).toBeInTheDocument()
    expect(await screen.findByText('ניקיון')).toBeInTheDocument()
    // Residents never see the building cash (admins only, 0023), nor the income received; they do see the yearly summary.
    expect(screen.queryByText(he.finance.cash)).toBeNull()
    expect(await screen.findByText(he.finance.budget.expectedBalance)).toBeInTheDocument()
    expect(screen.queryByText(he.finance.budget.actualIncome)).toBeNull()
    expect(screen.getByRole('heading', { name: he.finance.byMonth.title })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: he.finance.myMoney })).toBeNull()
    expect(screen.queryByText(he.home.myBalance)).toBeNull()
    expect(screen.queryAllByLabelText(/^דירה \d+$/)).toHaveLength(0)
    const read = tablesRead()
    for (const t of ['expenses', 'apartment_balances', 'apartment_ledger', 'payments', 'charges', 'residents']) expect(read.has(t)).toBe(false)
  })
})

describe('admin balances', () => {
  it('lists by apartment number, sorts by amount on request (remembered), and marks debtors with the debt tone', async () => {
    localStorage.clear()
    db.admin = true
    db.tables.apartment_balances = [
      { apartment_id: 'a1', balance: -100, scheduled_charges: 0 },
      { apartment_id: 'a2', balance: 50, scheduled_charges: 0 },
      { apartment_id: 'a3', balance: 900, scheduled_charges: 0 },
    ]
    const { unmount } = wrap(<FinancePage />)
    const labels = async () => (await screen.findAllByRole('button', { name: /פתיחת הכרטסת/ })).map((r) => r.getAttribute('aria-label'))
    expect(await labels()).toEqual([he.finance.openLedger(1), he.finance.openLedger(2), he.finance.openLedger(3)])
    fireEvent.click(screen.getByRole('radio', { name: he.finance.sorts.amount }))
    expect(await labels()).toEqual([he.finance.openLedger(3), he.finance.openLedger(2), he.finance.openLedger(1)])
    const rows = await screen.findAllByRole('button', { name: /פתיחת הכרטסת/ })
    expect(within(rows[0]!).getByText(/900/)).toHaveAttribute('data-tone', 'debt')
    expect(within(rows[2]!).getByText(/100/)).toHaveAttribute('data-tone', 'paid')
    unmount()
    wrap(<FinancePage />)
    expect(await labels()).toEqual([he.finance.openLedger(3), he.finance.openLedger(2), he.finance.openLedger(1)])
    localStorage.clear()
  })
})

describe('admin charges', () => {
  it('deleting a special charge confirms with its linked payment and expense, then undoes them together', async () => {
    db.admin = true
    db.tables.charges = [{ id: 'x1', apartment_id: 'a2', month: `${year}-01-01`, amount: 2006, kind: 'extra', label: 'תיקון נזק', ev_reading_id: null, special_id: 'sp1' }]
    db.tables.payments = [{ amount: 2006 }]
    db.tables.expenses = [{ amount: 2006, expense_categories: { name: 'שונות' } }]
    wrap(<FinancePage />)
    fireEvent.click(await screen.findByRole('tab', { name: he.finance.tabs.charges }))
    expect(await screen.findByText(he.finance.special.chip('תיקון נזק'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.finance.deleteCharge }))
    const S = he.finance.special
    const amt = formatILS(2006)
    const dialog = await screen.findByRole('dialog', { name: he.finance.deleteChargeConfirm(amt) })
    expect(await within(dialog).findByText(norm(S.undoBody([S.partCharge(amt), S.partPayment(amt), S.partExpense(amt, 'שונות')])))).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: S.undo }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(he.finance.chargeDeleted))
    expect(db.calls.some((c) => c.table === 'charges' && c.op === 'delete')).toBe(false)
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

  it('undoing a special charge removes its expense\'s receipt file', async () => {
    db.rpc.undo_special_charge = { charges: 1, payments: 0, expenses: 1, receipts: ['e1/r.pdf'] }
    const { result } = renderHook(() => useUndoSpecialCharge(), { wrapper: hookWrap })
    await act(() => result.current.mutateAsync('sp1'))
    expect(db.removed).toEqual([['e1/r.pdf']])
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('a receipt that stays behind after a special undo is reported; no receipt, no storage call', async () => {
    db.rpc.undo_special_charge = { receipts: ['e1/r.pdf'] }
    db.removeError = { message: 'nope' }
    const { result } = renderHook(() => useUndoSpecialCharge(), { wrapper: hookWrap })
    await act(() => result.current.mutateAsync('sp1'))
    expect(toast.error).toHaveBeenCalledWith(he.finance.receiptRemoveFailed)
    db.removed = []
    db.rpc.undo_special_charge = { receipts: [] }
    await act(() => result.current.mutateAsync('sp2'))
    expect(db.removed).toEqual([])
    expect(receiptsOf({ receipts: ['a', 3, null] })).toEqual(['a'])
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

describe('paymentMeta', () => {
  it('shows an auto standing-order payment\'s method once, not again as its note', () => {
    const meta = paymentMeta({ paid_on: '2026-10-01', method: 'standing_order', note: he.finance.methods.standing_order })
    expect(meta.split(' · ')).toEqual(['01/10/2026', he.finance.methods.standing_order])
  })
  it('keeps a note that adds something', () => {
    expect(paymentMeta({ paid_on: '2026-10-01', method: 'cash', note: 'שולם לגזבר' })).toBe(`01/10/2026 · ${he.finance.methods.cash} · שולם לגזבר`)
  })
})
