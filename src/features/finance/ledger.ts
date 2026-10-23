/** Pure finance helpers: ledger grid, budget vs actual, month arithmetic. No I/O here. */

export interface LedgerRow {
  apartment_id: string
  /** First of the month, YYYY-MM-DD. */
  month: string
  charged: number
  paid: number
}

export interface LedgerCell {
  charged: number
  paid: number
}

export interface ApartmentGrid {
  cells: LedgerCell[]
  /** Charged minus paid over every row up to the end of the year (earlier years included). */
  balance: number
}

const pad = (n: number): string => String(n).padStart(2, '0')
/** Rounds to agorot so float sums don't print as 0.30000000000000004. */
const money = (n: number): number => Math.round(n * 100) / 100

/** The 12 first-of-month dates of `year`. */
export function yearMonths(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}-01`)
}

/** Month grid per apartment for `year`, with zeros where nothing was recorded. */
export function toLedgerGrid(rows: LedgerRow[], year: number): { months: string[]; byApartment: Map<string, ApartmentGrid> } {
  const months = yearMonths(year)
  const byApartment = new Map<string, ApartmentGrid>()
  for (const row of rows) {
    const rowYear = Number(row.month.slice(0, 4))
    if (rowYear > year) continue
    let entry = byApartment.get(row.apartment_id)
    if (!entry) {
      entry = { cells: months.map(() => ({ charged: 0, paid: 0 })), balance: 0 }
      byApartment.set(row.apartment_id, entry)
    }
    entry.balance = money(entry.balance + row.charged - row.paid)
    if (rowYear === year) {
      const cell = entry.cells[Number(row.month.slice(5, 7)) - 1]
      if (cell) {
        cell.charged = money(cell.charged + row.charged)
        cell.paid = money(cell.paid + row.paid)
      }
    }
  }
  return { months, byApartment }
}

export interface BudgetLine {
  year: number
  category: string
  amount: number
}

export interface ExpenseLine {
  category: string
  spent_on: string
  amount: number
}

export interface BudgetRow {
  category: string
  planned: number
  actual: number
}

/** Planned vs spent per category for `year`: budgeted categories first (in input order), then unbudgeted spending. */
export function budgetVsActual(budgets: BudgetLine[], expenses: ExpenseLine[], year: number): BudgetRow[] {
  const rows = new Map<string, BudgetRow>()
  for (const b of budgets) {
    if (b.year !== year) continue
    const row = rows.get(b.category) ?? { category: b.category, planned: 0, actual: 0 }
    row.planned = money(row.planned + b.amount)
    rows.set(b.category, row)
  }
  const prefix = `${year}-`
  for (const e of expenses) {
    if (!e.spent_on.startsWith(prefix)) continue
    const row = rows.get(e.category) ?? { category: e.category, planned: 0, actual: 0 }
    row.actual = money(row.actual + e.amount)
    rows.set(e.category, row)
  }
  return [...rows.values()]
}

/** Largest debt first; ties keep their order. */
export function sortByDebt<T extends { balance: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.balance - a.balance)
}

/** First of the month for a YYYY-MM-DD date. */
export function monthOf(date: string): string {
  return `${date.slice(0, 7)}-01`
}

/** Moves a first-of-month date by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01`
}

export type BalanceState = 'owed' | 'settled' | 'credit'

/** Design-system balance rule: > 0 owed, 0 settled, < 0 credit. */
export function balanceState(balance: number): BalanceState {
  if (balance > 0) return 'owed'
  return balance < 0 ? 'credit' : 'settled'
}

export const RECEIPT_BUCKET = 'receipts'
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024

/** Receipt mimetypes we accept and the extension each is stored under. */
export const RECEIPT_EXT: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

/** `<expense_id>/<uuid>.<ext>` inside the receipts bucket, or null for a mimetype we don't accept. */
export function receiptPath(expenseId: string, mime: string, id: string = crypto.randomUUID()): string | null {
  const ext = Object.hasOwn(RECEIPT_EXT, mime) ? RECEIPT_EXT[mime] : undefined
  return ext ? `${expenseId}/${id}.${ext}` : null
}
