// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { todayISO } from '../../lib/dates'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import { buildAnnualReport } from './annualReport'
import { AnnualReportDocument } from './AnnualReportDocument'
import AnnualReportPage from './AnnualReportPage'

const A = he.annual
const year = Number(todayISO().slice(0, 4))
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()
const db = vi.hoisted(() => ({ admin: false, tables: {} as Record<string, unknown[]>, rpc: {} as Record<string, unknown>, from: [] as string[] }))

function builder(table: string) {
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'lt', 'lte', 'gte', 'order', 'in', 'limit']) chain[op] = () => chain
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: db.tables[table] ?? [], error: null }).then(resolve)
  return chain
}
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (t: string) => { db.from.push(t); return builder(t) },
    rpc: (fn: string) => Promise.resolve({ data: db.rpc[fn] ?? null, error: null }),
  },
}))
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ isAdmin: db.admin, can: (need: string | string[]) => db.admin || [need].flat().includes('finance_reports') }),
}))

const wrap = (node: ReactNode) => render(
  <MantineProvider theme={theme}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>
  </MantineProvider>,
)
const printCopy = () => screen.getByTestId('annual-print')
const headings = (root: HTMLElement) => within(root).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)

beforeEach(() => {
  db.admin = false
  db.from = []
  localStorage.clear()
  db.tables = {
    buildings: [{ id: 'b1', name: 'הרצל 12', address: 'תל אביב', payment_instructions: null, committee_contact: null, opening_cash_date: null }],
    apartments: [{ id: 'a1', number: 1, archived_at: null }],
    apartment_ledger: [{ apartment_id: 'a1', month: `${year}-01-01`, charged: 300, paid: 100 }],
    charges: [],
    building_cash: [{ balance: 4321 }],
    payments: [{ paid_on: `${year}-01-05`, amount: 100 }],
    expenses: [],
  }
  db.rpc = {
    budget_summary: [{ expected_income: 3600, actual_income: 100, actual_expenses: 1250, projected_expenses: 0, expected_balance: 2350 }],
    building_expense_report: [{ category_id: 'c1', category: 'ניקיון', sort_order: 1, month: `${year}-01-01`, total: 1250 }],
    budget_for_year: [{ category_id: 'c1', category: 'ניקיון', sort_order: 1, amount: 1000, source: 'default' }],
    collection_summary: [{ apartments_total: 17, apartments_paid_up: 14, amount_due_total: 900 }],
  }
})

describe('AnnualReportDocument (print sections)', () => {
  const report = buildAnnualReport({
    year: 2025, today: '2026-02-01', admin: true,
    summary: { expectedIncome: 3600, actualIncome: 3000, actualExpenses: 1250, projectedExpenses: 0, expectedBalance: 2350 },
    expenses: [{ categoryId: 'c1', category: 'ניקיון', month: '2025-03-01', total: 1250 }],
    budget: [{ category: 'ניקיון', planned: 1000, actual: 1250, source: 'default' }],
    collection: { total: 17, paidUp: 14, due: 900 }, collectionMonth: '2025-12-01', withAppendix: true,
    adminData: { ledger: [{ apartment_id: 'a1', month: '2025-01-01', charged: 300, paid: 300 }], charges: [], numbers: new Map([['a1', 1]]), cash: { today: 5000, openingDate: null, payments: [], expenses: [] } },
  })
  const renderDoc = (notes: string) => wrap(<AnnualReportDocument report={report} building={{ name: 'הרצל 12', address: 'תל אביב' }} today="2026-02-01" notes={notes} />)

  it('opens with a cover (building and year), then the sections in order, RTL', () => {
    const { container } = renderDoc('שיפוץ הלובי ב-2026')
    const article = container.querySelector('article.bm-annual')
    expect(article).toHaveAttribute('dir', 'rtl')
    const cover = container.querySelector('.bm-annual-cover')
    expect(cover).toHaveTextContent('הרצל 12')
    expect(within(cover as HTMLElement).getByRole('heading', { level: 1 })).toHaveTextContent(A.cover.heading(2025))
    expect(headings(article as HTMLElement)).toEqual([A.income.title, A.expenses.title, A.budget.title, A.fund.title, A.collection.title, A.notes.title, A.appendix.title])
    expect(screen.getByText('שיפוץ הלובי ב-2026')).toBeInTheDocument()
  })

  it('formats amounts as ₪, marks overspending and keeps charts and tables as whole blocks', () => {
    const { container } = renderDoc('')
    expect(screen.getAllByText(norm(formatILS(1250))).length).toBeGreaterThan(0)
    expect(screen.getAllByText(norm(formatILS(-250)))[0]).toHaveClass('bm-annual-over')
    expect(container.querySelectorAll('figure.bm-annual-chart')).toHaveLength(2)
    expect(container.querySelector('.bm-annual-appendix table')).not.toBeNull()
    expect(headings(container)).not.toContain(A.notes.title)
  })
})

describe('AnnualReportPage', () => {
  it('residents: no cash, no appendix (and no per-apartment money is requested)', async () => {
    wrap(<AnnualReportPage />)
    await waitFor(() => expect(printCopy()).toBeInTheDocument())
    expect(headings(printCopy())).not.toContain(A.fund.title)
    expect(headings(printCopy())).not.toContain(A.appendix.title)
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByLabelText(new RegExp(A.notes.label))).toBeNull()
    for (const table of ['apartment_ledger', 'charges', 'building_cash', 'payments', 'expenses']) expect(db.from).not.toContain(table)
    expect(within(printCopy()).getByText(norm(A.collection.line(14, 17)))).toBeInTheDocument()
  })

  it('admins: the fund, the appendix when switched on, the notes kept per year, and print', async () => {
    db.admin = true
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    wrap(<AnnualReportPage />)
    await waitFor(() => expect(headings(printCopy())).toContain(A.fund.title))
    expect(within(printCopy()).getAllByText(norm(formatILS(4321))).length).toBeGreaterThan(0)
    expect(headings(printCopy())).not.toContain(A.appendix.title)
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(headings(printCopy())).toContain(A.appendix.title))
    fireEvent.change(screen.getByLabelText(new RegExp(A.notes.label)), { target: { value: 'החלפת מעלית' } })
    expect(within(printCopy()).getByText('החלפת מעלית')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('bm-annual-notes') ?? '{}')).toEqual({ [String(year)]: 'החלפת מעלית' })
    fireEvent.click(screen.getByRole('button', { name: A.print }))
    expect(print).toHaveBeenCalledOnce()
  })
})
