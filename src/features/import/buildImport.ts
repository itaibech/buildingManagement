// Turns the parsed workbook plus the admin's confirmed choices into the payload for rpc('import_year').
// Every date is re-based onto the confirmed year, so the RPC can replace exactly that year's imported rows.
import { he } from '../../lib/he'
import { mode, type BudgetSheet, type ColumnMap, type ExpenseRow, type IncomeSheet } from './parseWorkbook'

export interface ParsedWorkbook { income: IncomeSheet; expenses: ExpenseRow[]; budget: BudgetSheet }
export type FeeEntry = { amount: number; effective_from: string }
export interface ImportOptions {
  year?: number
  budgetYear?: number
  categoryMap?: Record<string, string>
  /** overlapKey(category, month) of imported expense cells to leave out. */
  skipExpenses?: string[]
  /** Import the EV block's charges (default true). Its payments are real money and are always imported. */
  includeEv?: boolean
  /** Apartment numbers the admin confirmed as exempt from the fee (from January of the import year). */
  exempt?: number[]
  /** Keep the previous import's levy / EV charges when the file has none of them (default true). */
  keepPrior?: boolean
}
export type PaymentRow = { apartment: number; paid_on: string; amount: number; note: string }
export type ChargeRow = { apartment: number; month: string; amount: number; kind: 'levy' | 'extra'; label: string }
export type ImportPayload = {
  year: number
  budget_year: number
  apartments: { number: number }[]
  residents: { apartment: number; full_name: string; phone: string }[]
  fees: FeeEntry[]
  payments: PaymentRow[]
  charges: ChargeRow[]
  categories: string[]
  expenses: { category: string; spent_on: string; amount: number; note: string }[]
  budgets: { category: string; amount: number }[]
  exempt: number[]
  /** Server: a charge kind the payload has no rows of keeps the previous import's rows (default true). */
  keep_prior_levies: boolean
}

/** 'YYYY-MM' or 'YYYY-MM-DD' to the first of that month in the given year. */
const rebase = (month: string, year: number): string => `${year}-${month.slice(5, 7)}-01`
const unique = <T>(xs: T[]): T[] => [...new Set(xs)]

/** The month a column's cells are paid in, or null when the column is ignored / not dated yet. */
function columnMonth(c: ColumnMap): string | null {
  if (c.proposal.kind === 'month') return c.proposal.month
  if (c.proposal.kind === 'levy') return c.proposal.month
  return null
}

function paymentsFrom(income: IncomeSheet, columns: ColumnMap[], year: number): PaymentRow[] {
  const out: PaymentRow[] = []
  for (const a of income.apartments) {
    for (const c of columns) {
      const month = columnMonth(c)
      const amount = a.cells[c.col]
      if (month && amount > 0) out.push({ apartment: a.number, paid_on: rebase(month, year), amount, note: he.import.paymentNote })
    }
  }
  return out
}

function leviesFrom(numbers: number[], columns: ColumnMap[], year: number): ChargeRow[] {
  return columns.flatMap((c) => {
    const p = c.proposal
    if (p.kind !== 'levy' || !p.month || !p.amount || p.amount <= 0) return []
    const month = rebase(p.month, year)
    const amount = p.amount
    return numbers.map((apartment): ChargeRow => ({ apartment, month, amount, kind: 'levy', label: he.import.levyLabel }))
  })
}

/** EV charging: one extra charge per month equal to what was paid, plus that payment, so EV nets to zero. */
function evFrom(income: IncomeSheet, year: number): { charges: ChargeRow[]; payments: PaymentRow[] } {
  const charges: ChargeRow[] = []
  const payments: PaymentRow[] = []
  for (const { apartment, byMonth } of income.ev) {
    for (const [m, amount] of Object.entries(byMonth).sort(([x], [y]) => x.localeCompare(y))) {
      const month = rebase(m, year)
      charges.push({ apartment, month, amount, kind: 'extra', label: he.import.evLabel })
      payments.push({ apartment, paid_on: month, amount, note: he.import.evNote })
    }
  }
  return { charges, payments }
}

function residentsFrom(income: IncomeSheet): ImportPayload['residents'] {
  const seen = new Set<string>()
  const out: ImportPayload['residents'] = []
  for (const a of income.apartments) {
    const key = `${a.number}|${a.name}`
    if (a.name === '' || seen.has(key)) continue
    seen.add(key)
    out.push({ apartment: a.number, full_name: a.name.slice(0, 200), phone: a.phone.slice(0, 50) })
  }
  return out
}

function budgetsFrom(budget: BudgetSheet, cat: (name: string) => string): ImportPayload['budgets'] {
  const sums = new Map<string, number>()
  for (const i of budget.items) sums.set(cat(i.category), (sums.get(cat(i.category)) ?? 0) + i.amount)
  return [...sums].map(([category, amount]) => ({ category, amount }))
}

