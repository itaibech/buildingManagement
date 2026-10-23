import { describe, expect, it } from 'vitest'
import { dueBucket, nextDue } from './nextDue'

describe('nextDue', () => {
  it('clamps monthly to the month end', () => expect(nextDue('2026-01-31', 'monthly')).toBe('2026-02-28'))
  it('adds a quarter', () => expect(nextDue('2026-03-15', 'quarterly')).toBe('2026-06-15'))
  it('adds a year', () => expect(nextDue('2026-03-15', 'yearly')).toBe('2027-03-15'))
  it('clamps a leap day yearly', () => expect(nextDue('2024-02-29', 'yearly')).toBe('2025-02-28'))
  it('rolls over the year for monthly', () => expect(nextDue('2026-12-10', 'monthly')).toBe('2027-01-10'))
  it('is null for once', () => expect(nextDue('2026-03-15', 'once')).toBeNull())
})

describe('dueBucket', () => {
  const today = '2026-10-23'
  it('overdue when before today', () => expect(dueBucket('2026-10-01', today)).toBe('overdue'))
  it('soon within 30 days', () => expect(dueBucket('2026-11-10', today)).toBe('soon'))
  it('today and day 30 are soon', () => {
    expect(dueBucket(today, today)).toBe('soon')
    expect(dueBucket('2026-11-22', today)).toBe('soon')
  })
  it('later beyond 30 days', () => expect(dueBucket('2026-11-23', today)).toBe('later'))
  it('none without a date', () => expect(dueBucket(null, today)).toBe('none'))
})
