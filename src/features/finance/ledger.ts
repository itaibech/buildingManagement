/** Pure finance helpers: ledger grid, budget vs actual, month arithmetic. No I/O here. */
import { formatILS, HEBREW_MONTHS } from '../../lib/format'
import { he } from '../../lib/he'
import type { ApartmentBalance } from './api'

export interface LedgerRow {
  apartment_id: string
  /** First of the month, YYYY-MM-DD. */
  month: string
  charged: number
  paid: number
  /** The month's write-offs ("מחיקת חוב", <= 0), already inside `charged`. */
  adjusted?: number
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

export type BalanceSort = 'number' | 'amount'
export const BALANCE_SORTS: readonly BalanceSort[] = ['number', 'amount']
export const isBalanceSort = (v: unknown): v is BalanceSort => BALANCE_SORTS.some((s) => s === v)

/** 'number': by apartment number. 'amount': largest debt first (credits last), ties by apartment number. A copy. */
export function sortBalances<T extends { number: number; balance: number }>(rows: readonly T[], sort: BalanceSort): T[] {
  const byNumber = (a: T, b: T): number => a.number - b.number
  return [...rows].sort(sort === 'number' ? byNumber : (a, b) => b.balance - a.balance || byNumber(a, b))
}

/** The month's Hebrew name for a YYYY-MM-DD date ("נובמבר"). */
export const monthName = (month: string): string => HEBREW_MONTHS[Number(month.slice(5, 7)) - 1] ?? month

/** First of the month for a YYYY-MM-DD date. */
export function monthOf(date: string): string {
  return `${date.slice(0, 7)}-01`
}

/** Moves a first-of-month date by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + delta
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}-01`
}

/** Month options for a month-name select: value "01"…"12". */
export const MONTH_DATA = HEBREW_MONTHS.map((name, i) => ({ value: String(i + 1).padStart(2, '0'), label: name }))

/** Years to offer, newest first: back to the earliest expense, always including this year and the month on screen. */
export function exportYears(firstYear: number | null, currentYear: number, shownYear: number): number[] {
  const from = Math.min(firstYear ?? currentYear, currentYear, shownYear)
  const to = Math.max(currentYear, shownYear)
  return Array.from({ length: to - from + 1 }, (_, i) => to - i)
}

export type BalanceState = 'owed' | 'settled' | 'credit'

/** Design-system balance rule: > 0 owed, 0 settled, < 0 credit. */
export function balanceState(balance: number): BalanceState {
  if (balance > 0) return 'owed'
  return balance < 0 ? 'credit' : 'settled'
}

export const RECEIPT_BUCKET = 'receipts'
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024

/** Receipt mimetypes we accept and the extension each is stored under (0018's path rule whitelists the same set). */
export const RECEIPT_EXT: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}

/** The file picker's `accept`: any image (unsupported ones get a Hebrew error), PDF and Word. */
export const RECEIPT_ACCEPT = 'image/*,application/pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  jpeg: 'image/jpeg', ...Object.fromEntries(Object.entries(RECEIPT_EXT).map(([mime, ext]) => [ext, mime])),
}

/** The whitelisted mimetype to store the file under, or null. Some systems give HEIC and Word files no type: use the name then. */
export function receiptMime(file: Pick<File, 'name' | 'type'>): string | null {
  if (Object.hasOwn(RECEIPT_EXT, file.type)) return file.type
  if (file.type !== '' && file.type !== 'application/octet-stream') return null
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return Object.hasOwn(MIME_BY_EXT, ext) ? (MIME_BY_EXT[ext] ?? null) : null
}

/** `<expense_id>/<uuid>.<ext>` inside the receipts bucket, or null for a mimetype we don't accept. */
export function receiptPath(expenseId: string, mime: string, id: string = crypto.randomUUID()): string | null {
  const ext = Object.hasOwn(RECEIPT_EXT, mime) ? RECEIPT_EXT[mime] : undefined
  return ext ? `${expenseId}/${id}.${ext}` : null
}

/** "הכול שולם" / "יתרה לתשלום ₪X" / "זיכוי ₪X". */
export function balanceSentence(balance: number): string {
  const state = balanceState(balance)
  if (state === 'settled') return he.home.allPaid
  return state === 'owed' ? he.home.balanceDue(formatILS(balance)) : he.finance.creditOf(formatILS(Math.abs(balance)))
}

/** The hero's line under the big amount, without repeating it: "יתרה לתשלום", or "הכול שולם" (also beside a credit). */
export function heroState(balance: number): string {
  return balanceState(balance) === 'owed' ? he.home.owed : he.home.allPaid
}

/** Hebrew error for a receipt we won't accept, or null. */
export function receiptError(file: File): string | null {
  if (!receiptMime(file)) return he.finance.errors.receiptType
  return file.size > MAX_RECEIPT_BYTES ? he.finance.errors.receiptSize : null
}

/** Whether a balance row carries any badge (exempt, committee, standing order). */
export const hasBadges = (row: Pick<ApartmentBalance, 'feeMode' | 'isCommittee' | 'standingOrder'>): boolean =>
  row.feeMode === 'exempt' || row.isCommittee || row.standingOrder
