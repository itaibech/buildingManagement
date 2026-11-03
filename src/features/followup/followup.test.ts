import { describe, expect, it } from 'vitest'
import type { LedgerRow } from '../finance/ledger'
import {
  daysOverdue, debtState, DEFAULT_SETTINGS, episodeOver, isFollowupStatus, isSkipReason, isStep, nextStep, oldestOpenMonth, openEpisode,
  runDecision, sendable, stepFor, type Followup, type Step,
} from './followup'

const row = (month: string, charged: number, paid: number): LedgerRow => ({ apartment_id: 'a', month, charged, paid })
const ON = { ...DEFAULT_SETTINGS, enabled: true }
const flags = { archived: false, exempt: false }
const TODAY = '2026-11-03'

let seq = 0
const done = (step: Step, o: Partial<Followup> = {}): Followup => ({
  id: `f${++seq}`, apartmentId: 'a', step, status: step === 3 ? 'open' : 'sent', skipReason: null, debtAmount: 300,
  oldestMonth: '2026-09-01', daysOverdue: 40, createdAt: '2026-10-10T07:00:00Z', sentAt: null, doneAt: null, recipients: 1,
  episodeClosedAt: null, ...o,
})

describe('days overdue', () => {
  it('counts from the first day of the oldest unpaid month', () => {
    expect(daysOverdue('2026-10-01', TODAY)).toBe(33)
    expect(daysOverdue('2026-11-01', TODAY)).toBe(2)
  })
  it('a partial payment leaves the month open; paying it in full moves to the next month', () => {
    expect(oldestOpenMonth([row('2026-08-01', 300, 100), row('2026-09-01', 300, 0)])).toBe('2026-08-01')
    expect(oldestOpenMonth([row('2026-08-01', 300, 300), row('2026-09-01', 300, 0)])).toBe('2026-09-01')
  })
  it('credit from an overpaid month is used first, oldest month still first (settlementPlan)', () => {
    // Aug open 300, Sep overpaid by 250: balance 50, taken from August.
    expect(oldestOpenMonth([row('2026-08-01', 300, 0), row('2026-09-01', 0, 250)])).toBe('2026-08-01')
    // Credit covers everything: nothing open.
    expect(oldestOpenMonth([row('2026-08-01', 300, 0), row('2026-09-01', 0, 400)])).toBeNull()
  })
})

describe('debtState', () => {
  it('skips: paid, credit, archived, exempt, below the minimum (₪50 by default)', () => {
    expect(debtState([row('2026-08-01', 300, 300)], flags, ON, TODAY).skip).toBe('paid')
    expect(debtState([row('2026-08-01', 300, 500)], flags, ON, TODAY).skip).toBe('paid')
    expect(debtState([row('2026-08-01', 300, 0)], { archived: true, exempt: false }, ON, TODAY).skip).toBe('archived')
    expect(debtState([row('2026-08-01', 300, 0)], { archived: false, exempt: true }, ON, TODAY).skip).toBe('exempt')
    expect(debtState([row('2026-08-01', 49.99, 0)], flags, ON, TODAY).skip).toBe('below_min')
    expect(debtState([row('2026-08-01', 50, 0)], flags, ON, TODAY)).toEqual({ balance: 50, oldestMonth: '2026-08-01', days: 94, skip: null })
  })
  it('the minimum is the building\'s', () => {
    expect(debtState([row('2026-08-01', 80, 0)], flags, { ...ON, minAmount: 100 }, TODAY).skip).toBe('below_min')
  })
})

describe('stepFor', () => {
  it('the highest step reached: 10 / 30 / 60 days', () => {
    expect([9, 10, 29, 30, 59, 60, 400].map((d) => stepFor(d, ON))).toEqual([null, 1, 1, 2, 2, 3, 3])
  })
  it('a switched-off step is passed over', () => {
    expect(stepFor(45, { ...ON, firmOn: false })).toBe(1)
    expect(stepFor(70, { ...ON, letterOn: false })).toBe(2)
  })
})

