import { describe, expect, it } from 'vitest'
import { expiredAnnouncements, isReadBy, visibleAnnouncements, type AnnouncementLike } from './visible'
import { todayISO } from '../../lib/dates'

const a = (id: string, o: Partial<AnnouncementLike> = {}): AnnouncementLike & { id: string } => ({
  id,
  pinned: false,
  expires_at: null,
  created_at: '2026-10-01T10:00:00Z',
  ...o,
})
const ids = (xs: { id: string }[]) => xs.map((x) => x.id)

describe('visibleAnnouncements', () => {
  const today = '2026-10-23'

  it('hides expired items and keeps ones expiring today or later', () => {
    const list = [a('old', { expires_at: '2026-10-22' }), a('today', { expires_at: '2026-10-23' }), a('open')]
    expect(ids(visibleAnnouncements(list, today)).sort()).toEqual(['open', 'today'])
  })

  it('puts pinned first, then newest first', () => {
    const list = [
      a('new', { created_at: '2026-10-20T00:00:00Z' }),
      a('pin-old', { pinned: true, created_at: '2026-09-01T00:00:00Z' }),
      a('old', { created_at: '2026-10-02T00:00:00Z' }),
      a('pin-new', { pinned: true, created_at: '2026-10-10T00:00:00Z' }),
    ]
    expect(ids(visibleAnnouncements(list, today))).toEqual(['pin-new', 'pin-old', 'new', 'old'])
  })

  it('does not mutate its input', () => {
    const list = [a('b', { created_at: '2026-01-01T00:00:00Z' }), a('a', { created_at: '2026-02-01T00:00:00Z' })]
    visibleAnnouncements(list, today)
    expect(ids(list)).toEqual(['b', 'a'])
  })
})

describe('expiredAnnouncements', () => {
  it('returns only the expired ones, newest first', () => {
    const list = [
      a('e1', { expires_at: '2026-10-01', created_at: '2026-09-01T00:00:00Z' }),
      a('e2', { expires_at: '2026-10-02', created_at: '2026-09-05T00:00:00Z' }),
      a('live'),
    ]
    expect(ids(expiredAnnouncements(list, '2026-10-23'))).toEqual(['e2', 'e1'])
  })
})

describe('todayISO', () => {
  it("is Israel's calendar date (the server's billing month), whatever the device's zone", () => {
    expect(todayISO(new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05')
    // 23:30 UTC on Oct 31 is already Nov 1 in Israel (01:30 IST): the new billing month has started.
    expect(todayISO(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01')
    // Summer time (UTC+3): 21:30 UTC is 00:30 the next day.
    expect(todayISO(new Date('2026-06-30T21:30:00Z'))).toBe('2026-07-01')
    expect(todayISO(new Date('2026-06-30T20:59:00Z'))).toBe('2026-06-30')
  })
})

describe('isReadBy', () => {
  const reads = new Set(['r1'])
  it('is read when a receipt exists', () => {
    expect(isReadBy({ id: 'r1', author_id: 'other' }, reads, 'me')).toBe(true)
  })
  it('counts the author\'s own announcement as read', () => {
    expect(isReadBy({ id: 'x', author_id: 'me' }, reads, 'me')).toBe(true)
  })
  it('is unread otherwise, including when the user is unknown', () => {
    expect(isReadBy({ id: 'x', author_id: 'other' }, reads, 'me')).toBe(false)
    expect(isReadBy({ id: 'x', author_id: null }, reads, undefined)).toBe(false)
  })
})
