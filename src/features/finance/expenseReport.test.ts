import { describe, expect, it } from 'vitest'
import { monthBreakdown, monthTotals, stepMonth, yearOverYear, type ReportRow } from './expenseReport'

const rows: ReportRow[] = [
  { categoryId: 'c1', category: 'ניקיון', month: '2026-03-01', total: 600 },
  { categoryId: 'c2', category: 'מעלית', month: '2026-03-01', total: 200 },
  { categoryId: 'c3', category: 'חשמל', month: '2026-03-01', total: 200 },
  { categoryId: 'c1', category: 'ניקיון', month: '2026-04-01', total: 650.5 },
]
const lastYear: ReportRow[] = [{ categoryId: 'c1', category: 'ניקיון', month: '2025-03-01', total: 800 }]

describe('stepMonth (‹ חודש ›)', () => {
  it('moves one month and crosses the year both ways', () => {
    expect(stepMonth('2026-03-01', 1)).toBe('2026-04-01')
    expect(stepMonth('2026-12-01', 1)).toBe('2027-01-01')
    expect(stepMonth('2026-01-01', -1)).toBe('2025-12-01')
  })
})

describe('monthBreakdown', () => {
  it('per category: the month total and its share of the month, largest first', () => {
    expect(monthBreakdown(rows, '2026-03-01')).toEqual({
      total: 1000,
      categories: [
        { categoryId: 'c1', category: 'ניקיון', total: 600, share: 0.6 },
        { categoryId: 'c2', category: 'מעלית', total: 200, share: 0.2 },
        { categoryId: 'c3', category: 'חשמל', total: 200, share: 0.2 },
      ],
    })
  })
  it('an empty month has no categories and total 0', () => {
    expect(monthBreakdown(rows, '2026-05-01')).toEqual({ total: 0, categories: [] })
  })
})

describe('monthTotals', () => {
  it('twelve totals for the year, zeros where nothing was spent', () => {
    const t = monthTotals(rows, 2026)
    expect(t).toHaveLength(12)
    expect(t[2]).toEqual({ month: '2026-03-01', total: 1000 })
    expect(t[3]?.total).toBe(650.5)
    expect(t[0]?.total).toBe(0)
  })
})

describe('yearOverYear', () => {
  it('compares with the same month last year', () => {
    expect(yearOverYear(1000, lastYear, '2026-03-01')).toEqual({ last: 800, change: 0.25 })
  })
  it('is null when last year has no data for that month', () => {
    expect(yearOverYear(650.5, lastYear, '2026-04-01')).toBeNull()
    expect(yearOverYear(1000, [], '2026-03-01')).toBeNull()
  })
})
