import { describe, expect, it } from 'vitest'
import { he } from '../../lib/he'
import {
  annualSheets, apartmentAppendix, budgetReport, buildAnnualReport, collectionMonthFor, expenseTable, fundBalance, incomeBuckets, type AdminInput, type AnnualInput,
} from './annualReport'
import type { LedgerRow } from './ledger'
import type { ChargeLine } from './settlement'

// a1: Jan fee 300 + levy 200; Feb fee 300 + EV 50.5 + special 100; Mar fee 300 + key copy 25 + a write-off of 100.
// a2: Jan fee 300 + an opening balance of 1000. 2024 rows and a December charge (not in the ledger yet) are out.
const LEDGER: LedgerRow[] = [
  { apartment_id: 'a1', month: '2024-12-01', charged: 300, paid: 0 },
  { apartment_id: 'a1', month: '2025-01-01', charged: 500, paid: 500 },
  { apartment_id: 'a1', month: '2025-02-01', charged: 450.5, paid: 300 },
  { apartment_id: 'a1', month: '2025-03-01', charged: 225, paid: 0, adjusted: -100 },
  { apartment_id: 'a2', month: '2025-01-01', charged: 1300, paid: 1300 },
]
const CHARGES: ChargeLine[] = [
  { month: '2025-01-01', amount: 200, kind: 'levy', ev: false },
  { month: '2025-02-01', amount: 50.5, kind: 'extra', ev: true },
  { month: '2025-02-01', amount: 100, kind: 'extra', ev: false, special: true },
  { month: '2025-03-01', amount: 25, kind: 'extra', ev: false },
  { month: '2025-03-01', amount: -100, kind: 'adjustment', ev: false },
  { month: '2025-01-01', amount: 1000, kind: 'opening', ev: false },
  { month: '2025-12-01', amount: 999, kind: 'levy', ev: false },
]

describe('incomeBuckets', () => {
  it('splits the year into fees, levies (with special charges), EV and other; no openings or write-offs', () => {
    expect(incomeBuckets(LEDGER, CHARGES, 2025)).toEqual({ fees: 1200, levies: 300, ev: 50.5, other: 25, total: 1575.5 })
  })

  it('is all zeros for a year without ledger rows', () => {
    expect(incomeBuckets(LEDGER, CHARGES, 2023)).toEqual({ fees: 0, levies: 0, ev: 0, other: 0, total: 0 })
  })
})

describe('expenseTable', () => {
  const rows = [
    { categoryId: 'c1', category: 'ניקיון', month: '2025-01-01', total: 100.1 },
    { categoryId: 'c1', category: 'ניקיון', month: '2025-02-01', total: 200.2 },
    { categoryId: 'c2', category: 'מעלית', month: '2025-01-01', total: 50 },
    { categoryId: 'c2', category: 'מעלית', month: '2024-01-01', total: 999 },
  ]

  it('gives each category its twelve months and total, and the monthly and yearly totals', () => {
    const t = expenseTable(rows, 2025)
    expect(t.categories.map((c) => [c.category, c.total])).toEqual([['ניקיון', 300.3], ['מעלית', 50]])
    expect(t.categories[0]?.months.slice(0, 3)).toEqual([100.1, 200.2, 0])
    expect(t.monthTotals).toHaveLength(12)
    expect(t.monthTotals.slice(0, 2)).toEqual([150.1, 200.2])
    expect(t.total).toBe(350.3)
  })
})

describe('budgetReport', () => {
  it('works out the variance and the share used per category, and the totals', () => {
    const b = budgetReport([
      { category: 'ניקיון', planned: 1000, actual: 1200, source: 'default' },
      { category: 'מעלית', planned: 500, actual: 100, source: 'one_off' },
      { category: 'שונות', planned: 0, actual: 30 },
    ])
    expect(b.lines.map((l) => [l.category, l.variance, l.used])).toEqual([['ניקיון', -200, 120], ['מעלית', 400, 20], ['שונות', -30, null]])
    expect([b.planned, b.actual, b.variance]).toEqual([1500, 1330, 170])
  })
})

