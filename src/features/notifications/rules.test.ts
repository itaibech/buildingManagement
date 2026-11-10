import { describe, expect, it } from 'vitest'
import { needsTicketRef, qualify, type ChangeEvent, type TicketRef, type TicketRowLite, type Viewer } from './rules'

const ADMIN: Viewer = { userId: 'admin', isAdmin: true, can: () => true }
const RES: Viewer = { userId: 'res', isAdmin: false, can: (k) => k === 'announcements' || k === 'tickets' }
const ONLY = (...keys: string[]): Viewer => ({ userId: 'res', isAdmin: false, can: (k) => keys.includes(k) })
const TODAY = '2026-10-24'

const ticketRow = (o: Partial<TicketRowLite> = {}): TicketRowLite => ({
  id: 't1', title: 'נזילה', status: 'open', opened_by: 'res', last_activity_by: 'res', last_activity_kind: 'created', ...o,
})
const ref = (o: Partial<TicketRef> = {}): TicketRef => ({ opened_by: 'res', title: 'נזילה', apartment_number: 4, ...o })
const announcement = (author: string | null, expires_at: string | null = null): ChangeEvent => ({
  table: 'announcements', row: { id: 'a1', title: 'ניקיון חדר מדרגות', author_id: author, expires_at },
})
const ticket = (type: 'INSERT' | 'UPDATE', o: Partial<TicketRowLite> = {}): ChangeEvent => ({ table: 'tickets', type, row: ticketRow(o) })
const comment = (author: string | null): ChangeEvent => ({ table: 'ticket_comments', row: { id: 'c1', ticket_id: 't1', author_id: author } })

describe('qualify: announcements', () => {
  it('notifies everyone but the author, with a link to the announcements page', () => {
    expect(qualify(announcement('admin'), RES, null, TODAY)).toMatchObject({ kind: 'announcement', text: 'הודעה חדשה: ניקיון חדר מדרגות', path: '/announcements' })
    expect(qualify(announcement('admin'), ADMIN, null, TODAY)).toBeNull()
    expect(qualify(announcement('other-admin'), ADMIN, null, TODAY)).not.toBeNull()
  })

  it('skips an announcement that is already expired', () => {
    expect(qualify(announcement('admin', '2026-10-01'), RES, null, TODAY)).toBeNull()
  })
})

describe('qualify: service calls for admins', () => {
  it('a new call by a resident, with the apartment number', () => {
    expect(qualify(ticket('INSERT'), ADMIN, ref(), TODAY)).toMatchObject({ kind: 'ticketNew', text: 'תקלה חדשה: נזילה · דירה 4', path: '/tickets/t1' })
    expect(qualify(ticket('INSERT'), ADMIN, ref({ apartment_number: null }), TODAY)?.text).toBe('תקלה חדשה: נזילה')
  })

  it('never for the admin\'s own call', () => {
    expect(qualify(ticket('INSERT', { opened_by: 'admin', last_activity_by: 'admin' }), ADMIN, ref(), TODAY)).toBeNull()
  })

  it('a resident editing their call', () => {
    expect(qualify(ticket('UPDATE', { last_activity_kind: 'edited' }), ADMIN, ref(), TODAY)).toMatchObject({ kind: 'ticketEdited', text: 'התקלה עודכנה: נזילה' })
  })

  it('not another admin\'s status change or edit', () => {
    expect(qualify(ticket('UPDATE', { last_activity_kind: 'status', last_activity_by: 'admin2' }), ADMIN, ref(), TODAY)).toBeNull()
    expect(qualify(ticket('UPDATE', { last_activity_kind: 'edited', last_activity_by: 'admin2' }), ADMIN, ref(), TODAY)).toBeNull()
  })

  it('a comment on any call by someone else', () => {
    expect(qualify(comment('other'), ADMIN, ref({ opened_by: 'other' }), TODAY)).toMatchObject({ kind: 'ticketComment', text: 'תגובה חדשה: נזילה', path: '/tickets/t1' })
    expect(qualify(comment('admin'), ADMIN, ref(), TODAY)).toBeNull()
  })
})

