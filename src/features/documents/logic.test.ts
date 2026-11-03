import { describe, expect, it } from 'vitest'
import { expiringSoon, expiryStatus, groupDocuments, orderVersions, toCategory, type DocLike } from './logic'

const doc = (title: string, category: DocLike['category'], expires_on: string | null = null): DocLike => ({ title, category, expires_on })

describe('expiryStatus', () => {
  const today = '2026-11-03'
  it('is null without an expiry date', () => {
    expect(expiryStatus(null, today)).toBeNull()
  })
  it('expired once the date has passed; the expiry day itself is still soon', () => {
    expect(expiryStatus('2026-11-02', today)).toBe('expired')
    expect(expiryStatus('2026-11-03', today)).toBe('soon')
  })
  it('soon within 30 days, valid after', () => {
    expect(expiryStatus('2026-12-03', today)).toBe('soon')
    expect(expiryStatus('2026-12-04', today)).toBe('valid')
  })
  it('counts days across a DST change correctly', () => {
    expect(expiryStatus('2027-04-01', '2027-03-02')).toBe('soon')
    expect(expiryStatus('2027-04-02', '2027-03-02')).toBe('valid')
  })
  it('expiringSoon counts only the soon ones', () => {
    expect(expiringSoon([doc('a', 'insurance', '2026-11-20'), doc('b', 'warranty', '2026-10-01'), doc('c', 'plans'),
      doc('d', 'approvals', '2027-06-01')], today)).toBe(1)
  })
})

describe('orderVersions', () => {
  it('puts the newest first and numbers them from the oldest', () => {
    const v = orderVersions([
      { id: 'b', created_at: '2026-02-01T10:00:00Z' },
      { id: 'a', created_at: '2025-01-01T10:00:00Z' },
      { id: 'c', created_at: '2026-05-01T10:00:00Z' },
    ])
    expect(v.map((x) => [x.id, x.number])).toEqual([['c', 3], ['b', 2], ['a', 1]])
  })
  it('breaks ties on the same timestamp by id, stably', () => {
    const t = '2026-01-01T00:00:00Z'
    expect(orderVersions([{ id: 'a', created_at: t }, { id: 'b', created_at: t }]).map((x) => x.id)).toEqual(['b', 'a'])
  })
  it('handles an empty history', () => {
    expect(orderVersions([])).toEqual([])
  })
})

describe('groupDocuments', () => {
  const docs = [doc('פוליסת ביטוח מבנה', 'insurance'), doc('תקנון הבית המשותף', 'legal'), doc('אחריות דלת כניסה', 'warranty'),
    doc('ביטוח צד ג', 'insurance'), doc('שונות', 'other')]

  it('groups by category in the fixed order, titles sorted within', () => {
    expect(groupDocuments(docs, '').map((g) => [g.category, g.docs.map((d) => d.title)])).toEqual([
      ['legal', ['תקנון הבית המשותף']],
      ['insurance', ['ביטוח צד ג', 'פוליסת ביטוח מבנה']],
      ['warranty', ['אחריות דלת כניסה']],
      ['other', ['שונות']],
    ])
  })
  it('filters by title and drops empty groups', () => {
    expect(groupDocuments(docs, '  ביטוח ').map((g) => [g.category, g.docs.length])).toEqual([['insurance', 2]])
    expect(groupDocuments(docs, 'מעלית')).toEqual([])
  })
  it('maps an unknown category to other', () => {
    expect(toCategory('legal')).toBe('legal')
    expect(toCategory('future')).toBe('other')
  })
})
