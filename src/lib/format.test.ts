import { describe, expect, it } from 'vitest'
import { formatDate, formatILS, HEBREW_MONTHS, monthLabel } from './format'

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
