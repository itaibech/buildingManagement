/**
 * Pure helpers for "דוח שנתי" (the yearly assembly report). Built only from what the finance pages already read:
 * budget_summary, building_expense_report, budget_for_year, collection_summary and, for admins, the ledger, the
 * charges, the building cash and the cash flows. Money adds up in agorot. No I/O here.
 */
import { formatDate, HEBREW_MONTHS, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import type { Cell, Rows } from '../export/buildWorkbook'
import type { BudgetSummary } from './budget'
import type { CashFlow, Collection, ExpenseReportRow } from './api'
import { monthTotals } from './expenseReport'
import { monthOf, toLedgerGrid, yearMonths, type BudgetRow, type LedgerRow } from './ledger'
import type { ChargeLine } from './settlement'

const ag = (n: number): number => Math.round(n * 100)
const ils = (agorot: number): number => agorot / 100
const sumAg = (values: readonly number[]): number => values.reduce((t, v) => t + ag(v), 0)

export interface IncomeBuckets { fees: number; levies: number; ev: number; other: number; total: number }

/**
 * What the year billed, by kind (the same split as "הרכב החוב"): EV charging, levies and special charges
 * ("השתתפות עצמית"), other extras, and the monthly fees as the rest of each month's charges. Write-offs and opening
 * balances are not income. Only months the ledger has (through the current month) count.
 */
export function incomeBuckets(ledger: readonly LedgerRow[], charges: readonly ChargeLine[], year: number): IncomeBuckets {
  const prefix = `${year}-`
  const rows = ledger.filter((r) => r.month.startsWith(prefix))
  const months = new Set(rows.map((r) => r.month))
  const own = charges.filter((c) => months.has(c.month) && c.kind !== 'adjustment')
  const pick = (f: (c: ChargeLine) => boolean): number => sumAg(own.filter(f).map((c) => c.amount))
  const ev = pick((c) => c.ev)
  const levies = pick((c) => !c.ev && (!!c.special || c.kind === 'levy'))
  const other = pick((c) => !c.ev && !c.special && c.kind === 'extra')
  const gross = rows.reduce((t, r) => t + ag(r.charged) - ag(r.adjusted ?? 0), 0)
  const fees = gross - pick(() => true)
  return { fees: ils(fees), levies: ils(levies), ev: ils(ev), other: ils(other), total: ils(fees + levies + ev + other) }
}

export interface CategoryYear { categoryId: string; category: string; months: number[]; total: number }
export interface ExpenseTable { months: string[]; categories: CategoryYear[]; monthTotals: number[]; total: number }

/** Expenses by category (report order) with the twelve monthly totals, plus each month's and the year's total. */
export function expenseTable(rows: readonly ExpenseReportRow[], year: number): ExpenseTable {
  const months = yearMonths(year)
  const by = new Map<string, { categoryId: string; category: string; months: number[] }>()
  for (const r of rows) {
    const i = months.indexOf(r.month)
    if (i < 0) continue
    const c = by.get(r.categoryId) ?? { categoryId: r.categoryId, category: r.category, months: months.map(() => 0) }
    c.months[i] = (c.months[i] ?? 0) + ag(r.total)
    by.set(r.categoryId, c)
  }
  const categories = [...by.values()].map((c) => ({ ...c, months: c.months.map(ils), total: ils(c.months.reduce((t, v) => t + v, 0)) }))
  const totals = monthTotals(rows, year).map((t) => t.total)
  return { months, categories, monthTotals: totals, total: ils(sumAg(totals)) }
}

export interface BudgetLineReport { category: string; planned: number; actual: number; variance: number; used: number | null }
export interface BudgetReport { lines: BudgetLineReport[]; planned: number; actual: number; variance: number }

/** Planned vs actual per category: variance = planned − actual (below 0 is over budget), used = actual / planned in %. */
export function budgetReport(rows: readonly BudgetRow[]): BudgetReport {
  const lines = rows.map((r) => ({
    category: r.category, planned: r.planned, actual: r.actual, variance: ils(ag(r.planned) - ag(r.actual)),
    used: r.planned > 0 ? Math.round((r.actual / r.planned) * 100) : null,
  }))
  const planned = sumAg(rows.map((r) => r.planned))
  const actual = sumAg(rows.map((r) => r.actual))
  return { lines, planned: ils(planned), actual: ils(actual), variance: ils(planned - actual) }
}

export interface CashInput { today: number; openingDate: string | null; payments: readonly CashFlow[]; expenses: readonly CashFlow[] }
export interface FundBalance {
  /** The date the start balance is for: 1 January, or the opening-cash date when tracking began later that year. */
  startDate: string
  start: number
  /** The date the end balance is for: 31 December, or today for the current year. */
  endDate: string
  end: number
  endIsToday: boolean
  change: number
}

/** The cash first thing on `date`: today's cash with every payment and expense from that date through today undone. */
function cashOn(cash: CashInput, date: string): number {
  const inflow = sumAg(cash.payments.filter((p) => p.date >= date).map((p) => p.amount))
  const outflow = sumAg(cash.expenses.filter((e) => e.date >= date).map((e) => e.amount))
  return ag(cash.today) - inflow + outflow
}

const nextDay = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * The fund at the start and end of `year`, rolled back from today's cash (building_cash_balance's rule: opening cash
 * plus payments minus expenses from the opening-cash date through today). Null for a future year or one that ended
 * before the cash was tracked.
 */
