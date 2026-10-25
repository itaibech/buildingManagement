/** Pure budget helpers (Task 26): the total row, the yearly summary projection, the income-based suggestion. */
import type { BudgetRow } from './ledger'

/** Where a category's planned amount comes from: a recurring default or a one-off for the year (budget_for_year). */
export type BudgetSource = 'default' | 'one_off'
/** "לשנה זו ולשנים הבאות" (recurring default from the year on) or "לשנה זו בלבד" (one-off). */
export type BudgetScope = 'recurring' | 'once'
export const BUDGET_SCOPES: readonly BudgetScope[] = ['recurring', 'once']
export const isBudgetScope = (v: unknown): v is BudgetScope => BUDGET_SCOPES.some((s) => s === v)
export const isBudgetSource = (v: unknown): v is BudgetSource => v === 'default' || v === 'one_off'

export interface BudgetLineInput { category_id: string; amount: number }
export interface BudgetPayload { year: number; scope: BudgetScope; lines: BudgetLineInput[] }

/** rpc('set_budgets') arguments for one or many lines. */
export const budgetPayload = (year: number, scope: BudgetScope, lines: BudgetLineInput[]): BudgetPayload => ({ year, scope, lines })

const money = (n: number): number => Math.round(n * 100) / 100

export interface BudgetSummary {
  expectedIncome: number
  actualIncome: number
  actualExpenses: number
  projectedExpenses: number
  expectedBalance: number
}

/** Months of `year` not yet reached, counting the current month (budget_summary projects them). */
export function remainingMonths(year: number, currentMonth: string): number {
  const cy = Number(currentMonth.slice(0, 4))
  const cm = Number(currentMonth.slice(5, 7))
  if (year < cy) return 0
  if (year > cy) return 12
  return 13 - cm
}

export interface TotalRow {
  planned: number
  actual: number
  /** 'budgets': the categories' sum; 'income': no category budget, so the expected income is the plan. */
  basis: 'budgets' | 'income'
  /** With category budgets and a known income: expected income as a whole percent of the planned total. */
  coverage: number | null
}

/** The table's total row: the categories' sum when any budget line exists, else the expected income. */
export function totalRow(rows: readonly BudgetRow[], expectedIncome: number | null): TotalRow {
  const actual = money(rows.reduce((t, r) => t + r.actual, 0))
  const budgeted = rows.some((r) => r.source !== undefined)
  if (!budgeted) return { planned: expectedIncome ?? 0, actual, basis: 'income', coverage: null }
  const planned = money(rows.reduce((t, r) => t + r.planned, 0))
  const coverage = expectedIncome !== null && planned > 0 ? Math.round((expectedIncome / planned) * 100) : null
  return { planned, actual, basis: 'budgets', coverage }
}

export interface Suggestion { categoryId: string; category: string; last: number; suggested: number }

/**
 * Next year's budget from last year's actual spending per category, scaled so the total equals the expected income,
 * in whole shekels. The rounding (largest remainder) makes the suggested amounts add up to the income exactly.
 */
export function suggestBudgets(last: readonly { categoryId: string; category: string; actual: number }[], expectedIncome: number): Suggestion[] {
  const base = last.filter((l) => l.actual > 0)
  const total = base.reduce((t, l) => t + l.actual, 0)
  const target = Math.round(expectedIncome)
  if (total <= 0 || target <= 0) return []
  const raw = base.map((l) => ({ ...l, exact: (l.actual / total) * target }))
  const floors = raw.map((r) => Math.floor(r.exact))
  let left = target - floors.reduce((t, n) => t + n, 0)
  const order = raw.map((r, i) => ({ i, frac: r.exact - Math.floor(r.exact) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    floors[i] = (floors[i] ?? 0) + 1
    left -= 1
  }
  return raw.map((r, i) => ({ categoryId: r.categoryId, category: r.category, last: money(r.actual), suggested: floors[i] ?? 0 }))
}
