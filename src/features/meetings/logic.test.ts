import { describe, expect, it } from 'vitest'
import { decisionNumbers } from './decisions'
import { actionsFor, isShortNotice, isTooEarly, matchesArchive, needsPublishReminder, tabOf } from './lifecycle'
import { quorumState, requiredQuorum } from './quorum'
import { unanimous, voteError } from './votes'

describe('quorum', () => {
  it('majority is floor(N/2)+1 of the apartments', () => {
    expect(requiredQuorum({ mode: 'majority', value: null }, 17)).toBe(9)
    expect(requiredQuorum({ mode: 'majority', value: null }, 16)).toBe(9)
    expect(requiredQuorum({ mode: 'majority', value: null }, 0)).toBe(1)
  })
  it('a percentage rounds up; a fixed number is used as is', () => {
    expect(requiredQuorum({ mode: 'percent', value: 60 }, 5)).toBe(3)
    expect(requiredQuorum({ mode: 'percent', value: 41 }, 5)).toBe(3)
    expect(requiredQuorum({ mode: 'fixed', value: 4 }, 17)).toBe(4)
  })
  it('counts present and proxy, not absent; a postponement makes any attendance valid', () => {
    const rows = [{ status: 'present' }, { status: 'proxy' }, { status: 'absent' }] as const
    const q = quorumState({ mode: 'majority', value: null }, 5, rows, false)
    expect(q).toMatchObject({ total: 5, attending: 2, required: 3, met: false, valid: false })
    expect(quorumState({ mode: 'majority', value: null }, 5, rows, true)).toMatchObject({ met: false, valid: true })
    expect(quorumState({ mode: 'fixed', value: 2 }, 5, rows, false)).toMatchObject({ met: true, valid: true })
  })
})

describe('votes', () => {
  it('the total may not exceed the attendees (proxies included)', () => {
    expect(voteError({ for: 2, against: 1, abstain: 0 }, 3)).toBeNull()
    expect(voteError({ for: 3, against: 1, abstain: 0 }, 3)).toMatch(/4/)
    expect(voteError({ for: -1, against: 0, abstain: 0 }, 3)).not.toBeNull()
  })
  it('"פה אחד" sets בעד to the voters present', () => {
    expect(unanimous(9)).toEqual({ for: 9, against: 0, abstain: 0 })
  })
})

describe('decision numbering', () => {
  const item = (id: string, position: number, decision: string, item_status = 'open') =>
    ({ id, position, decision, item_status, created_at: '2026-10-01T10:00:00Z' })
  it('numbers open items with a decision in agenda order, skipping removed, deferred and undecided ones', () => {
    const n = decisionNumbers([item('c', 3, 'ג'), item('a', 1, 'א'), item('b', 2, ''), item('d', 4, 'ד', 'removed'), item('e', 5, 'ה', 'deferred'), item('f', 6, 'ו')])
    expect([...n.entries()]).toEqual([['a', 1], ['c', 2], ['f', 3]])
  })
})

describe('lifecycle', () => {
  it('offers the actions of each state', () => {
    expect(actionsFor('draft')).toEqual(['edit', 'invite', 'delete'])
    expect(actionsFor('invited')).toEqual(['run', 'edit', 'updateInvite'])
    expect(actionsFor('in_progress')).toEqual(['run'])
    expect(actionsFor('closed')).toEqual(['sign', 'publish', 'addendum', 'print'])
    expect(actionsFor('published')).toEqual(['print', 'addendum'])
  })
  it('warns when the meeting is less than 5 days away', () => {
    const now = new Date('2026-10-24T10:00:00Z')
    expect(isShortNotice('2026-10-28T10:00:00Z', now)).toBe(true)
    expect(isShortNotice('2026-10-29T10:00:00Z', now)).toBe(false)
  })
  it('reminds to publish a meeting closed more than 3 days ago', () => {
    const now = new Date('2026-10-24T10:00:00Z')
    expect(needsPublishReminder({ status: 'closed', closed_at: '2026-10-20T09:00:00Z' }, now)).toBe(true)
    expect(needsPublishReminder({ status: 'closed', closed_at: '2026-10-22T09:00:00Z' }, now)).toBe(false)
    expect(needsPublishReminder({ status: 'published', closed_at: '2026-10-01T09:00:00Z' }, now)).toBe(false)
  })
  it('after a postponement, opening before the postponed time is too early', () => {
    expect(isTooEarly('2026-11-03T18:00:00Z', '2026-11-03T17:59:00Z')).toBe(true)
    expect(isTooEarly('2026-11-03T18:00:00Z', '2026-11-03T18:00:00Z')).toBe(false)
    expect(isTooEarly(null, '2026-11-03T10:00:00Z')).toBe(false)
  })
  it('sorts states into the page tabs', () => {
    expect(['draft', 'invited', 'in_progress', 'closed', 'published'].map(tabOf)).toEqual(['upcoming', 'upcoming', 'upcoming', 'pending', 'archive'])
  })
  it('searches the archive by title, decision text and year', () => {
    const m = { title: 'אסיפה שנתית', scheduled_at: '2025-03-01T18:00:00Z', decisions: ['אושר תקציב 2025'] }
    expect(matchesArchive(m, 'שנתית', null)).toBe(true)
    expect(matchesArchive(m, 'תקציב', null)).toBe(true)
    expect(matchesArchive(m, 'מעלית', null)).toBe(false)
    expect(matchesArchive(m, '', 2025)).toBe(true)
    expect(matchesArchive(m, '', 2026)).toBe(false)
  })
})

describe('Israel time', () => {
  it('formats and parses date and time in Asia/Jerusalem', async () => {
    const { fromInputs, meetingDate, meetingTime, toInputs } = await import('./fmt')
    expect(fromInputs('2026-11-03', '19:30')).toBe('2026-11-03T17:30:00.000Z')
    expect(fromInputs('2026-07-01', '20:00')).toBe('2026-07-01T17:00:00.000Z')
    expect(meetingDate('2026-11-03T17:30:00Z')).toBe('03/11/2026')
    expect(meetingTime('2026-11-03T17:30:00Z')).toBe('19:30')
    expect(toInputs('2026-07-01T17:00:00Z')).toEqual({ date: '2026-07-01', time: '20:00' })
  })
})

describe('live draft', () => {
  it('applies device drafts over server rows, field-checked', async () => {
    const { mergeAttendance, itemPatchFrom } = await import('./liveDraft')
    const rows = [{ id: 'r', meeting_id: 'm', apartment_id: 'a1', apartment_number: 1, status: 'present', attendee_name: 'א', proxy_name: '', proxy_file_path: null }] as const
    const merged = mergeAttendance(rows, { 'att:a1': { status: 'proxy', proxy_name: 'ב' }, 'att:a2': { status: 'bogus' } })
    expect(merged.a1).toEqual({ status: 'proxy', attendee_name: 'א', proxy_name: 'ב', proxy_file_path: null })
    expect(merged.a2?.status).toBe('absent')
    expect(itemPatchFrom({ votes_for: 2, votes_against: 1 })).toMatchObject({ votes_for: null, votes_against: null, votes_abstain: null })
  })
})
