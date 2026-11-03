import { describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { APP_URL, buildShareText, isPrivateLine, MAX_SHARE_LENGTH, shareChannel, shareText, whatsappUrl } from './share'

const meeting = { id: 'm-1', title: 'אסיפת דיירים', kind: 'general' as const, scheduled_at: '2026-11-10T18:30:00Z', location: 'לובי הבניין' }

describe('buildShareText', () => {
  it('meeting: bold title, kind, date and time (Israel), place, then the deep link', () => {
    const text = buildShareText('meeting', meeting)
    expect(text.split('\n')).toEqual([
      '*אסיפת דיירים*',
      he.meetings.kinds.general,
      he.share.meetingWhen('10/11/2026', '20:30'),
      he.share.meetingPlace('לובי הבניין'),
      '',
      he.share.details,
      `${APP_URL}/meetings/m-1`,
    ])
  })

  it('protocol: links to the meeting and says it was published', () => {
    const text = buildShareText('protocol', meeting)
    expect(text).toContain(he.share.protocolPublished('10/11/2026'))
    expect(text.endsWith(`${APP_URL}/meetings/m-1`)).toBe(true)
  })

  it('announcement: the first 3 lines of the body and the ?open= link', () => {
    const body = 'שורה 1\n\nשורה 2\nשורה 3\nשורה 4'
    const text = buildShareText('announcement', { id: 'a 1', title: ' הפסקת מים ', body })
    expect(text).toBe(`*הפסקת מים*\nשורה 1\nשורה 2\nשורה 3\n\n${he.share.details}\n${APP_URL}/announcements?open=a%201`)
  })

  it('never carries phone numbers or amounts', () => {
    const body = 'מחר תיקון בצנרת\nלפרטים: 050-1234567\nהחוב שלכם ₪660\nעלות 300 ש"ח\nתודה'
    const text = buildShareText('announcement', { id: 'a', title: 'תיקון', body })
    expect(text).not.toMatch(/050|660|300/)
    expect(text).toContain('מחר תיקון בצנרת\nתודה')
    expect(buildShareText('meeting', { ...meeting, location: 'אצל משה 0521234567' })).not.toContain('052')
  })

  it('stays within the length limit and keeps the link whole', () => {
    const long = Array.from({ length: 3 }, () => 'א'.repeat(500)).join('\n')
    const text = buildShareText('announcement', { id: 'x', title: 'ת'.repeat(300), body: long })
    expect(text.length).toBeLessThanOrEqual(MAX_SHARE_LENGTH)
    expect(text.endsWith(`${APP_URL}/announcements?open=x`)).toBe(true)
    expect(text.split('\n')[0]).toMatch(/…\*$/)
  })
})

describe('isPrivateLine', () => {
  it.each(['050-123-4567', '+972 52 123 4567', '03-1234567', '₪100', '100 ש"ח', '50 NIS'])('%s is private', (l) => expect(isPrivateLine(l)).toBe(true))
  it.each(['ישיבה ב-20:30', 'קומה 3, דירה 12', 'שנת 2026'])('%s is fine', (l) => expect(isPrivateLine(l)).toBe(false))
})

describe('whatsappUrl', () => {
  it('URL-encodes Hebrew, line breaks and the link', () => {
    const url = whatsappUrl('*שלום*\nhttps://x.y/#/a?open=1&b=2')
    expect(url.startsWith('https://wa.me/?text=')).toBe(true)
    expect(url).not.toMatch(/[\n א-ת]/)
    expect(url).toContain('%0A')
    expect(decodeURIComponent(url.slice('https://wa.me/?text='.length))).toBe('*שלום*\nhttps://x.y/#/a?open=1&b=2')
  })
})

describe('shareText fallback', () => {
  it('uses the OS sheet on mobile when navigator.share exists', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const open = vi.fn()
    expect(await shareText('hi', { share, mobile: true }, open)).toBe('native')
    expect(share).toHaveBeenCalledWith({ text: 'hi' })
    expect(open).not.toHaveBeenCalled()
  })

  it('falls back to wa.me without the API, or on desktop', async () => {
    const open = vi.fn()
    expect(shareChannel({ mobile: true })).toBe('whatsapp')
    expect(shareChannel({ share: vi.fn(), mobile: false })).toBe('whatsapp')
    expect(await shareText('hi', { mobile: true }, open)).toBe('whatsapp')
    expect(open).toHaveBeenCalledWith('https://wa.me/?text=hi')
  })

  it('falls back to wa.me when the share fails, but not when the user cancels', async () => {
    const open = vi.fn()
    const fail = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    expect(await shareText('hi', { share: fail, mobile: true }, open)).toBe('whatsapp')
    open.mockClear()
    const abort = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }))
    expect(await shareText('hi', { share: abort, mobile: true }, open)).toBe('cancelled')
    expect(open).not.toHaveBeenCalled()
  })
})
