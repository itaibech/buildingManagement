import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TicketActivity } from './feed'
import { handleChange, type HandlerContext } from './useRealtimeNotifications'

const m = vi.hoisted(() => ({ show: vi.fn(), system: vi.fn(), fetch: vi.fn() }))
vi.mock('./toasts', () => ({ showNotice: m.show }))
vi.mock('./system', () => ({ systemNotify: m.system }))
// The real client needs env vars CI doesn't have.
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('./api', () => ({ fetchActivity: m.fetch }))

const row: TicketActivity = {
  ticket_id: 't1', title: 'נזילה', status: 'open', opened_by: 'res', apartment_number: 4,
  activity_at: null, activity_by: null, activity_kind: null, unseen: false,
}

function ctx(o: Partial<HandlerContext> = {}): HandlerContext {
  return { viewer: { userId: 'admin', isAdmin: true, can: () => true }, client: new QueryClient(), navigate: vi.fn(), pathname: '/', ...o }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.fetch.mockResolvedValue([row])
})

describe('handleChange', () => {
  it('a comment: refreshes the call queries, looks up the call and shows a toast that opens it', async () => {
    const c = ctx()
    const invalidate = vi.spyOn(c.client, 'invalidateQueries')
    await handleChange({ table: 'ticket_comments', row: { id: 'c1', ticket_id: 't1', author_id: 'res' } }, c)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tickets'] })
    expect(m.show).toHaveBeenCalledWith(expect.objectContaining({ text: 'תגובה חדשה: נזילה', path: '/tickets/t1' }), expect.any(Function))
    m.show.mock.calls[0][1]()
    expect(c.navigate).toHaveBeenCalledWith('/tickets/t1')
    expect(m.system).toHaveBeenCalledTimes(1)
  })

  it('an announcement: refreshes announcements without a call lookup', async () => {
    const c = ctx({ viewer: { userId: 'res', isAdmin: false, can: () => true } })
    const invalidate = vi.spyOn(c.client, 'invalidateQueries')
    await handleChange({ table: 'announcements', row: { id: 'a1', title: 'מים', author_id: 'admin', expires_at: null } }, c)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['announcements'] })
    expect(m.fetch).not.toHaveBeenCalled()
    expect(m.show).toHaveBeenCalledWith(expect.objectContaining({ text: 'הודעה חדשה: מים' }), expect.any(Function))
  })

  it('never rejects: a failing lookup or system notification is swallowed', async () => {
    m.fetch.mockRejectedValue(new Error('offline'))
    m.system.mockRejectedValue(new Error('no worker'))
    const ev = { table: 'announcements', row: { id: 'a1', title: 'מים', author_id: 'admin', expires_at: null } } as const
    await expect(handleChange(ev, ctx({ viewer: { userId: 'res', isAdmin: false, can: () => true } }))).resolves.toBeUndefined()
    m.show.mockImplementation(() => { throw new Error('boom') })
    await expect(handleChange({ table: 'tickets', type: 'INSERT', row: {
      id: 't9', title: 'x', status: 'open', opened_by: 'res', last_activity_by: 'res', last_activity_kind: 'created',
    } }, ctx())).resolves.toBeUndefined()
    m.show.mockReset()
  })

  it('no toast for the viewer\'s own action, or when they are already on that page', async () => {
    await handleChange({ table: 'ticket_comments', row: { id: 'c1', ticket_id: 't1', author_id: 'admin' } }, ctx())
    await handleChange({ table: 'ticket_comments', row: { id: 'c2', ticket_id: 't1', author_id: 'res' } }, ctx({ pathname: '/tickets/t1' }))
    expect(m.show).not.toHaveBeenCalled()
    expect(m.system).not.toHaveBeenCalled()
  })
})
