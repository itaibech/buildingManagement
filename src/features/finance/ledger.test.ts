import { describe, expect, it } from 'vitest'
import { balanceState, budgetVsActual, isBalanceSort, monthOf, receiptPath, shiftMonth, sortBalances, toLedgerGrid } from './ledger'

describe('toLedgerGrid', () => {
  it('fills 12 months with zeros for months without rows', () => {
    const grid = toLedgerGrid([{ apartment_id: 'a1', month: '2026-03-01', charged: 390, paid: 0 }], 2026)
    expect(grid.months).toHaveLength(12)
    expect(grid.months[0]).toBe('2026-01-01')
    expect(grid.months[11]).toBe('2026-12-01')
    const a1 = grid.byApartment.get('a1')
    expect(a1?.cells).toHaveLength(12)
    expect(a1?.cells[0]).toEqual({ charged: 0, paid: 0 })
    expect(a1?.cells[2]).toEqual({ charged: 390, paid: 0 })
  })

  it('balances include earlier years but cells only show the chosen year', () => {
    const grid = toLedgerGrid(
      [
        { apartment_id: 'a1', month: '2025-12-01', charged: 300, paid: 0 },
        { apartment_id: 'a1', month: '2026-01-01', charged: 390, paid: 500 },
        { apartment_id: 'a2', month: '2026-02-01', charged: 390, paid: 390 },
      ],
      2026,
    )
    expect(grid.byApartment.get('a1')?.balance).toBe(190)
    expect(grid.byApartment.get('a1')?.cells[0]).toEqual({ charged: 390, paid: 500 })
    expect(grid.byApartment.get('a2')?.balance).toBe(0)
  })

  it('ignores rows after the chosen year', () => {
    const grid = toLedgerGrid([{ apartment_id: 'a1', month: '2027-01-01', charged: 390, paid: 0 }], 2026)
    expect(grid.byApartment.get('a1')?.balance ?? 0).toBe(0)
  })
})

describe('budgetVsActual', () => {
  const budgets = [
    { year: 2026, category: 'ניקיון', amount: 7200 },
    { year: 2026, category: 'מעלית', amount: 4800 },
    { year: 2025, category: 'חשמל', amount: 999 },
  ]
  const expenses = [
    { category: 'ניקיון', spent_on: '2026-01-31', amount: 600 },
    { category: 'ניקיון', spent_on: '2026-02-28', amount: 600.5 },
    { category: 'ניקיון', spent_on: '2025-12-31', amount: 600 },
    { category: 'בזק', spent_on: '2026-03-05', amount: 120 },
  ]

  it('sums expenses per category in that year only', () => {
    const rows = budgetVsActual(budgets, expenses, 2026)
    expect(rows.find((r) => r.category === 'ניקיון')).toEqual({ category: 'ניקיון', planned: 7200, actual: 1200.5 })
  })

  it('lists budgeted categories with no expenses as actual 0', () => {
    const rows = budgetVsActual(budgets, expenses, 2026)
    expect(rows.find((r) => r.category === 'מעלית')).toEqual({ category: 'מעלית', planned: 4800, actual: 0 })
  })

  it('keeps unbudgeted spending as planned 0 and skips other years', () => {
    const rows = budgetVsActual(budgets, expenses, 2026)
    expect(rows.find((r) => r.category === 'בזק')).toEqual({ category: 'בזק', planned: 0, actual: 120 })
    expect(rows.find((r) => r.category === 'חשמל')).toBeUndefined()
    expect(rows.map((r) => r.category)).toEqual(['ניקיון', 'מעלית', 'בזק'])
  })
})

describe('small helpers', () => {
  const apts = [{ number: 12, balance: 10 }, { number: 2, balance: 0 }, { number: 7, balance: -5 }, { number: 3, balance: 300 }, { number: 1, balance: 10 }]

  it('sortBalances by apartment number, ascending (the default)', () => {
    expect(sortBalances(apts, 'number').map((r) => r.number)).toEqual([1, 2, 3, 7, 12])
  })

  it('sortBalances by amount: largest debt first, ties by apartment number, credits last', () => {
    expect(sortBalances(apts, 'amount').map((r) => r.number)).toEqual([3, 1, 12, 2, 7])
    expect(apts.map((r) => r.number)).toEqual([12, 2, 7, 3, 1])
  })

  it('isBalanceSort accepts only the two orders (a stored value may be anything)', () => {
    expect(['number', 'amount', 'balance', null].map(isBalanceSort)).toEqual([true, true, false, false])
  })

  it('monthOf and shiftMonth work on first-of-month dates', () => {
    expect(monthOf('2026-10-23')).toBe('2026-10-01')
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01')
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01')
  })

  it('balanceState names owed, settled and credit', () => {
    expect(balanceState(0)).toBe('settled')
    expect(balanceState(10)).toBe('owed')
    expect(balanceState(-10)).toBe('credit')
  })

  it('receiptPath uses the expense folder and a whitelisted extension', () => {
    expect(receiptPath('e1', 'application/pdf', 'u1')).toBe('e1/u1.pdf')
    expect(receiptPath('e1', 'image/jpeg', 'u1')).toBe('e1/u1.jpg')
    expect(receiptPath('e1', 'text/html', 'u1')).toBeNull()
  })
})
