// Pure parsers for the committee's workbook. Input is SheetJS `sheet_to_json(ws, {header:1, raw:true})`
// output: untrusted cell values (numbers, strings, booleans, undefined). Nothing here executes cell content.
import { HEBREW_MONTHS, he } from '../../lib/he'

export type Proposal =
  | { kind: 'month'; month: string }
  | { kind: 'levy'; month: string | null; amount?: number }
  | { kind: 'ignore' }
export interface ColumnMap {
  col: number
  header: string
  proposal: Proposal
  warning?: 'duplicate' | 'unrecognized'
}
export interface IncomeApartment { number: number; name: string; phone: string; cells: Record<number, number> }
export interface EvRow { apartment: number; byMonth: Record<string, number> }
export interface IncomeSheet { year: number; columns: ColumnMap[]; apartments: IncomeApartment[]; ev: EvRow[]; warnings: string[] }
export interface ExpenseRow { category: string; byMonth: Record<string, number> }
export interface BudgetSheet { year: number; items: { category: string; amount: number }[] }

export class ImportError extends Error {}

const MAX_ROWS = 2000
const MAX_COLS = 60
const pad = (n: number): string => String(n).padStart(2, '0')
const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '')
const isTotal = (v: unknown): boolean => text(v).replace('״', '"').startsWith('סה"כ')
const monthIndex = (v: unknown): number => HEBREW_MONTHS.indexOf(text(v))
const isSerial = (v: unknown): v is number => typeof v === 'number' && v >= 40000 && v <= 60000
const isYear = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 2000 && v <= 2100
const ym = (year: number, monthIdx: number): string => `${year}-${pad(monthIdx + 1)}`

/** Excel date serial (1900 system) to 'YYYY-MM'. */
export function excelSerialToMonth(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000)
  return ym(d.getUTCFullYear(), d.getUTCMonth())
}

/** A cell as an amount: null when empty, 'invalid' when it can't be read as a number >= 0. */
export function toAmount(v: unknown): number | null | 'invalid' {
  if (v === undefined || v === null) return null
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : 'invalid'
  if (typeof v !== 'string') return 'invalid'
  const s = v.replace(/[₪,\s]/g, '')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : 'invalid'
}

const bounded = (rows: unknown[][]): unknown[][] =>
  rows.slice(0, MAX_ROWS).map((r) => (Array.isArray(r) ? r.slice(0, MAX_COLS) : []))

function majorityYear(cells: unknown[]): number {
  const counts = new Map<number, number>()
  for (const c of cells) {
    if (isSerial(c)) {
      const y = Number(excelSerialToMonth(c).slice(0, 4))
      counts.set(y, (counts.get(y) ?? 0) + 1)
    }
  }
  let best = new Date().getFullYear()
  let max = 0
  for (const [y, n] of counts) if (n > max) [best, max] = [y, n]
  return best
}

function findHeaderRow(rows: unknown[][]): number {
  const bySerials = rows.findIndex((r, i) => i < 20 && r.filter(isSerial).length >= 3)
  if (bySerials >= 0) return bySerials
  const byLabel = rows.findIndex((r, i) => i < 20 && text(r[0]) === 'דירה')
  if (byLabel >= 0) return byLabel
  throw new ImportError(he.import.errors.noHeader)
}

function headerText(v: unknown): string {
  if (isSerial(v)) {
    const [y, m] = excelSerialToMonth(v).split('-')
    return `01/${m}/${y}`
  }
  return text(v)
}

/** First guess for one header cell, with a priority: serial dates beat month names on duplicates. */
function guess(v: unknown, year: number): { proposal: Proposal; rank: number; unrecognized?: true } {
  if (isSerial(v)) return { proposal: { kind: 'month', month: excelSerialToMonth(v) }, rank: 2 }
  const m = monthIndex(v)
  if (m >= 0) return { proposal: { kind: 'month', month: ym(year, m) }, rank: 1 }
  if (text(v) === '' || isTotal(v)) return { proposal: { kind: 'ignore' }, rank: 0 }
  return { proposal: { kind: 'ignore' }, rank: 0, unrecognized: true }
}

/** The most common positive value (first seen wins a tie). */
export function mode(values: number[]): number | undefined {
  const counts = new Map<number, number>()
  for (const v of values) if (v > 0) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: number | undefined
  let max = 0
  for (const [v, n] of counts) if (n > max) [best, max] = [v, n]
  return best
}

/** Month columns run from after the phone column up to and including the total column. */
function dataColumns(header: unknown[]): { first: number; total: number } {
  const total = header.findIndex((c, i) => i > 2 && isTotal(c))
  return { first: 3, total: total >= 0 ? total : header.length - 1 }
}

function mapColumns(header: unknown[], year: number, levyValues: (col: number) => number[]): ColumnMap[] {
  const { first, total } = dataColumns(header)
  const guesses = []
  for (let col = first; col <= total; col++) guesses.push({ col, header: headerText(header[col]), ...guess(header[col], year) })
  const owner = new Map<string, { col: number; rank: number }>()
  for (const g of guesses) {
    if (g.proposal.kind !== 'month') continue
    const cur = owner.get(g.proposal.month)
    if (!cur || g.rank > cur.rank) owner.set(g.proposal.month, { col: g.col, rank: g.rank })
  }
  return guesses.map((g): ColumnMap => {
    if (g.unrecognized) return { col: g.col, header: g.header, proposal: g.proposal, warning: 'unrecognized' }
    if (g.proposal.kind === 'month' && owner.get(g.proposal.month)?.col !== g.col) {
      const amount = mode(levyValues(g.col))
      const proposal: Proposal = amount === undefined ? { kind: 'levy', month: null } : { kind: 'levy', month: null, amount }
      return { col: g.col, header: g.header, proposal, warning: 'duplicate' }
    }
    return { col: g.col, header: g.header, proposal: g.proposal }
  })
}

