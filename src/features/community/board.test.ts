import { describe, expect, it } from 'vitest'
import { he } from '../../lib/he'
import { boardPosts, daysLeft, hasText, expiresSoon, isExpired, limitMessage, newestPosts, photoError, postState, type BoardPost } from './board'

const NOW = new Date('2026-11-03T12:00:00Z')
const day = (n: number) => new Date(NOW.getTime() + n * 86400_000).toISOString()
const post = (o: Partial<BoardPost & { id: string; status: 'active' | 'resolved' }> = {}) => ({
  id: 'p', category: 'general' as const, author_id: 'other', expires_at: day(20), hidden_at: null, created_at: day(-1), status: 'active' as const, ...o,
})

describe('expiry', () => {
  it('a post expires at expires_at', () => {
    expect(isExpired(day(1), NOW)).toBe(false)
    expect(isExpired(NOW.toISOString(), NOW)).toBe(true)
    expect(isExpired(day(-1), NOW)).toBe(true)
  })
  it('counts whole days left, never below 0', () => {
    expect(daysLeft(day(30), NOW)).toBe(30)
    expect(daysLeft(day(0.2), NOW)).toBe(1)
    expect(daysLeft(day(-3), NOW)).toBe(0)
  })
  it('warns in the last 3 days only, not after expiry', () => {
    expect(expiresSoon(day(4), NOW)).toBe(false)
    expect(expiresSoon(day(3), NOW)).toBe(true)
    expect(expiresSoon(day(-1), NOW)).toBe(false)
  })
})

describe('boardPosts', () => {
  const list = [
    post({ id: 'old', category: 'pros', created_at: day(-5) }),
    post({ id: 'new', category: 'lost_found', created_at: day(-1) }),
    post({ id: 'expired-other', expires_at: day(-1), created_at: day(-31) }),
    post({ id: 'expired-mine', author_id: 'me', expires_at: day(-1), created_at: day(-32) }),
  ]
  it('all categories: newest first; expired posts only for their author', () => {
    expect(boardPosts(list, null, 'me', NOW).map((p) => p.id)).toEqual(['new', 'old', 'expired-mine'])
  })
  it('filters by category', () => {
    expect(boardPosts(list, 'pros', 'me', NOW).map((p) => p.id)).toEqual(['old'])
    expect(boardPosts(list, 'help', 'me', NOW)).toEqual([])
  })
  it('a signed-out viewer never sees expired posts', () => {
    expect(boardPosts(list, null, undefined, NOW).map((p) => p.id)).toEqual(['new', 'old'])
  })
})

describe('newestPosts (home card)', () => {
  it('the newest n that everyone can see', () => {
    const list = [post({ id: 'a', created_at: day(-3) }), post({ id: 'hidden', hidden_at: day(-1), created_at: day(-1) }),
      post({ id: 'b', created_at: day(-2) }), post({ id: 'c', created_at: day(-4) }), post({ id: 'x', author_id: 'me', expires_at: day(-1), created_at: day(-0.5) })]
    expect(newestPosts(list, 2, NOW).map((p) => p.id)).toEqual(['b', 'a'])
  })
})

describe('postState', () => {
  it('hidden, then expired, then the status', () => {
    expect(postState(post({ hidden_at: day(-1), expires_at: day(-1) }), NOW)).toBe('hidden')
    expect(postState(post({ expires_at: day(-1), status: 'resolved' }), NOW)).toBe('expired')
    expect(postState(post({ status: 'resolved' }), NOW)).toBe('resolved')
    expect(postState(post(), NOW)).toBe('active')
  })
})

describe('hasText', () => {
  it('rejects whitespace, newlines, tabs and zero-width characters only', () => {
    expect(hasText('מפתח')).toBe(true)
    expect(hasText(' \n\t\u00a0')).toBe(false)
    expect(hasText('\u200b\u200d\ufeff\u2060')).toBe(false)
    expect(hasText('')).toBe(false)
  })
})

describe('limitMessage / photoError', () => {
  const msgs = { post: 'P', comment: 'C' }
  it('maps the server rate-limit tokens', () => {
    expect(limitMessage(new Error('community:post_limit'), msgs)).toBe('P')
    expect(limitMessage(new Error('community:comment_limit'), msgs)).toBe('C')
    expect(limitMessage(new Error('other'), msgs)).toBeNull()
    expect(limitMessage('community:post_limit', msgs)).toBeNull()
  })
  it('images only, up to 5 MB', () => {
    expect(photoError({ name: 'a.jpg', type: 'image/jpeg', size: 1000 })).toBeNull()
    expect(photoError({ name: 'a.pdf', type: 'application/pdf', size: 1000 })).toBe(he.community.errors.notImage)
    expect(photoError({ name: 'a.jpg', type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 })).toBe(he.community.errors.tooBig)
  })
})
