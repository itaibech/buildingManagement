// Invented sample data laid out exactly like the committee's real workbook (no real names or phones).
// Columns: A apartment, B name, C phone, D..Q month cells, R total, S..AD the EV charging block.

import { HEBREW_MONTHS as MONTHS } from '../../lib/he'

/** A sparse sheet row: only the given column indexes are set; the rest are undefined, like SheetJS. */
function row(cells: Record<number, unknown>): unknown[] {
  const r: unknown[] = []
  for (const [col, value] of Object.entries(cells)) r[Number(col)] = value
  return r
}

const span = (from: number, values: readonly unknown[]): Record<number, unknown> =>
  Object.fromEntries(values.map((v, i) => [from + i, v]))

export const INCOME_HEADER: unknown[] = [
  'דירה ', 'שם', 'טלפון',
  46023, 46054, 46082, 46113, 46143, 46174, 46204,
  'אוגוסט', 'אוקטובר',
  46266, 46296, 46327, '', 46357, 'סה"כ',
]

export const incomeFixture: unknown[][] = [
  row({ 7: 'תשלומי ועד בית לשנת 2022', 9: 2026, 18: 'עמדת הטענה חשמלית' }),
  row(span(18, MONTHS)),
  INCOME_HEADER,
  // Apartment 1: a 0 cell (Oct) and an unreadable cell (Nov).
  row({ 0: 1, 1: 'דייר א', 2: '050-0000001', ...span(3, [390, 390, 390, 390, 390, 390, 330, 330, 500, 330, 0, 'בהמשך']), 17: 4160 }),
  // Apartment 2: one 2340 cell covering half a year.
  row({ 0: 2, 1: 'דייר ב', 2: '050-0000002', 4: 2340, ...span(9, [330, 330, 500, 330, 330]), 17: 4160 }),
  // Apartment 3: the EV apartment.
  row({
    0: 3, 1: 'דייר ג', 2: '050-0000003', ...span(3, [390, 390, 390, 390, 390, 390, 330, 330, 600, 330, 330]), 17: 4260,
    ...span(18, [103.5, 293.4, 0, 150]),
  }),
  // A second row for apartment 2 (another resident paying once).
  row({ 0: 2, 1: 'דיירת ב2', 2: '050-0000004', 12: 200, 17: 200 }),
  row({ 0: 'סה"כ', ...span(3, [780, 3120, 780, 780, 780, 780, 990, 990, 1600, 1190, 660]), 17: 12780 }),
  [],
  row({ 17: 'סה"כ טעינה', ...span(18, [103.5, 293.4, 0, 150]) }),
  row({ 0: 'שולם באוקטובר 500 ₪ בגין השתתפות עצמית.' }),
  [],
]

export const expensesFixture: unknown[][] = [
  row({ 4: 'הוצאות ועד בית 2026' }),
  [],
  ['הוצאה/חודש', ...MONTHS, 'סה"כ', 'הערות'],
  row({ 0: 'חברת ניהול', ...span(1, [1800, 1700, 1700]), 13: 5200 }),
  row({ 0: 'ניקיון חברה א', ...span(1, [1600, 1600]), 13: 3200 }),
  ['תיקוני חשמל'],
  row({ 0: 'בנק ', ...span(1, [36, 40, 0, 44]), 13: 120, 14: 'עמלות' }),
  row({ 0: 'סה"כ', ...span(1, [3436, 3340, 1700, 44]), 13: 8520 }),
  [],
]

export const budgetFixture: unknown[][] = [
  ['עלות שנתית מתוכננת'],
  [undefined, 2025],
  ['דמי ניהול', 20400],
  ['בזק'],
  ['נקיון', 19200],
  ['חשמל', ''],
  ['סה"כ עלות שנתית ללא מתקן חניה', 39600],
  [],
  ['עלות לדירה ללא מתקן חניה'],
]
