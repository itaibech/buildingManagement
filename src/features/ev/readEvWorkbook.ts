// Reads the uploaded EV workbook in the browser (lazy SheetJS, values only; the file is untrusted).
import { he } from '../../lib/he'
import { ImportError } from '../import/parseWorkbook'
import { openWorkbook } from '../import/readWorkbook'
import { parseEvSheet, type EvSheet } from './parseEvWorkbook'

/** The "רכב חשמלי" sheet (or the only sheet, when the file has one) parsed into year blocks. */
export async function readEvWorkbook(data: ArrayBuffer): Promise<EvSheet> {
  const wb = await openWorkbook(data)
  const name = wb.names.includes(he.ev.sheet.name) ? he.ev.sheet.name : wb.names.length === 1 ? wb.names[0] : undefined
  const rows = name ? wb.rows(name) : null
  if (!rows) throw new ImportError(he.ev.import.errors.noSheet)
  return parseEvSheet(rows)
}
