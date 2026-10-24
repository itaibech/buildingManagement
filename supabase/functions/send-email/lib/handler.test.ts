import { describe, expect, it, vi } from 'vitest'
import { callerFrom, type AuthClient } from './db.ts'
import { handle, type Deps } from './handler.ts'
import type { DataSource, LogRow } from './types.ts'
import type { MailMessage, Transport } from './transport.ts'

const A1 = '11111111-1111-4111-8111-111111111111'
const A2 = '22222222-2222-4222-8222-222222222222'
const A3 = '33333333-3333-4333-8333-333333333333'
const T1 = '44444444-4444-4444-8444-444444444444'

function fakeData(over: Partial<DataSource> = {}): DataSource & { logs: LogRow[] } {
  const logs: LogRow[] = []
  return {
    logs,
    context: async () => ({ building: { id: 'b1', name: 'הבניין', payment_instructions: 'ביט', committee_contact: null }, email: 'admin@example.test', name: 'מנהלת' }),
    apartments: async () => [{ id: A1, number: 1 }, { id: A2, number: 2 }, { id: A3, number: 3 }],
    residents: async () => [
      { apartment_id: A1, full_name: 'דנה', email: 'dana@example.test' },
      { apartment_id: A2, full_name: 'רון', email: 'ron@example.test' },
      { apartment_id: A2, full_name: 'רונית', email: 'ronit@example.test' },
      { apartment_id: A3, full_name: 'גל', email: null },
    ],
    announcement: async () => ({ title: 'הודעה', body: 'גוף' }),
    ticket: async () => ({ id: T1, title: 'נזילה', status: 'in_progress', location: 'לובי', latestComment: null, openerApartmentId: A2 }),
    balances: async () => [{ apartmentId: A1, balance: 300 }, { apartmentId: A2, balance: 0 }, { apartmentId: A3, balance: 50 }],
    ledger: async () => [{ apartmentId: A1, month: '2026-10-01', charged: 300, paid: 0 }],
    sentToday: async () => 0,
    log: async (row) => { logs.push(row) },
    ...over,
  }
}

function fakeTransport(dryRun: boolean): Transport & { sent: MailMessage[] } {
  const sent: MailMessage[] = []
  return { provider: 'appsscript', dryRun, reason: dryRun ? 'not_configured' : null, sent, send: async (m) => { sent.push(m); return { ok: true } } }
}

function deps(over: Partial<Deps> = {}): Deps & { data: ReturnType<typeof fakeData>; transport: ReturnType<typeof fakeTransport> } {
  return { caller: async () => ({ userId: 'u1', isAdmin: true }), data: fakeData(), transport: fakeTransport(true), env: {}, sleep: async () => undefined, ...over } as Deps & {
    data: ReturnType<typeof fakeData>; transport: ReturnType<typeof fakeTransport>
  }
}

function authClient(isAdmin: boolean, user: { id: string } | null = { id: 'u2' }): AuthClient {
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    rpc: async () => ({ data: isAdmin, error: null }),
  }
}

describe('handle: auth', () => {
  it('a non-admin (mocked supabase client) gets 403 and nothing is read or sent', async () => {
    const d = deps({ caller: () => callerFrom(authClient(false)) })
    const context = vi.spyOn(d.data, 'context')
    const r = await handle({ kind: 'announcement', id: T1 }, d)
    expect(r.status).toBe(403)
    expect(context).not.toHaveBeenCalled()
    expect(d.transport.sent).toHaveLength(0)
  })
  it('no signed-in user gets 401', async () => {
    expect((await handle({ kind: 'test' }, deps({ caller: () => callerFrom(authClient(true, null)) }))).status).toBe(401)
  })
  it('an admin passes callerFrom', async () => {
    expect(await callerFrom(authClient(true))).toEqual({ userId: 'u2', isAdmin: true })
  })
  it('a bad request gets 400', async () => {
    expect((await handle({ kind: 'nope' }, deps())).status).toBe(400)
  })
})

