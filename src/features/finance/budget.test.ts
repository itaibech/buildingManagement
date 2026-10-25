import { describe, expect, it } from 'vitest'
import { budgetPayload, isBudgetScope, remainingMonths, suggestBudgets, totalRow } from './budget'
import type { BudgetRow } from './ledger'

describe('remainingMonths (the projection window of budget_summary)', () => {
  it('counts the current month and the months after it', () => {
    expect(remainingMonths(2026, '2026-10-01')).toBe(3)
    expect(remainingMonths(2026, '2026-01-01')).toBe(12)
    expect(remainingMonths(2026, '2026-12-01')).toBe(1)
  })
  it('is 12 for a future year and 0 for a past one', () => {
    expect(remainingMonths(2027, '2026-10-01')).toBe(12)
    expect(remainingMonths(2025, '2026-10-01')).toBe(0)
  })
})

describe('totalRow', () => {
  const spent: BudgetRow[] = [{ category: 'ניקיון', planned: 0, actual: 50000.25 }, { category: 'מעלית', planned: 0, actual: 30334.3 }]
  it('without category budgets: the expected income is the plan', () => {
    expect(totalRow(spent, 96000)).toEqual({ planned: 96000, actual: 80334.55, basis: 'income', coverage: null })
  })
  it('without budgets and without a known income: planned 0', () => {
    expect(totalRow(spent, null)).toEqual({ planned: 0, actual: 80334.55, basis: 'income', coverage: null })
  })
  it('with category budgets: their sum, plus how much of it the income covers', () => {
    const rows: BudgetRow[] = [
      { category: 'ניקיון', planned: 60000, actual: 50000, source: 'default' },
      { category: 'מעלית', planned: 20000, actual: 30000, source: 'one_off' },
      { category: 'בזק', planned: 0, actual: 100 },
    ]
    expect(totalRow(rows, 72000)).toEqual({ planned: 80000, actual: 80100, basis: 'budgets', coverage: 90 })
  })
  it('an explicit zero budget still counts as budgeted', () => {
    expect(totalRow([{ category: 'א', planned: 0, actual: 10, source: 'one_off' }], 500).basis).toBe('budgets')
  })
})

describe('suggestBudgets', () => {
  const last = [
    { categoryId: 'c1', category: 'ניקיון', actual: 1000 },
    { categoryId: 'c2', category: 'מעלית', actual: 1000 },
    { categoryId: 'c3', category: 'חשמל', actual: 1000 },
    { categoryId: 'c4', category: 'ריק', actual: 0 },
  ]
  it('scales last year to the expected income in whole shekels that add up exactly', () => {
    const s = suggestBudgets(last, 10000)
    expect(s.map((x) => x.suggested)).toEqual([3334, 3333, 3333])
    expect(s.reduce((t, x) => t + x.suggested, 0)).toBe(10000)
    expect(s.every((x) => Number.isInteger(x.suggested))).toBe(true)
  })
  it('keeps proportions and skips categories with no spending', () => {
    const s = suggestBudgets([{ categoryId: 'a', category: 'א', actual: 300 }, { categoryId: 'b', category: 'ב', actual: 100 }], 2000.4)
    expect(s).toEqual([{ categoryId: 'a', category: 'א', last: 300, suggested: 1500 }, { categoryId: 'b', category: 'ב', last: 100, suggested: 500 }])
  })
  it('suggests nothing without spending or without income', () => {
    expect(suggestBudgets([], 1000)).toEqual([])
    expect(suggestBudgets(last, 0)).toEqual([])
  })
})

describe('budgetPayload', () => {
  it('builds the set_budgets arguments', () => {
    expect(budgetPayload(2026, 'recurring', [{ category_id: 'c1', amount: 1200 }])).toEqual({ year: 2026, scope: 'recurring', lines: [{ category_id: 'c1', amount: 1200 }] })
    expect(isBudgetScope('once')).toBe(true)
    expect(isBudgetScope('forever')).toBe(false)
  })
})
