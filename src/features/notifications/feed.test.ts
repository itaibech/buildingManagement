import { describe, expect, it } from 'vitest'
import { buildFeed, unseenTicketCount, unseenTicketIds, type FeedAnnouncement, type TicketActivity } from './feed'

const NOW = new Date('2026-10-24T12:00:00Z')
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 86400_000).toISOString()

const act = (o: Partial<TicketActivity> = {}): TicketActivity => ({
  ticket_id: 't1', title: 'נזילה', status: 'open', opened_by: 'res', apartment_number: 4,
  activity_at: daysAgo(1), activity_by: 'res', activity_kind: 'created', unseen: true, ...o,
})
const ann = (o: Partial<FeedAnnouncement> = {}): FeedAnnouncement => ({ id: 'a1', title: 'ניקיון', created_at: daysAgo(2), isRead: false, ...o })

describe('ticket badge', () => {
  it('counts only unseen calls', () => {
    const list = [act(), act({ ticket_id: 't2', unseen: false }), act({ ticket_id: 't3' })]
    expect(unseenTicketCount(list)).toBe(2)
    expect([...unseenTicketIds(list)]).toEqual(['t1', 't3'])
    expect(unseenTicketCount(undefined)).toBe(0)
  })
})

describe('buildFeed', () => {
  it('merges announcements and call activity, newest first, with paths and unseen flags', () => {
    const feed = buildFeed([ann()], [act(), act({ ticket_id: 't2', activity_at: daysAgo(3), activity_kind: 'comment', unseen: false })], NOW)
    expect(feed.map((f) => [f.kind, f.id, f.unseen, f.path])).toEqual([
      ['ticket', 't1', true, '/tickets/t1'],
      ['announcement', 'a1', true, '/announcements'],
      ['ticket', 't2', false, '/tickets/t2'],
    ])
    expect(feed[0]).toMatchObject({ title: 'נזילה', subtitle: 'תקלה חדשה' })
    expect(feed[2].subtitle).toBe('תגובה חדשה')
    expect(feed[1].subtitle).toBe('הודעה חדשה')
  })

  it('describes a status change with the new status', () => {
    const [item] = buildFeed([], [act({ activity_kind: 'status', status: 'closed' })], NOW)
    expect(item.subtitle).toBe('הסטטוס עודכן: סגורה')
  })

  it('keeps the last 30 days only, and drops calls with no activity by others', () => {
    const feed = buildFeed([ann({ created_at: daysAgo(31) })], [act({ activity_at: daysAgo(40) }), act({ ticket_id: 't2', activity_at: null, activity_kind: null })], NOW)
    expect(feed).toEqual([])
  })
})