export function fundBalance(cash: CashInput, year: number, today: string): FundBalance | null {
  const first = `${year}-01-01`
  const last = `${year}-12-31`
  if (first > today || (cash.openingDate !== null && cash.openingDate > last)) return null
  const startDate = cash.openingDate !== null && cash.openingDate > first ? cash.openingDate : first
  const endIsToday = last >= today
  const start = cashOn(cash, startDate)
  const end = endIsToday ? ag(cash.today) : cashOn(cash, nextDay(last))
  return { startDate, start: ils(start), endDate: endIsToday ? today : last, end: ils(end), endIsToday, change: ils(end - start) }
}

/** collection_summary's month: admins get the end of a past year; residents always get this month (the server's rule). */
export function collectionMonthFor(year: number, admin: boolean, today: string): string {
  return admin && year < Number(today.slice(0, 4)) ? `${year}-12-01` : monthOf(today)
}

export interface CollectionReport { month: string; total: number; paidUp: number; owing: number }

/** Paid up vs owing as counts only (collection_summary; the amount due is left out of the report). */
export const collectionReport = (c: Collection, month: string): CollectionReport =>
  ({ month, total: c.total, paidUp: c.paidUp, owing: Math.max(c.total - c.paidUp, 0) })

export interface AppendixRow { number: number; charged: number; paid: number; balance: number }

/** Admin appendix: each apartment's year (charged, paid) and its balance at the end of the year, by number. */
export function apartmentAppendix(ledger: LedgerRow[], year: number, numbers: ReadonlyMap<string, number>): AppendixRow[] {
  const { byApartment } = toLedgerGrid(ledger, year)
  return [...byApartment.entries()].flatMap(([id, g]) => {
    const number = numbers.get(id)
    if (number === undefined) return []
    return [{ number, charged: ils(sumAg(g.cells.map((c) => c.charged))), paid: ils(sumAg(g.cells.map((c) => c.paid))), balance: g.balance }]
  }).sort((a, b) => a.number - b.number)
}

/** Admin-only inputs: the per-apartment ledger, the charges, the cash. Never passed for residents. */
export interface AdminInput { ledger: LedgerRow[]; charges: ChargeLine[]; cash: CashInput | null; numbers: ReadonlyMap<string, number> }

export interface AnnualInput {
  year: number
  today: string
  admin: boolean
  summary: BudgetSummary
  expenses: readonly ExpenseReportRow[]
  budget: readonly BudgetRow[]
  collection: Collection
  collectionMonth: string
  adminData: AdminInput | null
  withAppendix: boolean
}

