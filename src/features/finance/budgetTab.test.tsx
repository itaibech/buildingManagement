// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { todayISO } from '../../lib/dates'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import { BudgetTab } from './BudgetTab'
import { ExpenseMonthReport } from './ExpenseMonthReport'

const year = Number(todayISO().slice(0, 4))
/** The DOM text is whitespace-normalised (formatILS uses a no-break space), so the expected text must be too. */
const t = (s: string): string => s.replace(/\s+/g, ' ')
const db = vi.hoisted(() => ({
  rpc: {} as Record<string, unknown>, tables: {} as Record<string, unknown[]>,
  calls: [] as { fn: string; args: unknown }[], hold: null as Promise<void> | null,
}))

function builder(table: string) {
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'lt', 'gte', 'order', 'in', 'limit']) chain[op] = () => chain
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: db.tables[table] ?? [], error: null }).then(resolve)
  return chain
}
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (t: string) => builder(t),
    rpc: async (fn: string, args: unknown) => {
      db.calls.push({ fn, args })
      if (fn === 'set_budgets' && db.hold) await db.hold
      return { data: db.rpc[fn] ?? null, error: null }
    },
  },
}))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: vi.fn() }))

const wrap = (node: React.ReactNode) => render(
  <MantineProvider theme={theme}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>
  </MantineProvider>,
)

beforeEach(() => {
  db.calls = []
  db.hold = null
  db.tables = {
    expenses: [{ id: 'e1', category_id: 'c1', spent_on: `${year}-02-10`, amount: 400, vendor: '', note: '', receipt_path: null, source: 'manual', template_id: null, expense_categories: { name: 'ניקיון' } }],
    expense_categories: [{ id: 'c1', name: 'ניקיון', sort_order: 1 }, { id: 'c2', name: 'מעלית', sort_order: 2 }],
    building_cash: [{ balance: 1000 }],
  }
  db.rpc = {
    budget_for_year: [{ category_id: 'c1', category: 'ניקיון', sort_order: 1, amount: 1000, source: 'default' }],
    budget_summary: [{ expected_income: 12000, actual_income: 9000, actual_expenses: 400, projected_expenses: 0, expected_balance: 11600 }],
    building_expense_report: [],
    set_budgets: 1,
  }
})

describe('budget table: inline edit', () => {
  it('shows the source badge and a 44px edit button per category', async () => {
    wrap(<BudgetTab adding={false} onAddingClose={() => undefined} />)
    expect(await screen.findByText(he.finance.budget.sources.default)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: he.finance.editBudget('ניקיון') })).toBeInTheDocument()
  })

  it('opens with the amount, the monthly hint and "this year and on" by default; saves that payload', async () => {
    wrap(<BudgetTab adding={false} onAddingClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: he.finance.editBudget('ניקיון') }))
    await screen.findByLabelText(new RegExp(he.finance.budget.yearlyAmount))
    const dialog = screen.getByRole('dialog')
    expect((within(dialog).getByLabelText(new RegExp(he.finance.budget.yearlyAmount)) as HTMLInputElement).value).toContain('1,000')
    expect(within(dialog).getByText(t(he.finance.budget.monthlyHint(formatILS(1000 / 12))))).toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: he.finance.budget.scopes.recurring })).toBeChecked()
    fireEvent.click(within(dialog).getByRole('radio', { name: he.finance.budget.scopes.once }))
    fireEvent.change(within(dialog).getByLabelText(new RegExp(he.finance.budget.yearlyAmount)), { target: { value: '1500' } })
    fireEvent.click(within(dialog).getByRole('button', { name: he.finance.save }))
    await waitFor(() => expect(db.calls.find((c) => c.fn === 'set_budgets')?.args).toEqual({
      p_year: year, p_scope: 'once', p_lines: [{ category_id: 'c1', amount: 1500 }],
    }))
  })

  it('updates the difference and the badge immediately, before the server answers', async () => {
    let release = (): void => undefined
    db.hold = new Promise<void>((r) => { release = r })
    wrap(<BudgetTab adding={false} onAddingClose={() => undefined} />)
    expect(await screen.findAllByText(t(he.finance.under(formatILS(600))))).not.toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: he.finance.editBudget('ניקיון') }))
    await screen.findByLabelText(new RegExp(he.finance.budget.yearlyAmount))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('radio', { name: he.finance.budget.scopes.once }))
    fireEvent.change(within(dialog).getByLabelText(new RegExp(he.finance.budget.yearlyAmount)), { target: { value: '300' } })
    fireEvent.click(within(dialog).getByRole('button', { name: he.finance.save }))
    expect(await screen.findAllByText(t(he.finance.over(formatILS(100))))).not.toHaveLength(0)
    expect(screen.getByText(he.finance.budget.sources.one_off)).toBeInTheDocument()
    release()
  })

  it('total row: with category budgets, shows the expected income coverage', async () => {
    wrap(<BudgetTab adding={false} onAddingClose={() => undefined} />)
    expect(await screen.findByText(he.finance.budget.coverage(1200))).toBeInTheDocument()
  })

  it('total row: without category budgets, plans by the expected income instead of "ללא תקציב"', async () => {
    db.rpc.budget_for_year = []
    wrap(<BudgetTab adding={false} onAddingClose={() => undefined} />)
    expect(await screen.findByText(new RegExp(he.finance.budget.plannedByIncome.replace(/[()]/g, '.')))).toBeInTheDocument()
    expect(screen.getAllByText(t(he.finance.under(formatILS(11600))))).not.toHaveLength(0)
  })
})

describe('expenses by month', () => {
  it('says the month is empty, then navigates to a month with spending', async () => {
    db.rpc.building_expense_report = [{ category_id: 'c1', category: 'ניקיון', sort_order: 1, month: `${year}-02-01`, total: 400 }]
    wrap(<ExpenseMonthReport />)
    const feb = await screen.findByRole('button', { name: new RegExp(`פברואר ${year}`) })
    fireEvent.click(feb)
    expect(await screen.findByText(t(he.finance.byMonth.monthTotal(formatILS(400))))).toBeInTheDocument()
    expect(screen.getByText(he.finance.byMonth.share(100))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.finance.nextMonth }))
    expect(await screen.findByText(he.finance.byMonth.empty)).toBeInTheDocument()
  })
})
