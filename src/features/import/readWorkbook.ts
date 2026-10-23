// Reads the uploaded workbook in the browser. SheetJS is loaded on demand so it never weighs on other pages.
// The file is untrusted: we only read cell values (no formulas, HTML, styles or macros are used).
import { he } from '../../lib/he'
import type { ParsedWorkbook } from './buildImport'
import { ImportError, MAX_COLS, MAX_ROWS, parseBudgetSheet, parseExpensesSheet, parseIncomeSheet } from './parseWorkbook'

export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const SHEETS = { income: 'הכנסות', expenses: 'הוצאות', budget: 'עלויות שנתיות מתוכננות' } as const

export interface ReadResult { parsed: ParsedWorkbook; warnings: string[] }

/**
 * Opens untrusted workbook bytes (size-checked, values only, bounded to MAX_ROWS × MAX_COLS) and returns a reader
 * for a sheet's rows by name, plus the sheet names. Throws ImportError with a Hebrew message.
 */
export async function openWorkbook(data: ArrayBuffer): Promise<{ names: string[]; rows: (name: string) => unknown[][] | null }> {
  if (data.byteLength > MAX_FILE_BYTES) throw new ImportError(he.import.errors.tooBig)
  const XLSX = await import('xlsx')
  let wb: ReturnType<typeof XLSX.read>
  try {
    // sheetRows stops reading past MAX_ROWS; the column clip below stops a huge <dimension> from being materialised.
    wb = XLSX.read(data, { type: 'array', sheetRows: MAX_ROWS, cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false })
  } catch {
    throw new ImportError(he.import.errors.unreadable)
  }
  const rows = (name: string): unknown[][] | null => {
    const ws = wb.Sheets[name]
    if (!ws) return null
    const ref = ws['!ref']
    if (ref) {
      const r = XLSX.utils.decode_range(ref)
      ws['!ref'] = XLSX.utils.encode_range({ s: r.s, e: { r: Math.min(r.e.r, MAX_ROWS - 1), c: Math.min(r.e.c, MAX_COLS - 1) } })
    }
    return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true })
  }
  return { names: wb.SheetNames, rows }
}

/** Parse workbook bytes into the import model. Throws ImportError with a Hebrew message. */
export async function readWorkbook(data: ArrayBuffer): Promise<ReadResult> {
  const { rows } = await openWorkbook(data)
  const incomeRows = rows(SHEETS.income)
  if (!incomeRows) throw new ImportError(he.import.errors.noIncome)
  const income = parseIncomeSheet(incomeRows)
  const warnings = [...income.warnings]
  const expenses = parseExpensesSheet(rows(SHEETS.expenses) ?? [], income.year, warnings)
  const budget = parseBudgetSheet(rows(SHEETS.budget) ?? [])
  return { parsed: { income, expenses, budget }, warnings }
}
