import { describe, expect, it } from 'vitest'
import { needsTicketRef, qualify, type ChangeEvent, type TicketRef, type TicketRowLite, type Viewer } from './rules'

const ADMIN: Viewer = { userId: 'admin', isAdmin: true }
const RES: Viewer = { userId: 'res', isAdmin: false }
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
