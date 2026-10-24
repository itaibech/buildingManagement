// Pure builders for Excel exports. Sheets are plain row arrays (no SheetJS here) so they are easy to test;
// exportXlsx.ts turns them into a file. The year workbook mirrors the layout the importer reads.
import { formatDate } from '../../lib/format'
import { HEBREW_MONTHS, he } from '../../lib/he'
import type { ApartmentBalance, Budget, Expense, Payment } from '../finance/api'
import { toLedgerGrid, type BudgetRow, type LedgerRow } from '../finance/ledger'
import type { Task } from '../maintenance/api'
import type { Apartment, Profile, Resident } from '../tenants/api'
import type { TicketListItem } from '../tickets/api'
import { SHEETS } from '../import/readWorkbook'

export type Cell = string | number | null
export type Rows = Cell[][]
export interface WorkbookSpec { sheets: Record<string, Rows> }
export interface Column<T> { header: string; value: (r: T) => Cell }

const H = he.export.headers
const money = (n: number): number => Math.round(n * 100) / 100
const sum = (values: number[]): number => money(values.reduce((t, v) => t + v, 0))
const joined = (values: (string | null)[]): string => values.filter(Boolean).join(', ')

/** Header row plus one row per item, in order. */
export function toSheetRows<T>(rows: T[], columns: Column<T>[]): Rows {
  return [columns.map((c) => c.header), ...rows.map((r) => columns.map((c) => c.value(r)))]
}

// ------------------------------------------------------------------ per-page exports

const residentsOf = (residents: Resident[], apartmentId: string): Resident[] => residents.filter((r) => r.apartment_id === apartmentId)

const yes = (flag: boolean): string => (flag ? he.export.yes : '')
const payMethod = (standingOrder: boolean): string => he.tenants.form.methods[standingOrder ? 'standing_order' : 'manual']

/** `hasCharger`: whether the apartment has an EV charger. */
export function apartmentsRows(apartments: Apartment[], residents: Resident[], hasCharger: (apartmentId: string) => boolean): Rows {
  return toSheetRows(apartments, [
    { header: H.apartment, value: (a) => a.number },
    { header: H.floor, value: (a) => a.floor },
    { header: H.residents, value: (a) => joined(residentsOf(residents, a.id).map((r) => r.full_name)) },
    { header: H.phone, value: (a) => joined(residentsOf(residents, a.id).map((r) => r.phone)) },
    { header: H.notes, value: (a) => a.notes },
    { header: H.method, value: (a) => payMethod(a.payment_method === 'standing_order') },
    { header: H.committee, value: (a) => yes(a.is_committee) },
    { header: H.ev, value: (a) => yes(hasCharger(a.id)) },
  ])
}

export function usersRows(profiles: Profile[], apartmentOfResident: (residentId: string | null) => number | null): Rows {
  const roles: Record<string, string> = { admin: he.users.roleAdmin, resident: he.users.roleResident }
  const statuses: Record<string, string> = he.export.userStatus
  return toSheetRows(profiles, [
    { header: H.name, value: (p) => p.full_name },
    { header: H.email, value: (p) => p.email },
    { header: H.role, value: (p) => roles[p.role] ?? p.role },
    { header: H.status, value: (p) => statuses[p.status] ?? p.status },
    { header: H.apartment, value: (p) => apartmentOfResident(p.resident_id) },
  ])
}

export function ticketsRows(tickets: TicketListItem[]): Rows {
  return toSheetRows(tickets, [
    { header: H.title, value: (t) => t.title },
    { header: H.description, value: (t) => t.description },
    { header: H.location, value: (t) => t.location },
    { header: H.status, value: (t) => he.ticketStatus[t.status] },
    { header: H.vendor, value: (t) => t.vendor },
    { header: H.opened, value: (t) => formatDate(t.created_at) },
  ])
}

export function tasksRows(tasks: Task[], lastDone: ReadonlyMap<string, string>): Rows {
  const day = (iso: string | null | undefined): string | null => (iso ? formatDate(iso) : null)
  return toSheetRows(tasks, [
    { header: H.title, value: (t) => t.title },
    { header: H.frequency, value: (t) => he.maintenance.frequencies[t.frequency] },
    { header: H.vendor, value: (t) => t.vendor },
    { header: H.nextDue, value: (t) => day(t.next_due) },
    { header: H.lastDone, value: (t) => day(lastDone.get(t.id)) },
  ])
}

export function balancesRows(balances: ApartmentBalance[], hasCharger: (apartmentId: string) => boolean): Rows {
  return toSheetRows(balances, [
    { header: H.apartment, value: (b) => b.number },
    { header: H.residents, value: (b) => b.names.join(', ') },
    { header: H.balance, value: (b) => b.balance },
    { header: H.future, value: (b) => b.scheduled },
    { header: he.fees.exportFee, value: (b) => b.fee },
    { header: he.fees.exportMode, value: (b) => he.fees.modes[b.feeMode] },
    { header: H.method, value: (b) => payMethod(b.standingOrder) },
    { header: H.committee, value: (b) => yes(b.isCommittee) },
    { header: H.ev, value: (b) => yes(hasCharger(b.apartmentId)) },
  ])
}

