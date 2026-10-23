import { describe, expect, it } from 'vitest'
import { he } from '../../lib/he'
import {
  budgetUpdates, buildImport, feesToReplace, findOverlaps, findPaymentOverlaps, initialFees, isExistingFee, likelyExempt, overlapKey,
  priorCharges, proposeFees, skipRecorded, summarize, type PaymentRow,
} from './buildImport'
import { budgetFixture, expensesFixture, INCOME_HEADER, incomeFixture } from './fixture'
import { excelSerialToMonth, parseBudgetSheet, parseExpensesSheet, parseIncomeSheet, type ColumnMap } from './parseWorkbook'

const income = parseIncomeSheet(incomeFixture)
const byCol = (col: number): ColumnMap => {
  const c = income.columns.find((x) => x.col === col)
  if (!c) throw new Error(`no column ${col}`)
  return c
}
const parsed = () => ({
  income,
  expenses: parseExpensesSheet(expensesFixture, income.year),
  budget: parseBudgetSheet(budgetFixture),
})
const FEES = [{ amount: 390, effective_from: '2026-01-01' }, { amount: 330, effective_from: '2026-07-01' }]
const withLevyMonth = (cols: ColumnMap[]): ColumnMap[] =>
  cols.map((c) => (c.proposal.kind === 'levy' ? { ...c, proposal: { ...c.proposal, month: '2026-10' } } : c))