export function buildImport(parsed: ParsedWorkbook, columns: ColumnMap[], fees: FeeEntry[], opts: ImportOptions = {}): ImportPayload {
  const year = opts.year ?? parsed.income.year
  const cat = (name: string): string => opts.categoryMap?.[name] ?? name
  const numbers = unique(parsed.income.apartments.map((a) => a.number))
  const evAll = evFrom(parsed.income, year)
  const ev = opts.includeEv === false ? { charges: [], payments: evAll.payments } : evAll
  const skip = new Set(opts.skipExpenses ?? [])
  const expenses = parsed.expenses.flatMap((r) =>
    Object.entries(r.byMonth).map(([m, amount]) => ({ category: cat(r.category), spent_on: rebase(m, year), amount, note: he.import.expenseNote })))
    .filter((e) => !skip.has(overlapKey(e.category, e.spent_on)))
  const budgets = budgetsFrom(parsed.budget, cat)
  return {
    year,
    budget_year: opts.budgetYear ?? parsed.budget.year,
    apartments: numbers.map((number) => ({ number })),
    residents: residentsFrom(parsed.income),
    fees: fees.map((f) => ({ amount: f.amount, effective_from: rebase(f.effective_from, year) })),
    payments: [...paymentsFrom(parsed.income, columns, year), ...ev.payments],
    charges: [...leviesFrom(numbers, columns, year), ...ev.charges],
    categories: unique([...expenses.map((e) => e.category), ...budgets.map((b) => b.category)]),
    expenses,
    budgets,
    exempt: unique(opts.exempt ?? []).filter((n) => numbers.includes(n)),
    keep_prior_levies: opts.keepPrior ?? true,
  }
}

/** Apartments that paid nothing in any month or levy column all year (every row of theirs): maybe exempt. */
export function likelyExempt(income: IncomeSheet, columns: ColumnMap[]): number[] {
  const dated = columns.filter((c) => columnMonth(c) !== null).map((c) => c.col)
  const paid = new Set(income.apartments.filter((a) => dated.some((col) => (a.cells[col] ?? 0) > 0)).map((a) => a.number))
  return unique(income.apartments.map((a) => a.number)).filter((n) => !paid.has(n)).sort((a, b) => a - b)
}

/** Fee schedule guess: the most common amount in each month column, with an entry whenever it changes. */
export function proposeFees(income: IncomeSheet, columns: ColumnMap[]): FeeEntry[] {
  const months = columns
    .flatMap((c) => (c.proposal.kind === 'month' ? [{ col: c.col, month: c.proposal.month }] : []))
    .sort((a, b) => a.month.localeCompare(b.month))
  const out: FeeEntry[] = []
  for (const { col, month } of months) {
    const amount = mode(income.apartments.map((a) => a.cells[col] ?? 0))
    if (amount !== undefined && amount !== out.at(-1)?.amount) out.push({ amount, effective_from: `${month}-01` })
  }
  return out
}

export interface ImportSummary {
  apartments: number; residents: number; payments: number; paymentsTotal: number
  levies: number; ev: number; expenses: number; categories: number; budgets: number
}

/** Preview counts. `existing` category names are not counted as new. */
export function summarize(p: ImportPayload, existing: string[] = []): ImportSummary {
  return {
    apartments: p.apartments.length,
    residents: p.residents.length,
    payments: p.payments.length,
    paymentsTotal: p.payments.reduce((s, x) => s + x.amount, 0),
    levies: p.charges.filter((c) => c.kind === 'levy').length,
    ev: p.charges.filter((c) => c.kind === 'extra').length,
    expenses: p.expenses.length,
    categories: p.categories.filter((c) => !existing.includes(c)).length,
    budgets: p.budgets.length,
  }
}

/** Category choice meaning "create a new category with the row's own name". */
export const NEW_CATEGORY = '__new__'
/** Columns are ready when every levy column has a month. */
export const columnsReady = (cols: ColumnMap[]): boolean =>
  cols.every((c) => c.proposal.kind !== 'levy' || c.proposal.month !== null)
export const feesReady = (fees: FeeEntry[]): boolean => fees.length > 0
export const yearValid = (y: number): boolean => Number.isInteger(y) && y >= 2000 && y <= 2100

// ---------------------------------------------------------------- guards against overwriting or double counting

export type ExistingFee = { effective_from: string; amount: number }
export type ExistingExpense = { category: string; spent_on: string; source: string }
export interface Overlap { category: string; month: string; amount: number }

const inYear = (existing: ExistingFee[], year: number): FeeEntry[] => existing
  .filter((f) => f.effective_from.startsWith(`${year}-`))
  .map((f) => ({ amount: f.amount, effective_from: f.effective_from.slice(0, 10) }))
  .sort((a, b) => a.effective_from.localeCompare(b.effective_from))

/** Fees step prefill: the year's schedule already in the system when it has rows, else the sheet's proposal. */
export function initialFees(existing: ExistingFee[], income: IncomeSheet, columns: ColumnMap[], year: number): { fees: FeeEntry[]; fromSystem: boolean } {
  const current = inYear(existing, year)
  if (current.length > 0) return { fees: current, fromSystem: true }
  const proposed = proposeFees(income, columns)
  return { fees: proposed.length > 0 ? proposed : [{ amount: 0, effective_from: `${year}-01-01` }], fromSystem: false }
}

