import { describe, expect, it } from 'vitest'
import { chargeAmount, evPreview, historyRows, isEvPayment, previousReading, rateFor, readingPreview } from './evMath'

describe('evPreview', () => {
  it('computes kWh and the amount rounded to agorot (half up, like Postgres round)', () => {
    expect(evPreview(100, 150.55, 0.5)).toEqual({ kwh: 50.55, amount: 25.28 })
    expect(evPreview(150.55, 200, 0.5)).toEqual({ kwh: 49.45, amount: 24.73 })
    expect(evPreview(1841, 2046.57, 0.625)).toEqual({ kwh: 205.57, amount: 128.48 })
  })

  it('a zero diff is a valid reading', () => {
    expect(evPreview(7712.39, 7712.39, 0.6414)).toEqual({ kwh: 0, amount: 0 })
  })

  it('flags a reading lower than the previous one', () => {
    expect(evPreview(9447.49, 7794.85, 0.6432)).toEqual({ kwh: -1652.64, amount: 0, error: 'lower' })
  })

  it('flags a reading above the next month (the edit would make it negative)', () => {
    expect(evPreview(100, 400, 0.5, 310)).toMatchObject({ error: 'next' })
  })

  it('flags a missing rate', () => {
    expect(evPreview(100, 120, null)).toEqual({ kwh: 20, amount: 0, error: 'noRate' })
  })
})

describe('readingPreview', () => {
  it('flags a month after the current month', () => {
    const rates = [{ rate: 0.5, effective_from: '2026-01-01' }]
    expect(readingPreview([], 0, rates, '2026-11-01', 10, '2026-10-01')?.error).toBe('future')
    expect(readingPreview([], 0, rates, '2026-10-01', 10, '2026-10-01')).toMatchObject({ kwh: 10, amount: 5 })
  })
})

describe('helpers', () => {
  const rates = [{ rate: 0.538, effective_from: '2022-02-01' }, { rate: 0.574, effective_from: '2022-08-01' }]
  it('rateFor takes the latest rate effective by the month', () => {
    expect(rateFor(rates, '2022-01-01')).toBeNull()
    expect(rateFor(rates, '2022-07-01')).toBe(0.538)
    expect(rateFor(rates, '2022-08-01')).toBe(0.574)
  })

  it('previousReading is the latest earlier month, else the initial reading', () => {
    const readings = [{ month: '2026-07-01', reading: 512.8 }, { month: '2026-08-01', reading: 640.15 }]
    expect(previousReading(readings, 350.5, '2026-07-01')).toBe(350.5)
    expect(previousReading(readings, 350.5, '2026-09-01')).toBe(640.15)
    expect(previousReading(readings, 350.5, '2026-08-01')).toBe(512.8)
  })

  it('chargeAmount uses exact decimal arithmetic', () => {
    expect(chargeAmount(15.85, 0.6145)).toBe(9.74)
    expect(chargeAmount(176.55, 0.574)).toBe(101.34)
  })

  it('EV payments are the ones noted as EV charging', () => {
    expect(isEvPayment('טעינת רכב חשמלי')).toBe(true)
    expect(isEvPayment('טעינת רכב חשמלי · יובא מאקסל')).toBe(true)
    expect(isEvPayment('ינואר')).toBe(false)
  })
})

describe('historyRows', () => {
  it('matches the sheet: reading, kWh, rate, amount, paid that month and paid − amount', () => {
    const readings = [
      { id: 'r2', month: '2026-08-01', reading: 640.15, kwh: 127.35, rate: 0.574, amount: 73.1 },
      { id: 'r1', month: '2026-07-01', reading: 512.8, kwh: 162.3, rate: 0.574, amount: 93.16 },
    ]
    const payments = [
      { paid_on: '2026-08-06', amount: 50, note: 'טעינת רכב חשמלי' },
      { paid_on: '2026-08-20', amount: 43.1, note: 'טעינת רכב חשמלי' },
      { paid_on: '2026-08-01', amount: 330, note: 'דמי ועד' },
    ]
    const rows = historyRows(readings, payments)
    expect(rows.map((r) => r.month)).toEqual(['2026-08-01', '2026-07-01'])
    expect(rows[0]).toEqual({ id: 'r2', month: '2026-08-01', reading: 640.15, kwh: 127.35, rate: 0.574, amount: 73.1, paid: 93.1, diff: 20 })
    expect(rows[1]).toMatchObject({ paid: 0, diff: -93.16 })
  })
})