describe('parseIncomeSheet', () => {
  it('takes the year from the majority of serial headers, not the stale title', () => {
    expect(income.year).toBe(2026)
    expect(excelSerialToMonth(46023)).toBe('2026-01')
  })

  it('maps serial and Hebrew month headers to months', () => {
    expect(byCol(3).proposal).toEqual({ kind: 'month', month: '2026-01' })
    expect(byCol(10).proposal).toEqual({ kind: 'month', month: '2026-08' })
    expect(byCol(12).proposal).toEqual({ kind: 'month', month: '2026-09' })
    expect(byCol(13).proposal).toEqual({ kind: 'month', month: '2026-10' })
    expect(byCol(16).proposal).toEqual({ kind: 'month', month: '2026-12' })
  })

  it('flags the second October column as a duplicate levy proposal', () => {
    const l = byCol(11)
    expect(l.header).toBe('אוקטובר')
    expect(l.warning).toBe('duplicate')
    expect(l.proposal).toEqual({ kind: 'levy', month: null, amount: 500 })
  })

  it('ignores the empty and total columns and lists nothing past the total', () => {
    expect(byCol(15).proposal).toEqual({ kind: 'ignore' })
    expect(byCol(17).proposal).toEqual({ kind: 'ignore' })
    expect(income.columns.map((c) => c.col)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
  })

  it('reads apartment rows and skips totals and notes', () => {
    expect(income.apartments.map((a) => a.number)).toEqual([1, 2, 3, 2])
    expect(income.apartments[0]).toMatchObject({ name: 'דייר א', phone: '050-0000001' })
    expect(income.apartments[1].cells).toEqual({ 4: 2340, 9: 330, 10: 330, 11: 500, 12: 330, 13: 330 })
  })

  it('skips 0 and unreadable cells, warning about the unreadable one', () => {
    const a1 = income.apartments[0].cells
    expect(a1[13]).toBeUndefined()
    expect(a1[14]).toBeUndefined()
    expect(income.warnings.some((w) => w.includes('בהמשך'))).toBe(true)
    expect(income.warnings.some((w) => w.includes('דירה 2'))).toBe(true)
  })

  it('reads the EV block for the EV apartment only', () => {
    expect(income.ev).toEqual([{ apartment: 3, byMonth: { '2026-01': 103.5, '2026-02': 293.4, '2026-04': 150 } }])
    const total = Object.values(income.ev[0].byMonth).reduce((s, v) => s + v, 0)
    expect(total).toBeCloseTo(546.9)
  })

  it('detects an EV block from its label even with fewer than 3 months, never left of the total', () => {
    const header = [...INCOME_HEADER]
    const apt = (ev: Record<number, number>) => { const r: unknown[] = [1, 'דייר', '', 390]; for (const [c, v] of Object.entries(ev)) r[Number(c)] = v; return r }
    const labelled = parseIncomeSheet([[], (() => { const r: unknown[] = []; r[18] = 'טעינה'; r[19] = 'ינואר'; r[20] = 'פברואר'; return r })(), header, apt({ 19: 10, 20: 20 })])
    expect(labelled.ev).toEqual([{ apartment: 1, byMonth: { '2026-01': 10, '2026-02': 20 } }])
    const unlabelled = parseIncomeSheet([[], (() => { const r: unknown[] = []; r[18] = 'ינואר'; r[19] = 'פברואר'; return r })(), header, apt({ 18: 10, 19: 20 })])
    expect(unlabelled.ev).toEqual([])
    const leftOfTotal = parseIncomeSheet([[], ['טעינה', 'ינואר', 'פברואר', 'מרץ'], header, apt({})])
    expect(leftOfTotal.ev).toEqual([])
  })

  it('throws a readable error when there is no header row', () => {
    expect(() => parseIncomeSheet([['שלום'], [1, 2]])).toThrow()
  })
})

describe('parseExpensesSheet / parseBudgetSheet', () => {
  it('reads one entry per category row with amounts, skipping empty rows and totals', () => {
    const rows = parseExpensesSheet(expensesFixture, 2026)
    expect(rows).toEqual([
      { category: 'חברת ניהול', byMonth: { '2026-01': 1800, '2026-02': 1700, '2026-03': 1700 } },
      { category: 'ניקיון חברה א', byMonth: { '2026-01': 1600, '2026-02': 1600 } },
      { category: 'בנק', byMonth: { '2026-01': 36, '2026-02': 40, '2026-04': 44 } },
    ])
  })

  it('reads the budget year and items, skipping empty amounts and the total row', () => {
    expect(parseBudgetSheet(budgetFixture)).toEqual({
      year: 2025,
      items: [{ category: 'דמי ניהול', amount: 20400 }, { category: 'נקיון', amount: 19200 }],
    })
  })
})

describe('buildImport', () => {
  const payload = buildImport(parsed(), withLevyMonth(income.columns), FEES)

  it('dates every payment to the first of its month with source import', () => {
    expect(payload.year).toBe(2026)
    expect(payload.payments.every((p) => /^2026-\d{2}-01$/.test(p.paid_on))).toBe(true)
    expect(payload.payments.find((p) => p.apartment === 2 && p.amount === 2340)?.paid_on).toBe('2026-02-01')
    expect(payload.payments.some((p) => p.amount === 0)).toBe(false)
    expect(payload.payments.filter((p) => p.apartment === 2 && p.paid_on === '2026-09-01').map((p) => p.amount))
      .toEqual([330, 200])
  })

  it('turns the levy column into one levy charge per apartment plus payments in the levy month', () => {
    const levies = payload.charges.filter((c) => c.kind === 'levy')
    expect(levies.map((c) => [c.apartment, c.month, c.amount])).toEqual([
      [1, '2026-10-01', 500], [2, '2026-10-01', 500], [3, '2026-10-01', 500],
    ])
    expect(payload.payments.filter((p) => p.paid_on === '2026-10-01' && p.apartment === 3).map((p) => p.amount))
      .toEqual([600, 330])
  })

  it('makes EV entries into extra charges equal to matching payments', () => {
    const ev = payload.charges.filter((c) => c.kind === 'extra')
    expect(ev.map((c) => [c.apartment, c.month, c.amount, c.label])).toEqual([
      [3, '2026-01-01', 103.5, 'טעינת רכב חשמלי'],
      [3, '2026-02-01', 293.4, 'טעינת רכב חשמלי'],
      [3, '2026-04-01', 150, 'טעינת רכב חשמלי'],
    ])
    const evPaid = payload.payments.filter((p) => p.note.includes('טעינת רכב חשמלי')).reduce((s, p) => s + p.amount, 0)
    expect(evPaid).toBeCloseTo(546.9)
  })

  it('creates apartments once and every distinct resident', () => {
    expect(payload.apartments).toEqual([{ number: 1 }, { number: 2 }, { number: 3 }])
    expect(payload.residents.map((r) => [r.apartment, r.full_name])).toEqual([
      [1, 'דייר א'], [2, 'דייר ב'], [3, 'דייר ג'], [2, 'דיירת ב2'],
    ])
  })

  it('maps expense and budget categories, defaulting to creating them by name', () => {
    const p = buildImport(parsed(), withLevyMonth(income.columns), FEES, {
      categoryMap: { 'ניקיון חברה א': 'ניקיון' },
    })
    expect(p.expenses.filter((e) => e.category === 'ניקיון').map((e) => e.spent_on)).toEqual(['2026-01-01', '2026-02-01'])
    expect(p.categories).toEqual(['חברת ניהול', 'ניקיון', 'בנק', 'דמי ניהול', 'נקיון'])
    expect(p.budget_year).toBe(2025)
    expect(p.budgets).toEqual([{ category: 'דמי ניהול', amount: 20400 }, { category: 'נקיון', amount: 19200 }])
    expect(p.fees).toEqual(FEES)
  })

  it('re-bases every date when the admin edits the year', () => {
    const p = buildImport(parsed(), withLevyMonth(income.columns), [{ amount: 390, effective_from: '2026-01-01' }], {
      year: 2027,
    })
    const dates = [...p.payments.map((x) => x.paid_on), ...p.charges.map((x) => x.month), ...p.expenses.map((x) => x.spent_on)]
    expect(dates.every((d) => d.startsWith('2027-'))).toBe(true)
    expect(p.fees).toEqual([{ amount: 390, effective_from: '2027-01-01' }])
  })

  it('skips ignored columns and a levy column with no month yet', () => {
    const p = buildImport(parsed(), income.columns, FEES)
    expect(p.charges.some((c) => c.kind === 'levy')).toBe(false)
    expect(p.payments.some((p2) => p2.amount === 500)).toBe(false)
  })

  it('proposes the fee schedule from the most common amount per month', () => {
    expect(proposeFees(income, income.columns)).toEqual(FEES)
  })

  it('summarizes counts for the preview', () => {
    expect(summarize(payload)).toMatchObject({ apartments: 3, residents: 4, levies: 3, ev: 3, expenses: 8, budgets: 2 })
  })
})

describe('import guards', () => {
  it('prefills fees from the year\'s existing schedule when there is one', () => {
    const existing = [
      { effective_from: '2025-01-01', amount: 350 },
      { effective_from: '2026-03-01', amount: 400 },
      { effective_from: '2026-01-01', amount: 380 },
    ]
    expect(initialFees(existing, income, income.columns, 2026)).toEqual({
      fees: [{ amount: 380, effective_from: '2026-01-01' }, { amount: 400, effective_from: '2026-03-01' }], fromSystem: true,
    })
    expect(isExistingFee(existing, { amount: 380, effective_from: '2026-01-01' })).toBe(true)
    expect(isExistingFee(existing, { amount: 390, effective_from: '2026-01-01' })).toBe(false)
    expect(feesToReplace(existing, 2026)).toBe(2)
  })

  it('falls back to the sheet proposal when the year has no fees', () => {
    const existing = [{ effective_from: '2025-01-01', amount: 350 }]
    expect(initialFees(existing, income, income.columns, 2026)).toEqual({ fees: FEES, fromSystem: false })
    expect(feesToReplace(existing, 2026)).toBe(0)
  })

  it('finds imported expense cells that already have a non-imported expense in the same category and month', () => {
    const p = buildImport(parsed(), withLevyMonth(income.columns), FEES)
    const existing = [
      { category: 'חברת ניהול', spent_on: '2026-01-31', source: 'manual' },
      { category: 'בנק', spent_on: '2026-04-15', source: 'maintenance' },
      { category: 'בנק', spent_on: '2026-02-01', source: 'import' },
      { category: 'חשמל', spent_on: '2026-01-10', source: 'manual' },
    ]
    expect(findOverlaps(p.expenses, existing)).toEqual([
      { category: 'חברת ניהול', month: '2026-01', amount: 1800 },
      { category: 'בנק', month: '2026-04', amount: 44 },
    ])
  })

  it('skips overlapping cells and can leave out the EV charges (EV payments are always kept)', () => {
    const p = buildImport(parsed(), withLevyMonth(income.columns), FEES, {
      skipExpenses: [overlapKey('חברת ניהול', '2026-01')], includeEv: false,
    })
    expect(p.expenses.filter((e) => e.category === 'חברת ניהול').map((e) => e.spent_on)).toEqual(['2026-02-01', '2026-03-01'])
    expect(p.charges.some((c) => c.kind === 'extra')).toBe(false)
    expect(p.payments.some((x) => x.note === he.import.evNote)).toBe(true)
  })

  it('counts budget lines the import will overwrite', () => {
    const p = buildImport(parsed(), withLevyMonth(income.columns), FEES)
    expect(budgetUpdates(p.budgets, ['נקיון', 'חשמל'])).toBe(1)
  })
})

describe('payments overlap guard (re-importing an exported year)', () => {
  const pay = (apartment: number, paid_on: string, amount: number): PaymentRow => ({ apartment, paid_on, amount, note: 'x' })
  const payments = [pay(1, '2026-03-01', 400), pay(1, '2026-04-01', 390), pay(2, '2026-03-01', 390), pay(2, '2026-03-01', 50)]
  const existing = [
    { apartment: 1, paid_on: '2026-03-10', amount: 100, source: 'manual' },
    { apartment: 1, paid_on: '2026-04-01', amount: 390, source: 'import' },
    { apartment: 2, paid_on: '2026-03-01', amount: 50, source: 'ev-import' },
    { apartment: 2, paid_on: '2026-03-20', amount: 390, source: 'manual' },
  ]

  it('lists apartment-months whose file amount is already recorded by non-import payments', () => {
    expect(findPaymentOverlaps(payments, existing)).toEqual([
      { apartment: 1, month: '2026-03', amount: 400, recorded: 100 },
      { apartment: 2, month: '2026-03', amount: 440, recorded: 440 },
    ])
  })

  it('by default skips what is already recorded, importing only the rest of the cell', () => {
    const out = skipRecorded(payments, findPaymentOverlaps(payments, existing))
    expect(out).toEqual([pay(1, '2026-03-01', 300), pay(1, '2026-04-01', 390)])
  })

  it('counts the previous import\'s levy and EV charges a file without them would remove', () => {
    const charges = [
      { apartment: 1, month: '2026-05-01', kind: 'levy', source: 'import' },
      { apartment: 2, month: '2026-05-01', kind: 'levy', source: 'import' },
      { apartment: 2, month: '2026-05-01', kind: 'levy', source: 'manual' },
      { apartment: 1, month: '2026-02-01', kind: 'extra', source: 'import' },
      { apartment: 3, month: '2026-02-01', kind: 'extra', source: 'import' },
    ]
    expect(priorCharges(charges, [], [3])).toEqual({ levy: 2, ev: 1 })
    expect(priorCharges(charges, ['levy'], [3])).toEqual({ levy: 0, ev: 1 })
  })

  it('keeps prior levies by default in the payload', () => {
    expect(buildImport(parsed(), withLevyMonth(income.columns), FEES).keep_prior_levies).toBe(true)
    expect(buildImport(parsed(), withLevyMonth(income.columns), FEES, { keepPrior: false }).keep_prior_levies).toBe(false)
  })
})

describe('exempt hint', () => {
  const withRows = {
    ...income,
    apartments: [
      ...income.apartments,
      { number: 4, name: 'דייר ד', phone: '', cells: {} },
      // Only an ignored column (the total) has a value: still nothing paid in a month.
      { number: 5, name: 'דייר ה', phone: '', cells: { 17: 100 } },
    ],
  }

  it('flags apartments with no payment in any month column, across all their rows', () => {
    expect(likelyExempt(withRows, withRows.columns)).toEqual([4, 5])
    expect(likelyExempt(income, income.columns)).toEqual([])
  })

  it('sends the confirmed exempt apartments with the payload (none by default)', () => {
    expect(buildImport(parsed(), income.columns, FEES).exempt).toEqual([])
    expect(buildImport(parsed(), income.columns, FEES, { exempt: [3] }).exempt).toEqual([3])
  })
})
