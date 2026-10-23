// Pure parser for the committee's EV sheet ("רכב חשמלי"). Input is SheetJS `sheet_to_json(ws, {header:1, raw:true})`
// output: untrusted cell values. Layout: stacked year blocks; each has a header row (A = 'דירה', month serials) and
// 5 rows per apartment (שולם / קריאת שעון / הפרש קוט"ש / מחיר בשקלים / הפרש בשקלים). Rate cells and notes are ignored.
import { he } from '../../lib/he'
import { excelSerialToMonth, ImportError, MAX_COLS, MAX_ROWS } from '../import/parseWorkbook'

export type MonthValues = Record<string, number>
export interface EvYearApartment {
  number: number
  name: string
  /** The block's carry-in reading (הפרש משנה קודמת), when the block has that column. */
  carry: number | null
  paid: MonthValues
  readings: MonthValues
  kwh: MonthValues
  cost: MonthValues
}
export interface EvBlock { year: number; months: string[]; apartments: EvYearApartment[] }
export interface EvSheet { blocks: EvBlock[]; warnings: string[] }

const ROWS = { paid: 'שולם', readings: 'קריאת שעון', kwh: 'הפרש קוטש', cost: 'מחיר בשקלים' } as const
type RowKind = keyof typeof ROWS

const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '')
/** Labels without quotes / geresh and with single spaces: 'הפרש קוט"ש' and 'הפרש קוט״ש' both become 'הפרש קוטש'. */
const label = (v: unknown): string => text(v).replace(/["״׳']/g, '').replace(/\s+/g, ' ')
const isSerial = (v: unknown): v is number => typeof v === 'number' && v >= 40000 && v <= 60000
const isApartment = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 9999
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const kindOf = (v: unknown): RowKind | null => {
  const l = label(v)
  return (Object.keys(ROWS) as RowKind[]).find((k) => ROWS[k] === l) ?? null
}

interface Header { row: number; year: number; months: { col: number; month: string }[]; carryCol: number | null }

function readHeader(r: unknown[], row: number): Header | null {
  if (label(r[0]) !== 'דירה') return null
  const months = r.flatMap((v, col) => (isSerial(v) ? [{ col, month: `${excelSerialToMonth(v)}-01` }] : []))
  if (months.length < 6) return null
  const years = months.map((m) => Number(m.month.slice(0, 4)))
  const year = years.sort((a, b) => years.filter((y) => y === b).length - years.filter((y) => y === a).length)[0] ?? 0
  const carry = r.findIndex((v) => label(v) === 'הפרש משנה קודמת')
  return { row, year, months, carryCol: carry >= 0 ? carry : null }
}

function emptyApartment(number: number, name: string): EvYearApartment {
  return { number, name: name.slice(0, 200), carry: null, paid: {}, readings: {}, kwh: {}, cost: {} }
}

function readRow(apt: EvYearApartment, kind: RowKind, r: unknown[], h: Header): void {
  for (const { col, month } of h.months) {
    const v = num(r[col])
    if (v !== null) apt[kind][month] = v
  }
  if (kind === 'readings' && h.carryCol !== null) apt.carry = num(r[h.carryCol])
}

function readBlock(rows: unknown[][], h: Header, end: number, warnings: string[]): EvBlock {
  const apartments: EvYearApartment[] = []
  let current: EvYearApartment | null = null
  for (let i = h.row + 1; i < end; i++) {
    const r = rows[i] ?? []
    const kind = kindOf(r[2])
    if (kind === 'paid' && isApartment(r[0])) {
      const n = r[0]
      if (apartments.some((a) => a.number === n)) warnings.push(he.ev.import.warnDuplicate(n, h.year))
      current = emptyApartment(n, text(r[1]))
      apartments.push(current)
    }
    if (current && kind) readRow(current, kind, r, h)
  }
  const unique = apartments.filter((a, i) => apartments.findIndex((b) => b.number === a.number) === i)
  return { year: h.year, months: h.months.map((m) => m.month), apartments: unique }
}

/** Every year block in the sheet, oldest first. Throws ImportError when no header row is found. */
export function parseEvSheet(input: unknown[][]): EvSheet {
  const rows = input.slice(0, MAX_ROWS).map((r) => (Array.isArray(r) ? r.slice(0, MAX_COLS) : []))
  const headers = rows.flatMap((r, i) => readHeader(r, i) ?? [])
  if (headers.length === 0) throw new ImportError(he.ev.import.errors.noHeader)
  const warnings: string[] = []
  const blocks = headers.map((h, i) => readBlock(rows, h, headers[i + 1]?.row ?? rows.length, warnings))
  return { blocks: blocks.sort((a, b) => a.year - b.year), warnings }
}
