import { describe, expect, it } from 'vitest'
import { todayISO } from '../../lib/dates'
import { addMonths, defaultRemindDays, dueBucket, nextDue, reminderWindow } from '../maintenance/nextDue'
import { attentionItems, contractStatus, effectiveEnd, latestContract, whatsappHref, type AttentionContract } from './logic'

const contract = (over: Partial<AttentionContract> = {}): AttentionContract => ({
  id: 'c1', supplier_id: 's1', title: 'שירות', created_at: '2026-01-01T00:00:00Z',
  ends_on: '2026-12-31', period: 'yearly', remind_days: 30, auto_renews: false, ...over,
})

describe('next due for inspections', () => {
  it('semiannual adds 6 months', () => expect(nextDue('2026-03-15', 'semiannual')).toBe('2026-09-15'))
  it('semiannual clamps Aug 31 to Feb 28', () => expect(nextDue('2026-08-31', 'semiannual')).toBe('2027-02-28'))
  it('semiannual clamps to a leap Feb 29', () => expect(nextDue('2027-08-31', 'semiannual')).toBe('2028-02-29'))
  it('monthly from Jan 31 lands on Feb 28', () => expect(nextDue('2026-01-31', 'monthly')).toBe('2026-02-28'))
  it('yearly from a leap day is Feb 28', () => expect(nextDue('2028-02-29', 'yearly')).toBe('2029-02-28'))
  it('addMonths rolls the year', () => expect(addMonths('2026-11-30', 3)).toBe('2027-02-28'))
  it('the reminder window is per task', () => {
    expect(dueBucket('2026-11-20', '2026-11-03', 7)).toBe('later')
    expect(dueBucket('2026-11-10', '2026-11-03', 7)).toBe('soon')
    expect(dueBucket('2026-11-02', '2026-11-03', 7)).toBe('overdue')
  })
})

describe('contractStatus', () => {
  it('active far from the end', () => expect(contractStatus(contract(), '2026-06-01')).toBe('active'))
  it('ending within the reminder window, inclusive', () => {
    expect(contractStatus(contract(), '2026-12-01')).toBe('ending')
    expect(contractStatus(contract(), '2026-11-30')).toBe('active')
    expect(contractStatus(contract(), '2026-12-31')).toBe('ending')
  })
  it('expired the day after the end', () => expect(contractStatus(contract(), '2027-01-01')).toBe('expired'))
  it('open-ended is active', () => expect(contractStatus(contract({ ends_on: null }), '2030-01-01')).toBe('active'))
  it('a custom window', () => expect(contractStatus(contract({ remind_days: 60 }), '2026-11-01')).toBe('ending'))
  it('auto-renewing never expires: it rolls to the next yearly end', () => {
    const c = contract({ auto_renews: true })
    expect(effectiveEnd(c, '2027-01-01')).toBe('2027-12-31')
    expect(contractStatus(c, '2027-01-01')).toBe('active')
    expect(contractStatus(c, '2027-12-15')).toBe('ending')
  })
  it('monthly auto-renew from Jan 31 keeps month ends (Feb 28, then Mar 31)', () => {
    const c = contract({ ends_on: '2026-01-31', period: 'monthly', auto_renews: true })
    expect(effectiveEnd(c, '2026-02-10')).toBe('2026-02-28')
    expect(effectiveEnd(c, '2026-03-01')).toBe('2026-03-31')
  })
})

describe('monthly reminders', () => {
  it('defaults to 7 days for monthly, 30 otherwise', () => {
    expect(defaultRemindDays(1)).toBe(7)
    expect(defaultRemindDays(12)).toBe(30)
    expect(defaultRemindDays(null)).toBe(30)
  })
  it('caps the window below the period', () => {
    expect(reminderWindow(30, 1)).toBe(27)
    expect(reminderWindow(7, 1)).toBe(7)
    expect(reminderWindow(120, 3)).toBe(88)
    expect(reminderWindow(400, 12)).toBe(364)
    expect(reminderWindow(60, null)).toBe(60)
  })
  it('a monthly contract with a 30-day reminder is not "ending" a month ahead', () => {
    const c = contract({ ends_on: '2026-12-02', period: 'monthly', remind_days: 30 })
    expect(contractStatus(c, '2026-11-03')).toBe('active')
    expect(contractStatus(c, '2026-11-10')).toBe('ending')
  })
})

describe('Asia/Jerusalem today', () => {
  it('a contract ending Jan 31 has expired at 00:30 Israel time on Feb 1 (still Jan 31 in UTC)', () => {
    const today = todayISO(new Date('2026-01-31T22:30:00Z'))
    expect(today).toBe('2026-02-01')
    expect(contractStatus(contract({ ends_on: '2026-01-31' }), today)).toBe('expired')
  })
  it('summer time: 23:30 UTC on Jun 30 is already Jul 1 in Israel', () => {
    expect(todayISO(new Date('2026-06-30T23:30:00Z'))).toBe('2026-07-01')
  })
})

describe('attentionItems', () => {
  it('lists only the current contract per supplier and due inspections, soonest first', () => {
    const old = contract({ id: 'old', ends_on: '2025-12-31', created_at: '2025-01-01T00:00:00Z' })
    const current = contract({ id: 'new', ends_on: '2026-11-20' })
    const items = attentionItems([old, current], [
      { id: 't1', title: 'כיבוי אש', next_due: '2026-10-01', remind_days: 30, frequency: 'yearly' },
      { id: 't2', title: 'מעלית', next_due: '2027-05-01', remind_days: 30, frequency: 'yearly' },
      { id: 't3', title: 'ללא מועד', next_due: null, remind_days: 30, frequency: 'yearly' },
    ], '2026-11-03')
    expect(items.map((i) => [i.kind, i.id, i.status])).toEqual([['inspection', 't1', 'overdue'], ['contract', 'new', 'ending']])
  })
  it('latestContract prefers the newest contract, not an open-ended one', () => {
    const older = contract({ id: 'open', ends_on: null, starts_on: '2024-01-01', created_at: '2024-01-01T00:00:00Z' })
    const newer = contract({ id: 'new', starts_on: '2026-01-01', created_at: '2026-01-01T00:00:00Z' })
    expect(latestContract([older, newer])?.id).toBe('new')
    // Without start dates: the one added last.
    expect(latestContract([contract({ id: 'x', created_at: '2026-02-01T00:00:00Z' }), contract({ id: 'y', created_at: '2026-03-01T00:00:00Z' })])?.id).toBe('y')
  })
  it('a monthly task with a 30-day reminder is capped below the month: not flagged all month', () => {
    const t = { id: 'm', title: 'מעלית', remind_days: 30, frequency: 'monthly' as const }
    expect(attentionItems([], [{ ...t, next_due: '2026-12-01' }], '2026-11-03')).toEqual([])
    expect(attentionItems([], [{ ...t, next_due: '2026-11-25' }], '2026-11-03').map((i) => i.id)).toEqual(['m'])
  })
})

describe('whatsappHref', () => {
  it('turns a local mobile into 972', () => expect(whatsappHref('050-1234567')).toBe('https://wa.me/972501234567'))
  it('keeps an international number', () => expect(whatsappHref('+972 50 123 4567')).toBe('https://wa.me/972501234567'))
  it('null without enough digits', () => expect(whatsappHref('')).toBeNull())
})
