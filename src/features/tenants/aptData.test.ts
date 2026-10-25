import { describe, expect, it } from 'vitest'
import { paymentYears, paymentsOfYear, sectionsFor, sourceOf, totalOf, type AptPayment } from './aptData'

const pay = (id: string, paid_on: string, amount: number, source: AptPayment['source'] = 'manual'): AptPayment =>
  ({ id, paid_on, for_month: null, amount, method: 'cash', note: '', source })

describe('apartment page: payments', () => {
  const rows = [pay('a', '2026-03-01', 300, 'auto'), pay('b', '2025-12-20', 120.5), pay('c', '2026-01-05', 99.25, 'import'), pay('d', '2026-07-01', 0.25, 'special')]

  it('maps the source: settlement and special win over the row source; ev-import reads as imported', () => {
    expect(sourceOf({ source: 'manual', settlement_id: 's', special_id: null })).toBe('settlement')
    expect(sourceOf({ source: 'manual', settlement_id: null, special_id: 'x' })).toBe('special')
    expect(sourceOf({ source: 'auto', settlement_id: null, special_id: null })).toBe('auto')
    expect(sourceOf({ source: 'ev-import', settlement_id: null, special_id: null })).toBe('import')
    expect(sourceOf({ source: 'manual', settlement_id: null, special_id: null })).toBe('manual')
  })

  it('filters by year (newest first) with the year total', () => {
    expect(paymentYears(rows)).toEqual([2026, 2025])
    const y = paymentsOfYear(rows, 2026)
    expect(y.map((p) => p.id)).toEqual(['d', 'a', 'c'])
    expect(totalOf(y)).toBe(399.5)
    expect(totalOf(paymentsOfYear(rows, 2025))).toBe(120.5)
    expect(paymentsOfYear(rows, 2024)).toEqual([])
  })
})

describe('apartment page: sections', () => {
  it('shows "טעינת רכב" only with a charger', () => {
    expect(sectionsFor(false)).toEqual(['overview', 'payments', 'ledger', 'fees', 'residents', 'tickets', 'meetings', 'history'])
    expect(sectionsFor(true)).toContain('ev')
    expect(sectionsFor(true).indexOf('ev')).toBe(4)
  })
})
