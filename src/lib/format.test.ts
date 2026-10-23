import { describe, expect, it } from 'vitest'
import { formatDate, formatILS, HEBREW_MONTHS, monthLabel, relativeDate } from './format'

describe('format', () => {
  it('formats ILS', () => {
    const s = formatILS(4160)
    expect(s).toContain('4,160')
    expect(s).toContain('₪')
  })
  it('formats dates as DD/MM/YYYY', () => {
    expect(formatDate('2026-01-05')).toBe('05/01/2026')
    expect(formatDate(new Date(2026, 0, 5))).toBe('05/01/2026')
  })
  it('labels months', () => {
    expect(monthLabel('2026-10')).toBe('אוקטובר 2026')
    expect(HEBREW_MONTHS).toHaveLength(12)
    expect(HEBREW_MONTHS[0]).toBe('ינואר')
  })
})

describe('relativeDate', () => {
  const now = new Date('2026-10-23T12:00:00Z')
  it('says "לפני 3 ימים" for three days ago', () => {
    expect(relativeDate('2026-10-20T12:00:00Z', now)).toBe('לפני 3 ימים')
  })
  it('uses minutes and hours for today', () => {
    expect(relativeDate('2026-10-23T11:55:00Z', now)).toBe('לפני 5 דקות')
    expect(relativeDate('2026-10-23T09:00:00Z', now)).toBe('לפני 3 שעות')
  })
  it('says "עכשיו" for under a minute', () => {
    expect(relativeDate('2026-10-23T11:59:40Z', now)).toBe('עכשיו')
  })
  it('falls back to months for older dates', () => {
    expect(relativeDate('2026-07-20T12:00:00Z', now)).toBe('לפני 3 חודשים')
  })
})
