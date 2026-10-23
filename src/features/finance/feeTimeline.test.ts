import { describe, expect, it } from 'vitest'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { feeBadge } from '../../ui'
import { affectsPast, nextChange, nextChangeLabel, rowEffect, sortTimeline, type TimelineRow } from './feeTimeline'

const row = (effective_from: string, mode: TimelineRow['mode'], amount: number | null = null): TimelineRow =>
  ({ id: effective_from, apartment_id: 'a1', effective_from, mode, amount })

describe('feeBadge', () => {
  it('maps each source to its label and colour', () => {
    expect(feeBadge('building')).toEqual({ label: 'לפי תעריף הבניין', color: 'stone' })
    expect(feeBadge('custom')).toEqual({ label: 'סכום מיוחד', color: 'enamel' })
    expect(feeBadge('exempt')).toEqual({ label: 'פטור', color: 'signal' })
  })
})

describe('fee timeline', () => {
  const rows = [row('2026-03-01', 'exempt'), row('2027-01-01', 'custom', 350), row('2026-01-01', 'custom', 450), row('2027-06-01', 'building')]

  it('sorts newest first without touching the input', () => {
    expect(sortTimeline(rows).map((r) => r.effective_from)).toEqual(['2027-06-01', '2027-01-01', '2026-03-01', '2026-01-01'])
    expect(rows[0].effective_from).toBe('2026-03-01')
  })

  it('finds the earliest change after the current month', () => {
    expect(nextChange(rows, '2026-10-01')?.effective_from).toBe('2027-01-01')
    expect(nextChange(rows, '2027-01-01')?.effective_from).toBe('2027-06-01')
    expect(nextChange(rows, '2027-06-01')).toBeNull()
    expect(nextChange([], '2026-10-01')).toBeNull()
  })

  it('describes a change in words', () => {
    expect(nextChangeLabel(row('2027-01-01', 'custom', 350))).toBe(`מ-01/2027: ${formatILS(350)}`)
    expect(rowEffect(row('2027-01-01', 'exempt'))).toBe(he.fees.modes.exempt)
    expect(rowEffect(row('2027-01-01', 'building'))).toBe(he.fees.modes.building)
  })

  it('flags edits before the current month', () => {
    expect(affectsPast('2026-09-01', '2026-10-01')).toBe(true)
    expect(affectsPast('2026-10-01', '2026-10-01')).toBe(false)
  })
})
