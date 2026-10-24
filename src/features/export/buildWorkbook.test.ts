import { describe, expect, it } from 'vitest'
import { he } from '../../lib/he'
import { parseBudgetSheet, parseExpensesSheet, parseIncomeSheet } from '../import/parseWorkbook'
import { SHEETS } from '../import/readWorkbook'
import { apartmentsRows, balancesRows, buildYearWorkbook, toSheetRows, type YearData } from './buildWorkbook'

const apartments = [
  { id: 'a2', number: 2, floor: 1, notes: null, building_id: 'b', created_at: '', is_committee: false, payment_method: 'manual', standing_order_from: null },
  { id: 'a1', number: 1, floor: 0, notes: null, building_id: 'b', created_at: '', is_committee: false, payment_method: 'manual', standing_order_from: null },
]
const resident = (id: string, apartment_id: string, full_name: string, phone: string | null) =>
  ({ id, apartment_id, full_name, phone, email: null, is_owner: true, building_id: 'b', created_at: '' })
const data: YearData = {
  year: 2026,
  apartments,
  residents: [resident('r1', 'a1', 'דנה לוי', '0501234567'), resident('r2', 'a1', 'רן לוי', null), resident('r3', 'a2', 'יוסי כהן', '0527654321')],
  ledger: [
    { apartment_id: 'a1', month: '2026-01-01', charged: 390, paid: 390 },
    { apartment_id: 'a1', month: '2026-03-01', charged: 390, paid: 200.5 },
    { apartment_id: 'a1', month: '2025-12-01', charged: 390, paid: 390 },
    { apartment_id: 'a2', month: '2026-02-01', charged: 390, paid: 100 },
  ],
  categories: [{ id: 'c1', name: 'ניקיון' }, { id: 'c2', name: 'חשמל' }],
  expenses: [
    { id: 'e1', category_id: 'c1', category: 'ניקיון', spent_on: '2026-02-10', amount: 300, vendor: '', note: '', receipt_path: null, source: 'manual', template_id: null },
    { id: 'e2', category_id: 'c1', category: 'ניקיון', spent_on: '2026-02-20', amount: 50.25, vendor: '', note: '', receipt_path: null, source: 'manual', template_id: null },
    { id: 'e3', category_id: 'c2', category: 'חשמל', spent_on: '2025-12-01', amount: 999, vendor: '', note: '', receipt_path: null, source: 'manual', template_id: null },
  ],
  budgets: [{ id: 'b1', year: 2026, category_id: 'c1', category: 'ניקיון', amount: 4000 }],
}

describe('toSheetRows', () => {
  it('puts the headers first, then the rows in order', () => {
    const rows = toSheetRows([{ n: 1, s: 'א' }, { n: 2, s: null }], [
      { header: 'מספר', value: (r) => r.n },
      { header: 'שם', value: (r) => r.s },
    ])
    expect(rows).toEqual([['מספר', 'שם'], [1, 'א'], [2, null]])
  })

  it('adds the current fee and its source to the balances export', () => {
    const rows = balancesRows([
      { apartmentId: 'a1', number: 1, names: ['דנה'], balance: 120, scheduled: 0, fee: 330, feeMode: 'building', isCommittee: false, standingOrder: true },
      { apartmentId: 'a2', number: 2, names: [], balance: 0, scheduled: 0, fee: 0, feeMode: 'exempt', isCommittee: true, standingOrder: false },
    ], (id) => id === 'a2')
    expect(rows[0].slice(-5)).toEqual([he.fees.exportFee, he.fees.exportMode, 'אמצעי תשלום', 'נציג ועד', 'עמדת טעינה'])
    expect(rows.slice(1).map((r) => r.slice(-5))).toEqual([[330, 'לפי תעריף הבניין', 'הוראת קבע', '', ''], [0, 'פטור', 'רגיל', 'כן', 'כן']])
  })

  it('adds payment method, committee and EV charger to the apartments export', () => {
    const base = { building_id: 'b', floor: 1, notes: null, created_at: '', standing_order_from: null }
    const rows = apartmentsRows([
      { ...base, id: 'a1', number: 1, is_committee: true, payment_method: 'manual' },
      { ...base, id: 'a2', number: 2, is_committee: false, payment_method: 'standing_order', standing_order_from: '2026-01-01' },
    ], [], (id) => id === 'a1')
    expect(rows[0].slice(-3)).toEqual(['אמצעי תשלום', 'נציג ועד', 'עמדת טעינה'])
    expect(rows.slice(1).map((r) => r.slice(-3))).toEqual([['רגיל', 'כן', 'כן'], ['הוראת קבע', '', '']])
  })
})

describe('buildYearWorkbook', () => {
  const wb = buildYearWorkbook(data)
  const income = wb.sheets[SHEETS.income] ?? []

  it('has the three importer sheets, in order', () => {
    expect(Object.keys(wb.sheets)).toEqual([SHEETS.income, SHEETS.expenses, SHEETS.budget])
  })

  it('puts monthly payment sums in their month columns, with a row total', () => {
    const row = income.find((r) => r[0] === 1)
    expect(row?.slice(3, 15)).toEqual([390, null, 200.5, null, null, null, null, null, null, null, null, null])
    expect(row?.[15]).toBe(590.5)
    expect(income.find((r) => r[0] === 2)?.[15]).toBe(100)
  })

  it('writes amounts as numbers and extra residents on follow-up rows', () => {
    expect(income.filter((r) => r[0] === 1).map((r) => r[1])).toEqual(['דנה לוי', 'רן לוי'])
    expect(income.find((r) => r[0] === 1)?.[2]).toBe('0501234567')
    expect(income.flat().every((c) => c === null || typeof c === 'number' || typeof c === 'string')).toBe(true)
  })

  it('round-trips through the import parser', () => {
    const parsed = parseIncomeSheet(income)
    expect(parsed.year).toBe(2026)
    expect(parsed.warnings.filter((w) => w.includes('unrecognized'))).toEqual([])
    const months = new Map(parsed.columns.map((c) => [c.col, c.proposal]))
    const perMonth = (n: number): Record<string, number> => {
      const apt = parsed.apartments.find((a) => a.number === n)
      return Object.fromEntries(Object.entries(apt?.cells ?? {}).map(([col, v]) => {
        const p = months.get(Number(col))
        return [p?.kind === 'month' ? p.month : '?', v]
      }))
    }
    expect(perMonth(1)).toEqual({ '2026-01': 390, '2026-03': 200.5 })
    expect(perMonth(2)).toEqual({ '2026-02': 100 })
    expect(parsed.apartments.every((a) => a.name !== '')).toBe(true)
    expect(parsed.columns.every((c) => c.warning === undefined)).toBe(true)
  })

  it('exports expenses per category and month, re-importable', () => {
    const rows = parseExpensesSheet(wb.sheets[SHEETS.expenses] ?? [], 2026)
    expect(rows).toEqual([{ category: 'ניקיון', byMonth: { '2026-02': 350.25 } }])
  })

  it('exports the planned budget with its year, re-importable', () => {
    expect(parseBudgetSheet(wb.sheets[SHEETS.budget] ?? [])).toEqual({ year: 2026, items: [{ category: 'ניקיון', amount: 4000 }] })
    expect(he.export.headers.total).toBe('סה"כ')
  })
})
