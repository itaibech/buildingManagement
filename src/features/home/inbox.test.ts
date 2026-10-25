import { describe, expect, it } from 'vitest'
import { inboxItems, staleDebtors, upcomingInvited } from './inbox'

const none = { pendingUsers: 0, unseenTickets: 0, overdueTasks: 0, toPublish: 0, invited: { count: 0, firstId: null }, staleDebtors: 0 }

describe('inboxItems', () => {
  it('nothing to do: no rows', () => {
    expect(inboxItems(none)).toEqual([])
  })
  it('one row per open kind, with its count and deep link, in a fixed order', () => {
    const items = inboxItems({ pendingUsers: 2, unseenTickets: 3, overdueTasks: 1, toPublish: 1, invited: { count: 2, firstId: 'm1' }, staleDebtors: 4 })
    expect(items.map((i) => [i.key, i.count, i.to])).toEqual([
      ['users', 2, '/users'],
      ['tickets', 3, '/tickets'],
      ['maintenance', 1, '/maintenance'],
      ['publish', 1, '/meetings?tab=pending'],
      ['invited', 2, '/meetings'],
      ['debtors', 4, '/finance?tab=balances'],
    ])
  })
  it('a single upcoming meeting links to the meeting itself', () => {
    expect(inboxItems({ ...none, invited: { count: 1, firstId: 'm1' } })).toEqual([{ key: 'invited', count: 1, to: '/meetings/m1' }])
  })
})

describe('upcomingInvited', () => {
  const now = new Date('2026-10-25T10:00:00Z')
  const m = (id: string, status: string, at: string) => ({ id, status, scheduled_at: at })
  it('invited meetings from now to 7 days ahead, soonest first', () => {
    const list = [m('a', 'invited', '2026-10-30T17:00:00Z'), m('b', 'invited', '2026-10-27T17:00:00Z'), m('c', 'invited', '2026-11-02T11:00:00Z'),
      m('d', 'draft', '2026-10-26T17:00:00Z'), m('e', 'invited', '2026-10-24T17:00:00Z')]
    expect(upcomingInvited(list, now)).toEqual({ count: 2, firstId: 'b' })
  })
})

describe('staleDebtors', () => {
  it('debtors with no reminder in the last 30 days', () => {
    const balances = [{ apartmentId: 'a1', balance: 100 }, { apartmentId: 'a2', balance: 50 }, { apartmentId: 'a3', balance: 0 }, { apartmentId: 'a4', balance: 10 }]
    const last = new Map([['a1', { at: '2026-10-20T08:00:00Z', dryRun: false }], ['a2', { at: '2026-09-01T08:00:00Z', dryRun: false }]])
    expect(staleDebtors(balances, last, '2026-10-25')).toBe(2)
  })
})
