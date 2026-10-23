import { describe, expect, it } from 'vitest'
import { toXlsxBytes } from '../export/exportXlsx'
import { deriveRates, deriveReadings, type ChargerPlan } from './buildEvImport'
import { money, rateFor, type Rate } from './evMath'
import { evFormats, evSheetRows, exportYears, toSerial, type ExportCharger, type ExportPayment } from './evWorkbook'
import { evFixtureRows } from './fixture'
import { parseEvSheet } from './parseEvWorkbook'
import { readEvWorkbook } from './readEvWorkbook'

const FAR = '2100-12-01'

/** What the DB stores per reading: kWh against the previous reading and the rate in force. */
function asStored(plans: ChargerPlan[], rates: Rate[]): ExportCharger[] {
  return plans.map((c) => {
    let prev = c.initial_reading
    const readings = c.readings.map((r) => {
      const kwh = money(r.reading - prev)
      prev = r.reading
      return { ...r, kwh, rate: rateFor(rates, r.month) }
    })
    return { number: c.apartment, name: `דייר ${c.apartment}`, initial: c.initial_reading, readings }
  })
}

function source() {
  const sheet = parseEvSheet(evFixtureRows())
  const { chargers } = deriveReadings(sheet, '2026-10-01')
  const rates = deriveRates(sheet, chargers, '2026-10-01')
  const payments: ExportPayment[] = [
    { apartment: 7, paid_on: '2023-01-05', amount: 120, note: 'טעינת רכב חשמלי' },
    { apartment: 7, paid_on: '2023-01-20', amount: 999, note: 'דמי ועד' },
  ]
  return { chargers, rates, stored: asStored(chargers, rates), payments }
}

describe('evSheetRows', () => {
  it('writes one block per year in the sheet layout, 5 rows per apartment, with totals and dated rates', () => {
    const { stored, rates, payments } = source()
    const rows = evSheetRows(stored, payments, rates, [2023])
    expect(rows[0]?.[7]).toBe('תשלום רכב חשמלי')
    expect(rows[0]?.[9]).toBe(2023)
    expect(rows[2]?.slice(0, 5)).toEqual(['דירה ', null, null, 'הפרש משנה קודמת', toSerial('2023-01-01')])
    expect(rows[2]?.[16]).toBe('סה"כ')
    expect(rows.slice(3, 8).map((r) => r[2])).toEqual(['שולם', 'קריאת שעון', 'הפרש קוט"ש', 'מחיר בשקלים', 'הפרש בשקלים'])
    expect(rows[3]?.[4]).toBe(120)
    expect(rows[4]?.[3]).toBe(1400)
    expect(rows[5]?.[4]).toBe(205.57)
    expect(rows[6]?.[4]).toBeCloseTo(205.57 * 0.625, 6)
    expect(rows.filter((r) => r[2] === 'מחיר לקוט״ש').map((r) => r[3])).toEqual([0.625, 0.6155, 0.605])
    expect(evFormats(rows).filter((f) => f.z === 'mm/yyyy')).toHaveLength(12)
  })

  it('lists the years that have data', () => {
    const { stored, payments } = source()
    expect(exportYears(stored, payments)).toEqual([2022, 2023, 2026])
  })

  it('round-trip: parsing the exported workbook with the EV import parser gives the same readings and rates', async () => {
    const { chargers, rates, stored, payments } = source()
    const bytes = await toXlsxBytes({ 'רכב חשמלי': evSheetRows(stored, payments, rates, exportYears(stored, payments)) }, evFormats)
    const back = await readEvWorkbook(bytes)
    const again = deriveReadings(back, FAR)
    expect(again.chargers).toEqual(chargers)
    expect(deriveRates(back, again.chargers, FAR)).toEqual(rates)
    expect(again.warnings).toEqual([])
  })
})