describe('handle: announcement', () => {
  it('preview counts recipients without sending or logging', async () => {
    const d = deps()
    const r = await handle({ kind: 'announcement', id: T1, preview: true }, d)
    expect(r).toEqual({ status: 200, body: { preview: true, recipients: 3, skipped: [], dryRun: true, reason: 'not_configured', remainingToday: 90 } })
    expect(d.transport.sent).toHaveLength(0)
    expect(d.data.logs).toHaveLength(0)
  })
  it('sends one email per recipient, logs it, and returns counts only (no addresses)', async () => {
    const d = deps()
    const r = await handle({ kind: 'announcement', id: T1, apartmentIds: [A2] }, d)
    expect(d.transport.sent.map((m) => m.to)).toEqual(['ron@example.test', 'ronit@example.test'])
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ sent: 2, failed: 0, recipients: 2, dryRun: true })
    expect(JSON.stringify(r.body)).not.toContain('@example.test')
    expect(d.data.logs).toEqual([{ building_id: 'b1', sent_by: 'u1', kind: 'announcement', ref_id: T1, apartment_ids: [A2],
      recipients: 2, sent: 2, failed: 0, skipped: 0, dry_run: true, error: null }])
  })
  it('404 when the announcement does not exist', async () => {
    expect((await handle({ kind: 'announcement', id: T1 }, deps({ data: fakeData({ announcement: async () => null }) }))).status).toBe(404)
  })
})

describe('handle: ticket, debt, test', () => {
  it("a ticket defaults to the opener's apartment", async () => {
    const d = deps()
    await handle({ kind: 'ticket', id: T1, note: 'הטכנאי מגיע מחר' }, d)
    expect(d.transport.sent.map((m) => m.to)).toEqual(['ron@example.test', 'ronit@example.test'])
    expect(d.transport.sent[0].text).toContain('הטכנאי מגיע מחר')
    expect(d.transport.sent[0].subject).toBe('עדכון בקריאת שירות: נזילה')
  })
  it('debt: personalised per apartment; apartments with nothing owed are skipped and reported by number', async () => {
    const d = deps()
    const r = await handle({ kind: 'debt', apartmentIds: 'all' }, d)
    expect(d.transport.sent.map((m) => [m.to, m.subject])).toEqual([['dana@example.test', 'תזכורת תשלום – דירה 1']])
    expect(r.body).toMatchObject({ sent: 1, skipped: [2] })
    expect(d.data.logs[0]).toMatchObject({ kind: 'debt', skipped: 1 })
  })
  it("test: one email to the admin's own address", async () => {
    const d = deps()
    await handle({ kind: 'test' }, d)
    expect(d.transport.sent.map((m) => m.to)).toEqual(['admin@example.test'])
  })
})

describe('handle: sending', () => {
  it('beyond the daily cap: 429 with how many remain, nothing sent', async () => {
    const d = deps({ transport: fakeTransport(false), env: { EMAIL_DAILY_CAP: '3' }, data: fakeData({ sentToday: async () => 2 }) })
    const r = await handle({ kind: 'announcement', id: T1 }, d)
    expect(r.status).toBe(429)
    expect(JSON.stringify(r.body)).toContain('1')
    expect(d.transport.sent).toHaveLength(0)
  })
  it('throttles real sends ~500 ms apart and counts failures', async () => {
    const sleep = vi.fn(async () => undefined)
    const transport = fakeTransport(false)
    transport.send = async (m) => (m.to.startsWith('ron@') ? { ok: false, error: 'quota' } : { ok: true })
    const d = deps({ transport, sleep })
    const r = await handle({ kind: 'announcement', id: T1 }, d)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(500)
    expect(r.body).toMatchObject({ sent: 2, failed: 1, dryRun: false })
    expect(d.data.logs[0]).toMatchObject({ sent: 2, failed: 1, error: 'quota', dry_run: false })
  })
})
