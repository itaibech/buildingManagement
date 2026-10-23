import { describe, expect, it } from 'vitest'
import { expiredAnnouncements, todayISO, visibleAnnouncements, type AnnouncementLike } from './visible'

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
  it('formats the local calendar date as YYYY-MM-DD', () => {
    expect(todayISO(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})
