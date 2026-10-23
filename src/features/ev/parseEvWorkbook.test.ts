import { describe, expect, it } from 'vitest'
import { buildEvPayload, derivePayments, deriveRates, deriveReadings, paymentKey, summarizeEv } from './buildEvImport'
import { evFixtureRows } from './fixture'
import { parseEvSheet } from './parseEvWorkbook'

const NOW = '2026-10-01'
const sheet = () => parseEvSheet(evFixtureRows())

describe('parseEvSheet', () => {
  it('finds every year block with its months, apartments and carry-in', () => {
    const s = sheet()
    expect(s.blocks.map((b) => b.year)).toEqual([2022, 2023, 2026])
    expect(s.blocks[0]?.months[0]).toBe('2022-01-01')
    expect(s.blocks[1]?.apartments.map((a) => a.number)).toEqual([7, 9])
    expect(s.blocks[0]?.apartments[0]?.carry).toBeNull()
    expect(s.blocks[1]?.apartments[0]?.carry).toBe(1400)
    expect(s.blocks[1]?.apartments[1]?.readings).toEqual({ '2023-01-01': 69.23 })
    expect(s.blocks[0]?.apartments[0]?.paid['2022-03-01']).toBe(50)
  })

  it('ignores the 2022 "תשלום הפרש" column, notes and rate cells', () => {
    const a = sheet().blocks[0]?.apartments[0]
    expect(Object.keys(a?.readings ?? {})).toHaveLength(11)
    expect(Object.keys(a?.paid ?? {}).every((m) => m.startsWith('2022-'))).toBe(true)
  })

  it('throws a Hebrew error when there is no header row', () => {
    expect(() => parseEvSheet([['שלום']])).toThrow('לא מצאנו')
  })
})

describe('deriveReadings', () => {
  it('chains years, uses the first carry-in (or 0) as the initial reading and skips not-yet-read months', () => {
    const d = deriveReadings(sheet(), NOW)
    expect(d.chargers.map((c) => c.apartment)).toEqual([7, 9])
    const a7 = d.chargers[0]
    expect(a7?.initial_reading).toBe(0)
    expect(a7?.readings).toHaveLength(11 + 12 + 9)
    expect(a7?.readings.at(-1)).toEqual({ month: '2026-09-01', reading: 4982.89 })
    expect(a7?.readings.find((r) => r.month === '2023-09-01')?.reading).toBe(2916.34)
    expect(d.chargers[1]).toEqual({ apartment: 9, initial_reading: 0, readings: [{ month: '2023-01-01', reading: 69.23 }] })
    expect(d.warnings).toHaveLength(3)
    expect(d.warnings[0]).toContain('אוקטובר 2026')
    expect(d.names[9]).toBe('דיירת בדיקה ב')
  })
})

describe('deriveRates', () => {
  it('derives price ÷ kWh per month and collapses equal rates into change points', () => {
    const d = deriveReadings(sheet(), NOW)
    expect(deriveRates(sheet(), d.chargers, NOW)).toEqual([
      { effective_from: '2022-02-01', rate: 0.538 },
      { effective_from: '2022-07-01', rate: 0.574 },
      { effective_from: '2023-01-01', rate: 0.625 },
      { effective_from: '2023-02-01', rate: 0.6155 },
      { effective_from: '2023-03-01', rate: 0.605 },
      { effective_from: '2026-01-01', rate: 0.6432 },
    ])
  })
})

describe('payments and summary', () => {
  it('the "שולם" row becomes payments; overlaps can be skipped', () => {
    const payments = derivePayments(sheet())
    expect(payments).toHaveLength(10 + 12 - 1 + 1)
    expect(payments[0]).toEqual({ apartment: 7, paid_on: '2022-03-01', amount: 50 })
    const d = deriveReadings(sheet(), NOW)
    const payload = buildEvPayload(d.chargers, [], payments, { includePayments: true, skipPayments: new Set([paymentKey(9, '2023-01-01')]) })
    expect(payload.payments.some((p) => p.apartment === 9)).toBe(false)
    expect(buildEvPayload(d.chargers, [], payments, { includePayments: false, skipPayments: new Set() }).payments).toEqual([])
  })

  it('counts readings, kWh and amount per apartment and year', () => {
    const s = sheet()
    const d = deriveReadings(s, NOW)
    const rows = summarizeEv(d.chargers, deriveRates(s, d.chargers, NOW))
    expect(rows.map((r) => `${r.apartment}:${r.year}:${r.readings}`)).toEqual(['7:2022:11', '7:2023:12', '7:2026:9', '9:2023:1'])
    expect(rows[0]?.kwh).toBe(1400)
    expect(rows[3]).toMatchObject({ kwh: 69.23, amount: 43.27 })
  })
})