describe('runDecision (once per episode)', () => {
  const owes = (month: string) => debtState([row(month, 300, 0)], flags, ON, TODAY)
  it('off: nothing at all', () => {
    expect(runDecision(owes('2026-08-01'), [], DEFAULT_SETTINGS)).toEqual({ close: false, create: null })
  })
  it('records the step reached, once', () => {
    expect(runDecision(owes('2026-10-01'), [], ON)).toEqual({ close: false, create: 2 })
    expect(runDecision(owes('2026-10-01'), [done(2, { oldestMonth: '2026-10-01' })], ON)).toEqual({ close: false, create: null })
  })
  it('an apartment first seen at 94 days gets only the task (no catch-up emails)', () => {
    expect(runDecision(owes('2026-08-01'), [], ON).create).toBe(3)
  })
  it('a partial payment inside the oldest month keeps the episode: no step repeated, the next one follows', () => {
    const partial = debtState([row('2026-09-01', 300, 100), row('2026-10-01', 300, 0)], flags, ON, TODAY)
    expect(runDecision(partial, [done(1), done(2)], ON)).toEqual({ close: false, create: 3 })
  })
  it('the arrears paid and a newer month open: a new episode with its own steps', () => {
    const later = debtState([row('2026-09-01', 300, 300), row('2026-10-01', 300, 0)], flags, ON, TODAY)
    expect(later.oldestMonth).toBe('2026-10-01')
    expect(episodeOver(later, [done(1), done(2)])).toBe(true)
    expect(runDecision(later, [done(1), done(2)], ON)).toEqual({ close: true, create: 2 })
  })
  it('a skipped (superseded or stale) step does not count', () => {
    expect(runDecision(owes('2026-10-01'), [done(1, { status: 'skipped', skipReason: 'superseded' })], ON).create).toBe(2)
    expect(runDecision(owes('2026-10-01'), [done(2, { status: 'skipped', skipReason: 'stale' })], ON).create).toBe(2)
  })
  it('payoff closes the episode; the next debt starts over at step 1', () => {
    const rows = [done(1), done(2)]
    expect(runDecision(debtState([row('2026-08-01', 300, 300)], flags, ON, TODAY), rows, ON)).toEqual({ close: true, create: null })
    const closed = rows.map((f) => ({ ...f, episodeClosedAt: '2026-11-01T07:00:00Z' }))
    const fresh = debtState([row('2026-08-01', 300, 300), row('2026-10-20', 300, 0)], flags, ON, TODAY)
    expect(openEpisode(closed)).toEqual([])
    expect(runDecision(fresh, openEpisode(closed), ON)).toEqual({ close: false, create: 1 })
  })
  it('below the minimum: no step, the episode stays open', () => {
    expect(runDecision(debtState([row('2026-08-01', 30, 0)], flags, ON, TODAY), [done(1)], ON)).toEqual({ close: false, create: null })
  })
})

describe('sendable (no stale step is emailed)', () => {
  const pending2 = done(2, { status: 'pending' })
  it('a pending step 2 of the same debt, still due', () => {
    const st = debtState([row('2026-09-01', 300, 0)], flags, ON, TODAY)
    expect(sendable(pending2, st, [pending2], ON)).toBe(true)
  })
  it('arrears paid, the new month\'s fee open: not sent', () => {
    const st = debtState([row('2026-09-01', 300, 300), row('2026-11-01', 300, 0)], flags, ON, TODAY)
    expect(st.days).toBe(2)
    expect(sendable(pending2, st, [pending2], ON)).toBe(false)
  })
  it('the step switched off, or its threshold raised past the days: not sent', () => {
    const st = debtState([row('2026-09-01', 300, 0)], flags, ON, TODAY)
    expect(sendable(pending2, st, [pending2], { ...ON, firmOn: false })).toBe(false)
    expect(sendable(pending2, st, [pending2], { ...ON, firmDays: 90, letterDays: 120 })).toBe(false)
  })
  it('paid, below the minimum, or the automation off: not sent; a claimed row is not pending', () => {
    expect(sendable(pending2, debtState([row('2026-09-01', 300, 300)], flags, ON, TODAY), [pending2], ON)).toBe(false)
    expect(sendable(pending2, debtState([row('2026-09-01', 30, 0)], flags, ON, TODAY), [pending2], ON)).toBe(false)
    const st = debtState([row('2026-09-01', 300, 0)], flags, ON, TODAY)
    expect(sendable(pending2, st, [pending2], DEFAULT_SETTINGS)).toBe(false)
    expect(sendable({ ...pending2, status: 'sending' }, st, [pending2], ON)).toBe(false)
    expect(sendable({ ...pending2, status: 'review' }, st, [pending2], ON)).toBe(false)
  })
})

describe('row guards', () => {
  it('narrow the database strings', () => {
    expect([1, 2, 3, 4, '1'].map(isStep)).toEqual([true, true, true, false, false])
    expect(['sending', 'review', 'lost'].map(isFollowupStatus)).toEqual([true, true, false])
    expect(['stale', 'no_email', null].map(isSkipReason)).toEqual([true, false, false])
  })
})

describe('nextStep', () => {
  it('the next step ahead and the days until it', () => {
    const s = debtState([row('2026-10-25', 300, 0)], flags, ON, TODAY)
    expect(nextStep(s, [], ON)).toEqual({ step: 1, inDays: 1 })
    expect(nextStep(s, [done(1)], ON)).toEqual({ step: 2, inDays: 21 })
    expect(nextStep(s, [done(3)], ON)).toBeNull()
  })
  it('nothing while off or without a debt', () => {
    const s = debtState([row('2026-10-25', 300, 0)], flags, ON, TODAY)
    expect(nextStep(s, [], DEFAULT_SETTINGS)).toBeNull()
    expect(nextStep(debtState([], flags, ON, TODAY), [], ON)).toBeNull()
  })
})
