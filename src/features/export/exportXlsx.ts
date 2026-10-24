// Builds and downloads an .xlsx. SheetJS is loaded on demand (same lazy chunk as the importer).
import { todayISO } from '../../lib/dates'
import type { Rows } from './buildWorkbook'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const SERIAL_MIN = 40000
const SERIAL_MAX = 60000

/** Extra number formats for cells a sheet's rows mark (e.g. date headers that are not in row 0). */
export type CellFormats = (rows: Rows) => { r: number; c: number; z: string }[]

/** `<name>-YYYY-MM-DD.xlsx` */
export const exportFileName = (name: string, today: string = todayISO()): string => `${name}-${today}.xlsx`

/** The workbook as bytes: RTL sheets, numbers as number cells, month-serial headers shown as MM/YYYY. */
export async function toXlsxBytes(sheets: Record<string, Rows>, formats?: CellFormats): Promise<ArrayBuffer> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows)
    rows[0]?.forEach((v, c) => {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })]
      if (cell && typeof v === 'number' && v >= SERIAL_MIN && v <= SERIAL_MAX) cell.z = 'mm/yyyy'
    })
    for (const f of formats?.(rows) ?? []) {
      const cell = ws[XLSX.utils.encode_cell({ r: f.r, c: f.c })]
      if (cell) cell.z = f.z
    }
    ws['!views'] = [{ RTL: true }]
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  wb.Workbook = { Views: [{ RTL: true }] }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

function saveBlob(bytes: ArrayBuffer, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Builds the workbook and triggers the browser download, as `<name>-YYYY-MM-DD.xlsx` (or `<name>.xlsx` when not `dated`). */
export async function exportXlsx(name: string, sheets: Record<string, Rows>, formats?: CellFormats, dated = true): Promise<void> {
  saveBlob(await toXlsxBytes(sheets, formats), dated ? exportFileName(name) : `${name}.xlsx`)
}