export const isExistingFee = (existing: ExistingFee[], f: FeeEntry): boolean =>
  existing.some((e) => e.effective_from.slice(0, 10) === f.effective_from && e.amount === f.amount)
/** How many fee_schedule rows of that year the import replaces. */
export const feesToReplace = (existing: ExistingFee[], year: number): number => inYear(existing, year).length
/** How many budget lines (by category) the import overwrites. */
export const budgetUpdates = (budgets: ImportPayload['budgets'], existing: string[]): number =>
  budgets.filter((b) => existing.includes(b.category)).length

export const overlapKey = (category: string, monthOrDate: string): string => `${category}|${monthOrDate.slice(0, 7)}`

/** Imported expense cells whose category and month already have a non-imported expense (manual, template, maintenance). */
export function findOverlaps(expenses: ImportPayload['expenses'], existing: ExistingExpense[]): Overlap[] {
  const taken = new Set(existing.filter((e) => e.source !== 'import').map((e) => overlapKey(e.category, e.spent_on)))
  return expenses
    .filter((e) => taken.has(overlapKey(e.category, e.spent_on)))
    .map((e) => ({ category: e.category, month: e.spent_on.slice(0, 7), amount: e.amount }))
}

// ---------------------------------------------------------------- payments already recorded (re-importing an export)

export type ExistingPayment = { apartment: number; paid_on: string; amount: number; source: string }
export type ExistingCharge = { apartment: number; month: string; kind: string; source: string }
export interface PaymentOverlap { apartment: number; month: string; amount: number; recorded: number }

const payKey = (apartment: number, date: string): string => `${apartment}|${date.slice(0, 7)}`
const cents = (n: number): number => Math.round(n * 100) / 100

function sumBy<T>(rows: T[], key: (r: T) => string, amount: (r: T) => number): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) out.set(key(r), (out.get(key(r)) ?? 0) + amount(r))
  return out
}

/**
 * Apartment-months the file pays in that already hold non-import payments (manual, EV import). An exported
 * year sums every source into one cell, so importing it whole would count that money twice.
 */
export function findPaymentOverlaps(payments: PaymentRow[], existing: ExistingPayment[]): PaymentOverlap[] {
  const recorded = sumBy(existing.filter((e) => e.source !== 'import'), (e) => payKey(e.apartment, e.paid_on), (e) => e.amount)
  const inFile = sumBy(payments, (p) => payKey(p.apartment, p.paid_on), (p) => p.amount)
  return [...inFile].flatMap(([key, amount]) => {
    const r = recorded.get(key)
    if (r === undefined) return []
    const [apartment, month] = key.split('|')
    return [{ apartment: Number(apartment), month: month ?? '', amount: cents(amount), recorded: cents(r) }]
  })
}

/** The default for overlaps: leave out what is already recorded, importing only the rest of each cell. */
export function skipRecorded(payments: PaymentRow[], overlaps: PaymentOverlap[]): PaymentRow[] {
  const left = new Map(overlaps.map((o) => [`${o.apartment}|${o.month}`, o.recorded]))
  return payments.flatMap((p) => {
    const key = payKey(p.apartment, p.paid_on)
    const skip = Math.min(left.get(key) ?? 0, p.amount)
    if (skip > 0) left.set(key, cents((left.get(key) ?? 0) - skip))
    const amount = cents(p.amount - skip)
    return amount > 0 ? [{ ...p, amount }] : []
  })
}

/**
 * What the file's payments become: standing-order months (source 'auto', the system's record of money collected)
 * are always left out, even when the admin opts in; other recorded payments are left out unless `importPaid`.
 * `paid`: the non-auto overlaps (the notice); `autoSkipped`: apartment-months already paid by standing order.
 */
export function guardPayments(payments: PaymentRow[], existing: ExistingPayment[], importPaid: boolean): { payments: PaymentRow[]; paid: PaymentOverlap[]; autoSkipped: number } {
  const auto = findPaymentOverlaps(payments, existing.filter((e) => e.source === 'auto'))
  const rest = auto.length === 0 ? payments : skipRecorded(payments, auto)
  const paid = findPaymentOverlaps(rest, existing.filter((e) => e.source !== 'auto'))
  return { payments: importPaid || paid.length === 0 ? rest : skipRecorded(rest, paid), paid, autoSkipped: auto.length }
}

/**
 * The previous import's charges a re-import would remove because the file has none of that kind
 * (`kinds` = the kinds the file brings). EV charges of apartments with a charger are never touched.
 */
export function priorCharges(existing: ExistingCharge[], kinds: string[], chargerNumbers: number[]): { levy: number; ev: number } {
  const imported = existing.filter((c) => c.source === 'import' && !kinds.includes(c.kind))
  return {
    levy: imported.filter((c) => c.kind === 'levy').length,
    ev: imported.filter((c) => c.kind === 'extra' && !chargerNumbers.includes(c.apartment)).length,
  }
}