/** The EV block: a row above the header whose Hebrew month names sit to the right of the total column. */
function evColumns(rows: unknown[][], headerRow: number, total: number, year: number): Map<number, string> {
  for (let i = 0; i < headerRow; i++) {
    const cols = new Map<number, string>()
    rows[i].forEach((c, col) => {
      if (col > total && monthIndex(c) >= 0) cols.set(col, ym(year, monthIndex(c)))
    })
    if (cols.size >= 3) return cols
  }
  return new Map()
}

function apartmentNumber(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.trim()) : v
  return typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 9999 ? n : null
}

type Warn = (where: string, header: string, value: unknown) => void

function readCells(r: unknown[], cols: number[], label: (col: number) => string, where: string, warn: Warn) {
  const out: Record<number, number> = {}
  for (const col of cols) {
    const a = toAmount(r[col])
    if (a === 'invalid') warn(where, label(col), r[col])
    else if (a !== null && a > 0) out[col] = a
  }
  return out
}

export function parseIncomeSheet(input: unknown[][]): IncomeSheet {
  const rows = bounded(input)
  const h = findHeaderRow(rows)
  const header = rows[h]
  const year = majorityYear(header)
  const { total } = dataColumns(header)
  const body = rows.slice(h + 1).filter((r) => apartmentNumber(r[0]) !== null)
  const columns = mapColumns(header, year, (col) =>
    body.map((r) => toAmount(r[col])).filter((a): a is number => typeof a === 'number'))
  const ev = evColumns(rows, h, total, year)
  const cellCols = columns.map((c) => c.col).filter((col) => !isTotal(header[col]))
  const warnings: string[] = []
  const warn: Warn = (where, col, value) => warnings.push(he.import.warnCell(where, col, text(value) || String(value)))
  const seen = new Set<number>()
  const evRows = new Map<number, Record<string, number>>()
  const apartments = body.map((r): IncomeApartment => {
    const number = apartmentNumber(r[0]) ?? 0
    if (seen.has(number)) warnings.push(he.import.warnDuplicateRow(number))
    seen.add(number)
    const where = he.apartment(number)
    const cells = readCells(r, cellCols, (col) => headerText(header[col]), where, warn)
    addEv(evRows, number, readCells(r, [...ev.keys()], (col) => he.import.evColumn(ev.get(col) ?? ''), where, warn), ev)
    return { number, name: text(r[1]), phone: text(r[2]), cells }
  })
  return { year, columns, apartments, ev: [...evRows].map(([apartment, byMonth]) => ({ apartment, byMonth })), warnings }
}

function addEv(acc: Map<number, Record<string, number>>, apt: number, cells: Record<number, number>, ev: Map<number, string>) {
  const entries = Object.entries(cells)
  if (entries.length === 0) return
  const byMonth = acc.get(apt) ?? {}
  for (const [col, amount] of entries) {
    const month = ev.get(Number(col)) ?? ''
    byMonth[month] = (byMonth[month] ?? 0) + amount
  }
  acc.set(apt, byMonth)
}

/** הוצאות: a header row of Hebrew months, then one row per category. Totals and empty rows are skipped. */
export function parseExpensesSheet(input: unknown[][], year: number, warnings: string[] = []): ExpenseRow[] {
  const rows = bounded(input)
  const h = rows.findIndex((r) => r.filter((c) => monthIndex(c) >= 0).length >= 6)
  if (h < 0) return []
  const months = new Map<number, string>()
  rows[h].forEach((c, col) => {
    if (monthIndex(c) >= 0) months.set(col, ym(year, monthIndex(c)))
  })
  const out: ExpenseRow[] = []
  const warn: Warn = (where, col, value) => warnings.push(he.import.warnCell(where, col, text(value) || String(value)))
  for (const r of rows.slice(h + 1)) {
    const category = text(r[0])
    if (category === '' || isTotal(category)) continue
    const cells = readCells(r, [...months.keys()], (col) => text(rows[h][col]), category, warn)
    const byMonth: Record<string, number> = {}
    for (const [col, amount] of Object.entries(cells)) byMonth[months.get(Number(col)) ?? ''] = amount
    if (Object.keys(byMonth).length > 0) out.push({ category: category.slice(0, 100), byMonth })
  }
  return out
}

/** עלויות שנתיות מתוכננות: a year cell near the top, then category + yearly amount rows. */
export function parseBudgetSheet(input: unknown[][]): BudgetSheet {
  const rows = bounded(input)
  const yearRow = rows.findIndex((r, i) => i < 5 && r.some(isYear))
  const year = yearRow >= 0 ? (rows[yearRow].find(isYear) ?? new Date().getFullYear()) : new Date().getFullYear()
  const items: BudgetSheet['items'] = []
  for (const r of rows.slice(yearRow + 1)) {
    const category = text(r[0])
    const amount = toAmount(r[1])
    if (category === '' || isTotal(category) || typeof amount !== 'number' || amount <= 0) continue
    items.push({ category: category.slice(0, 100), amount })
  }
  return { year, items }
}
