// An invented EV workbook in the committee's layout (stacked year blocks, 5 rows per apartment). Test data only.
const DAY = 86400000
const serial = (y: number, m: number): number => (Date.UTC(y, m - 1, 1) - Date.UTC(1899, 11, 30)) / DAY
const monthSerials = (y: number): number[] => Array.from({ length: 12 }, (_, i) => serial(y, i + 1))
type Cell = string | number | null
type Month = number | null

/** The sheet's own formulas: kWh = reading − previous, price = kWh × rate (unrounded), difference = paid − price. */
function apartmentRows(number: number, name: string, carry: Month | undefined, paid: Month[], readings: Month[], rate: (m: number) => number): Cell[][] {
  const lead = carry === undefined ? [] : [carry]
  let prev = carry ?? null
  const kwh = readings.map((r) => {
    const d = r === null || prev === null ? null : Math.round((r - prev) * 100) / 100
    if (r !== null) prev = r
    return d
  })
  const cost = kwh.map((k, i) => (k === null ? null : k * rate(i + 1)))
  const diff = cost.map((c, i) => (c === null ? null : (paid[i] ?? 0) - c))
  const gap = carry === undefined ? [] : [null]
  return [
    [number, name, 'שולם', ...gap, ...paid],
    [null, null, 'קריאת שעון', ...lead, ...readings],
    [null, null, 'הפרש קוט"ש', ...gap, ...kwh],
    [null, null, 'מחיר בשקלים', ...gap, ...cost],
    [null, null, 'הפרש בשקלים', ...gap, ...diff, 76, 'הערה חופשית שאין לקרוא'],
  ]
}

const title = (year: number): Cell[] => [null, null, null, null, null, null, null, 'תשלום רכב חשמלי', null, year]

/** 2022 (no carry column), 2023 (two apartments, one with a dirty negative diff row) and a current-year 2026 block. */
export function evFixtureRows(): Cell[][] {
  const r2022 = (m: number) => (m < 7 ? 0.538 : 0.574)
  const r2023 = (m: number) => (m === 1 ? 0.625 : m === 2 ? 0.6155 : 0.605)
  return [
    title(2022), [],
    ['דירה ', 'שם', null, ...monthSerials(2022), 'תשלום הפרש'],
    ...apartmentRows(7, 'דייר בדיקה א', undefined, [null, null, 50, 80, 80, 80, 80, 100, 100, 100, 100, 100],
      [null, 0, 100, 250, 400, 520, 640, 800, 950, 1100, 1240, 1400], r2022),
    [], [null, '1.2.2022', 'מחיר לקוט״ש', 0.538, 'ש"ח'], [null, '1.8.2022', 'מחיר לקוט״ש', 0.574, 'ש"ח'],
    title(2023), [],
    ['דירה ', 'שם', null, 'הפרש משנה קודמת', ...monthSerials(2023), 'סה"כ'],
    ...apartmentRows(7, 'דייר בדיקה א', 1400, [120, 120, 120, 120, 120, 120, 120, 120, 120, 56, 44.06, 0],
      [1605.57, 1817.75, 1995.91, 2190.72, 2389.57, 2580.22, 2830.05, 2916.34, 2916.34, 3053.84, 3188.5, 3330.25], r2023),
    [9, 'דיירת בדיקה ב', 'שולם', null, 144],
    [null, null, 'קריאת שעון', 0, 69.23],
    [null, null, 'הפרש קוט"ש', null, 69.23, -69.23, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [null, null, 'מחיר בשקלים', null, 43.26875, -43.26875, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [null, null, 'הפרש בשקלים', 0, 100.73125, 43.26875, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 144],
    [], [null, '1.1.2023', 'מחיר לקוט״ש', 0.625, 'ש"ח'], [null, '1.2.2023', null, 0.6155, 'ש"ח'],
    [null, '1.1.2026', null, 0.6432, 'ש״ח', null, null, null, null, 2026], [],
    ['דירה ', 'שם', null, 'הפרש משנה קודמת', ...monthSerials(2026), 'סה"כ'],
    ...apartmentRows(7, 'דייר בדיקה א', 3330.25, Array<Month>(12).fill(null),
      [3563.53, 3752.15, 3801.14, 3972.67, 4195.4, 4406.18, 4609.14, 4719.82, 4982.89, 3330.25, 3330.25, 3330.25], () => 0.6432),
  ]
}
