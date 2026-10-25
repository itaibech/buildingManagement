import { describe, expect, it } from 'vitest'
import { daysSince, emailStatusOf, lastReminders, reminderState } from './reminders'

const log = [
  { created_at: '2026-10-20T08:00:00Z', apartment_ids: ['a1', 'a2'], dry_run: false },
  { created_at: '2026-10-10T08:00:00Z', apartment_ids: ['a1'], dry_run: false },
  { created_at: '2026-10-24T08:00:00Z', apartment_ids: ['a3'], dry_run: true },
]

describe('lastReminders (email_log, kind debt)', () => {
  it('keeps the newest send per apartment', () => {
    const m = lastReminders(log)
    expect(m.get('a1')).toEqual({ at: '2026-10-20T08:00:00Z', dryRun: false })
    expect(m.get('a3')?.dryRun).toBe(true)
    expect(m.has('a9')).toBe(false)
  })
})

describe('daysSince', () => {
  it('counts whole Israel days', () => {
    expect(daysSince('2026-10-20T08:00:00Z', '2026-10-25')).toBe(5)
    expect(daysSince('2026-10-24T22:30:00Z', '2026-10-25')).toBe(0)
  })
})

describe('reminderState', () => {
  it('ready when there is an email and sending works', () => {
    expect(reminderState({ hasEmail: true, status: 'live' })).toEqual({ disabled: false, reason: null, testMode: false })
  })
  it('no resident email: disabled with the reason', () => {
    expect(reminderState({ hasEmail: false, status: 'live' })).toEqual({ disabled: true, reason: 'noEmail', testMode: false })
  })
  it('email not available: disabled', () => {
    expect(reminderState({ hasEmail: true, status: 'unavailable' })).toEqual({ disabled: true, reason: 'unavailable', testMode: false })
  })
  it('dry run: still enabled, marked as test mode', () => {
    expect(reminderState({ hasEmail: true, status: 'dryRun' })).toEqual({ disabled: false, reason: null, testMode: true })
  })
  it('while the status is loading it waits (disabled, no reason)', () => {
    expect(reminderState({ hasEmail: true, status: 'loading' })).toEqual({ disabled: true, reason: null, testMode: false })
  })
})

describe('emailStatusOf (send-email status reply)', () => {
  it('any HTTP reply is reachable; dryRun comes from the body', () => {
    expect(emailStatusOf(200, { status: true, dryRun: false })).toBe('live')
    expect(emailStatusOf(200, { status: true, dryRun: true })).toBe('dryRun')
    expect(emailStatusOf(400, { error: 'לא נמצאה כתובת מייל בפרופיל שלכם' })).toBe('dryRun')
    expect(emailStatusOf(403, { dryRun: false })).toBe('live')
  })
  it('only a network error or a 5xx is unavailable', () => {
    expect(emailStatusOf(null, null)).toBe('unavailable')
    expect(emailStatusOf(500, { error: 'x' })).toBe('unavailable')
    expect(emailStatusOf(503, null)).toBe('unavailable')
  })
})