describe('fundBalance', () => {
  const cash = {
    today: 10000, openingDate: null,
    payments: [{ date: '2024-05-01', amount: 2000 }, { date: '2025-01-05', amount: 3000 }, { date: '2025-03-01', amount: 1000 }],
    expenses: [{ date: '2024-07-01', amount: 700 }, { date: '2025-02-01', amount: 500 }],
  }

  it('the current year: rolled back to 1 January, and today', () => {
    expect(fundBalance(cash, 2025, '2025-06-15')).toEqual({ startDate: '2025-01-01', start: 6500, endDate: '2025-06-15', end: 10000, endIsToday: true, change: 3500 })
  })

  it('a past year: 1 January to 31 December', () => {
    expect(fundBalance(cash, 2024, '2025-06-15')).toEqual({ startDate: '2024-01-01', start: 5200, endDate: '2024-12-31', end: 6500, endIsToday: false, change: 1300 })
  })

  it('starts at the opening-cash date when tracking began during the year; none before it or for a future year', () => {
    expect(fundBalance({ ...cash, openingDate: '2025-02-01' }, 2025, '2025-06-15')?.startDate).toBe('2025-02-01')
    expect(fundBalance({ ...cash, openingDate: '2025-02-01' }, 2025, '2025-06-15')?.start).toBe(9500)
    expect(fundBalance({ ...cash, openingDate: '2025-02-01' }, 2024, '2025-06-15')).toBeNull()
    expect(fundBalance(cash, 2026, '2025-06-15')).toBeNull()
  })
})

describe('apartmentAppendix', () => {
  it('each apartment by number: charged and paid in the year, balance at its end (earlier years carried)', () => {
    expect(apartmentAppendix(LEDGER, 2025, new Map([['a2', 2], ['a1', 1]]))).toEqual([
      { number: 1, charged: 1175.5, paid: 800, balance: 675.5 },
      { number: 2, charged: 1300, paid: 1300, balance: 0 },
    ])
  })
})

const ADMIN_DATA: AdminInput = {
  ledger: LEDGER, charges: CHARGES, numbers: new Map([['a1', 1], ['a2', 2]]),
  cash: { today: 10000, openingDate: null, payments: [], expenses: [] },
}
const input = (over: Partial<AnnualInput>): AnnualInput => ({
  year: 2025, today: '2025-06-15', admin: true,
  summary: { expectedIncome: 7200, actualIncome: 5000, actualExpenses: 350, projectedExpenses: 0, expectedBalance: 6850 },
  expenses: [], budget: [], collection: { total: 17, paidUp: 14, due: 900 }, collectionMonth: '2025-06-01',
  adminData: ADMIN_DATA, withAppendix: false, ...over,
})

describe('buildAnnualReport', () => {
  it('admins get the income split, the received income, the fund and (when asked) the appendix', () => {
    const r = buildAnnualReport(input({ withAppendix: true }))
    expect(r.income?.total).toBe(1575.5)
    expect(r.receivedIncome).toBe(5000)
    expect(r.fund?.end).toBe(10000)
    expect(r.appendix).toHaveLength(2)
    expect(r.collection).toEqual({ month: '2025-06-01', total: 17, paidUp: 14, owing: 3 })
  })

  it('the appendix is off by default', () => {
    expect(buildAnnualReport(input({})).appendix).toBeNull()
  })

  it('non-admins never get the cash, the per-apartment appendix, the split or the received income', () => {
    const r = buildAnnualReport(input({ admin: false, withAppendix: true }))
    expect(r.fund).toBeNull()
    expect(r.appendix).toBeNull()
    expect(r.income).toBeNull()
    expect(r.receivedIncome).toBeNull()
    expect(r.expectedIncome).toBe(7200)
    expect(r.collection.owing).toBe(3)
  })
})

describe('annualSheets', () => {
  const S = he.annual.sheets

  it('admins: every section, the notes when written and the appendix when on', () => {
    const sheets = annualSheets(buildAnnualReport(input({ withAppendix: true })), ' תוכנית: שיפוץ הלובי ')
    expect(Object.keys(sheets)).toEqual([S.income, S.expenses, S.budget, S.fund, S.collection, S.notes, S.appendix])
    expect(sheets[S.expenses]?.[0]).toHaveLength(14)
    expect(sheets[S.notes]?.[1]).toEqual(['תוכנית: שיפוץ הלובי'])
  })

  it('residents: no cash and no appendix sheet', () => {
    const sheets = annualSheets(buildAnnualReport(input({ admin: false, withAppendix: true })), '')
    expect(Object.keys(sheets)).toEqual([S.income, S.expenses, S.budget, S.collection])
  })
})

describe('collectionMonthFor', () => {
  it('admins: December of a past year, else this month; residents: always this month', () => {
    expect(collectionMonthFor(2024, true, '2025-06-15')).toBe('2024-12-01')
    expect(collectionMonthFor(2025, true, '2025-06-15')).toBe('2025-06-01')
    expect(collectionMonthFor(2024, false, '2025-06-15')).toBe('2025-06-01')
  })
})