describe('qualify: service calls for residents', () => {
  it('a status change on a call they opened', () => {
    const n = qualify(ticket('UPDATE', { status: 'in_progress', last_activity_kind: 'status', last_activity_by: 'admin' }), RES, null, TODAY)
    expect(n).toMatchObject({ kind: 'ticketStatus', text: 'הסטטוס עודכן: בטיפול', detail: 'נזילה', path: '/tickets/t1' })
  })

  it('not on someone else\'s call, and not for other kinds of change', () => {
    expect(qualify(ticket('UPDATE', { opened_by: 'x', last_activity_kind: 'status', last_activity_by: 'admin' }), RES, null, TODAY)).toBeNull()
    expect(qualify(ticket('UPDATE', { last_activity_kind: 'other', last_activity_by: 'admin' }), RES, null, TODAY)).toBeNull()
  })

  it('never a new call (that is for admins)', () => {
    expect(qualify(ticket('INSERT', { opened_by: 'x', last_activity_by: 'x' }), RES, ref({ opened_by: 'x' }), TODAY)).toBeNull()
  })

  it('a comment by someone else on their own call only', () => {
    expect(qualify(comment('admin'), RES, ref(), TODAY)).toMatchObject({ kind: 'ticketComment' })
    expect(qualify(comment('res'), RES, ref(), TODAY)).toBeNull()
    expect(qualify(comment('admin'), RES, ref({ opened_by: 'x' }), TODAY)).toBeNull()
    expect(qualify(comment('admin'), RES, null, TODAY)).toBeNull()
  })

  it('a timeline status line (0039) is not a second notice; a details line is', () => {
    const line = (event: string): ChangeEvent => ({ table: 'ticket_comments', row: { id: 'c1', ticket_id: 't1', author_id: 'admin', event } })
    expect(qualify(line('status'), RES, ref(), TODAY)).toBeNull()
    expect(qualify(line('details'), RES, ref(), TODAY)).toMatchObject({ kind: 'ticketComment' })
  })
})

describe('needsTicketRef', () => {
  it('only comments, and new calls for admins', () => {
    expect(needsTicketRef(comment('x'), RES)).toBe(true)
    expect(needsTicketRef(ticket('INSERT'), ADMIN)).toBe(true)
    expect(needsTicketRef(ticket('INSERT'), RES)).toBe(false)
    expect(needsTicketRef(ticket('UPDATE'), ADMIN)).toBe(false)
    expect(needsTicketRef(announcement('x'), ADMIN)).toBe(false)
  })
})

describe('permissions (Task 18)', () => {
  it('no announcement notice for a group without announcements', () => {
    expect(qualify(announcement('admin'), ONLY('tickets'), null, TODAY)).toBeNull()
    expect(qualify(announcement('admin'), ONLY('announcements'), null, TODAY)).not.toBeNull()
  })

  it('no call notice (status or comment) for a group without tickets, and no lookup for it', () => {
    expect(qualify(ticket('UPDATE', { last_activity_by: 'admin', last_activity_kind: 'status' }), ONLY('announcements'), null, TODAY)).toBeNull()
    expect(qualify(comment('admin'), ONLY('announcements'), ref(), TODAY)).toBeNull()
    expect(needsTicketRef(comment('admin'), ONLY('announcements'))).toBe(false)
    expect(qualify(ticket('UPDATE', { last_activity_by: 'admin', last_activity_kind: 'status' }), RES, null, TODAY)).not.toBeNull()
  })
})

describe('qualify: committee messages', () => {
  const message = (sender: string | null, apartment: number | null = 4): ChangeEvent =>
    ({ table: 'committee_messages', row: { id: 'm1', subject: 'רעש בלילה', sender_id: sender, apartment_number: apartment } })
  it('admins: a resident\'s message, with the apartment, opening "פניות דיירים"', () => {
    expect(qualify(message('res'), ADMIN, null, TODAY)).toEqual({ kind: 'committeeMessage', text: 'פנייה חדשה לוועד: רעש בלילה · דירה 4', path: '/committee-messages' })
    expect(qualify(message('res', null), ADMIN, null, TODAY)?.text).toBe('פנייה חדשה לוועד: רעש בלילה')
    expect(needsTicketRef(message('res'), ADMIN)).toBe(false)
  })
  it('never the sender, never a resident', () => {
    expect(qualify(message('admin'), ADMIN, null, TODAY)).toBeNull()
    expect(qualify(message('res'), RES, null, TODAY)).toBeNull()
  })
})

describe('qualify: community comments', () => {
  const event = (author: string | null, postAuthor: string | null): ChangeEvent =>
    ({ table: 'community_comments', row: { id: 'k1', post_id: 'p1', author_id: author, post_author_id: postAuthor } })
  const member = ONLY('community')
  it('notifies the post author about a comment by someone else, with a link to the post', () => {
    expect(qualify(event('other', 'res'), member, null, TODAY)).toMatchObject({ kind: 'communityComment', path: '/community/p1' })
    expect(needsTicketRef(event('other', 'res'), ADMIN)).toBe(false)
  })
  it('not their own comment, not someone else\'s post, not without the permission', () => {
    expect(qualify(event('res', 'res'), member, null, TODAY)).toBeNull()
    expect(qualify(event('other', 'someone'), member, null, TODAY)).toBeNull()
    expect(qualify(event('other', 'res'), ONLY('tickets'), null, TODAY)).toBeNull()
  })
})