export interface AnnualReport {
  year: number
  /** Billed by kind (admins); residents get the expected income only. */
  income: IncomeBuckets | null
  expectedIncome: number
  /** Received this year (budget_summary, without EV payments): admins only. */
  receivedIncome: number | null
  expenses: ExpenseTable
  budget: BudgetReport
  /** Admins only (building cash). */
  fund: FundBalance | null
  collection: CollectionReport
  /** Admins only, and only when asked for. */
  appendix: AppendixRow[] | null
}

/** The whole report. Non-admins never get the cash, the income split, the received total or the per-apartment appendix. */
export function buildAnnualReport(input: AnnualInput): AnnualReport {
  const admin = input.admin ? input.adminData : null
  return {
    year: input.year,
    income: admin ? incomeBuckets(admin.ledger, admin.charges, input.year) : null,
    expectedIncome: input.summary.expectedIncome,
    receivedIncome: admin ? input.summary.actualIncome : null,
    expenses: expenseTable(input.expenses, input.year),
    budget: budgetReport(input.budget),
    fund: admin?.cash ? fundBalance(admin.cash, input.year, input.today) : null,
    collection: collectionReport(input.collection, input.collectionMonth),
    appendix: admin && input.withAppendix ? apartmentAppendix(admin.ledger, input.year, admin.numbers) : null,
  }
}

// ---------------------------------------------------------------- Excel: the same tables as the report

const A = he.annual

function incomeRows(r: AnnualReport): Rows {
  const rows: Rows = [[A.income.kind, A.income.amount]]
  if (r.income) {
    const i = r.income
    rows.push([A.income.fees, i.fees], [A.income.levies, i.levies], [A.income.ev, i.ev], [A.income.other, i.other], [A.income.total, i.total])
  }
  rows.push([A.income.expected, r.expectedIncome])
  if (r.receivedIncome !== null) rows.push([A.income.received, r.receivedIncome])
  return rows
}

function expenseRows(t: ExpenseTable): Rows {
  return [
    [A.expenses.category, ...HEBREW_MONTHS, A.expenses.total],
    ...t.categories.map((c): Cell[] => [c.category, ...c.months, c.total]),
    [A.expenses.monthTotal, ...t.monthTotals, t.total],
  ]
}

function budgetRows(b: BudgetReport): Rows {
  return [
    [A.budget.category, A.budget.planned, A.budget.actual, A.budget.variance, A.budget.used],
    ...b.lines.map((l): Cell[] => [l.category, l.planned, l.actual, l.variance, l.used === null ? null : A.budget.usedPct(l.used)]),
    [A.budget.total, b.planned, b.actual, b.variance, null],
  ]
}

function fundRows(f: FundBalance): Rows {
  return [
    [A.fund.start(formatDate(f.startDate)), f.start],
    [f.endIsToday ? A.fund.today(formatDate(f.endDate)) : A.fund.end(formatDate(f.endDate)), f.end],
    [A.fund.change, f.change],
  ]
}

/** One sheet per report section; the cash and the appendix only when the report has them, the notes when written. */
export function annualSheets(r: AnnualReport, notes: string): Record<string, Rows> {
  const S = A.sheets
  const c = r.collection
  const sheets: Record<string, Rows> = {
    [S.income]: incomeRows(r),
    [S.expenses]: expenseRows(r.expenses),
    [S.budget]: budgetRows(r.budget),
  }
  if (r.fund) sheets[S.fund] = fundRows(r.fund)
  sheets[S.collection] = [[A.collection.asOf(monthLabel(c.month))], [A.collection.total, c.total], [A.collection.paidUp, c.paidUp], [A.collection.owing, c.owing]]
  if (notes.trim()) sheets[S.notes] = [[A.notes.title], [notes.trim()]]
  if (r.appendix) {
    const H = A.appendix
    sheets[S.appendix] = [[H.apartment, H.charged, H.paid, H.balance], ...r.appendix.map((a): Cell[] => [a.number, a.charged, a.paid, a.balance])]
  }
  return sheets
}