export function paymentsRows(payments: Payment[], info: ReadonlyMap<string, { number: number; names: string }>): Rows {
  return toSheetRows(payments, [
    { header: H.date, value: (p) => formatDate(p.paid_on) },
    { header: H.apartment, value: (p) => info.get(p.apartment_id)?.number ?? null },
    { header: H.residents, value: (p) => info.get(p.apartment_id)?.names ?? '' },
    { header: H.amount, value: (p) => p.amount },
    { header: H.method, value: (p) => he.finance.methods[p.method] },
    { header: H.notes, value: (p) => p.note },
  ])
}

export function expensesRows(expenses: Expense[]): Rows {
  return toSheetRows(expenses, [
    { header: H.date, value: (e) => formatDate(e.spent_on) },
    { header: H.category, value: (e) => e.category },
    { header: H.vendor, value: (e) => e.vendor },
    { header: H.amount, value: (e) => e.amount },
    { header: H.notes, value: (e) => e.note },
  ])
}

export function budgetRows(lines: BudgetRow[]): Rows {
  return toSheetRows(lines, [
    { header: H.category, value: (r) => r.category },
    { header: H.planned, value: (r) => r.planned },
    { header: H.actual, value: (r) => r.actual },
    { header: H.difference, value: (r) => money(r.planned - r.actual) },
  ])
}

// ------------------------------------------------------------------ full-year workbook

export interface YearData {
  year: number
  apartments: Apartment[]
  residents: Resident[]
  ledger: LedgerRow[]
  expenses: Expense[]
  categories: { id: string; name: string }[]
  budgets: Budget[]
}

/** Excel date serial (1900 system) of the first of a month. */
export function monthSerial(year: number, monthIndex: number): number {
  return Math.round((Date.UTC(year, monthIndex, 1) - Date.UTC(1899, 11, 30)) / 86400000)
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i)
const blank = (n: number): null[] => Array.from({ length: n }, () => null)
const amountOrNull = (n: number): number | null => (n === 0 ? null : n)

function incomeSheet({ year, apartments, residents, ledger }: YearData): Rows {
  const grid = toLedgerGrid(ledger, year).byApartment
  const header: Rows = [[H.apartment, H.name, H.phone, ...MONTHS.map((m) => monthSerial(year, m)), H.total]]
  const body: Rows = []
  const columnTotals = MONTHS.map(() => 0)
  for (const a of [...apartments].sort((x, y) => x.number - y.number)) {
    const paid = MONTHS.map((m) => grid.get(a.id)?.cells[m]?.paid ?? 0)
    paid.forEach((v, m) => { columnTotals[m] = (columnTotals[m] ?? 0) + v })
    const people = residentsOf(residents, a.id)
    const [first, ...rest] = people
    body.push([a.number, first?.full_name ?? '', first?.phone ?? '', ...paid.map(amountOrNull), sum(paid)])
    // Further residents follow on their own rows with no amounts, so the importer keeps them all.
    for (const r of rest) body.push([a.number, r.full_name, r.phone ?? '', ...blank(13)])
  }
  const totals: Cell[] = [H.total, '', '', ...columnTotals.map((v) => amountOrNull(money(v))), sum(columnTotals)]
  return [...header, ...body, totals]
}

function expensesSheet({ year, categories, expenses }: YearData): Rows {
  const rows: Rows = [[H.category, ...HEBREW_MONTHS, H.total]]
  const columnTotals = MONTHS.map(() => 0)
  for (const c of categories) {
    const byMonth = MONTHS.map(() => 0)
    for (const e of expenses) {
      if (e.category_id === c.id && e.spent_on.startsWith(`${year}-`)) byMonth[Number(e.spent_on.slice(5, 7)) - 1] += e.amount
    }
    byMonth.forEach((v, m) => { columnTotals[m] = (columnTotals[m] ?? 0) + v })
    rows.push([c.name, ...byMonth.map((v) => amountOrNull(money(v))), sum(byMonth)])
  }
  rows.push([H.total, ...columnTotals.map((v) => amountOrNull(money(v))), sum(columnTotals)])
  return rows
}

function budgetSheet({ year, budgets }: YearData): Rows {
  const lines = budgets.filter((b) => b.year === year)
  return [[H.year, year], [H.category, H.plannedAmount], ...lines.map((b): Cell[] => [b.category, b.amount]), [H.total, sum(lines.map((b) => b.amount))]]
}

/** The same three sheets, names and layout the importer reads, so an exported year re-imports cleanly. */
export function buildYearWorkbook(data: YearData): WorkbookSpec {
  return { sheets: { [SHEETS.income]: incomeSheet(data), [SHEETS.expenses]: expensesSheet(data), [SHEETS.budget]: budgetSheet(data) } }
}
