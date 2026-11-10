import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_CONTACTS_PER_DAY, MAX_TICKET_NEW_PER_DAY } from './committee.ts'
import { handle, MAX_PER_CALL, type Deps } from './handler.ts'
import { DuplicateLogError } from './plan.ts'
import { createTransport, type FetchFn, type MailMessage, type Transport } from './transport.ts'
import type { Admin, Caller, CommitteeMessage, DataSource, LogRow, NewTicket, Reservation } from './types.ts'
import { parseRequest } from './validate.ts'

const T1 = '44444444-4444-4444-8444-444444444444'
const ADMIN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ADMIN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const RES = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NOW = Date.parse('2026-11-03T10:00:00Z')

const ADMINS: Admin[] = [
  { userId: ADMIN_A, name: 'אבי', email: 'avi@example.test' },
  { userId: ADMIN_B, name: 'בתיה', email: 'Batya@Example.test ' },
  { userId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'בלי מייל', email: null },
]

const ticket = (o: Partial<NewTicket> = {}): NewTicket => ({
  id: T1, title: 'נזילה <b>בלובי</b>', description: 'מים על הרצפה & ליד המעלית', location: 'לובי', openedBy: RES,
  createdAt: new Date(NOW - 5 * 60_000).toISOString(), ...o,
})

interface Over {
  ticket?: NewTicket | null; logged?: boolean; used?: number; limited?: boolean; email?: string | null; caller?: Caller; transport?: Transport
  env?: Record<string, string>
}

function setup(o: Over = {}) {
  const logs: LogRow[] = []
  const stored: CommitteeMessage[] = []
  const reserved: Reservation[] = []
  const sent: MailMessage[] = []
  const data = {
    context: async () => ({ building: { id: 'b1', name: 'הבניין', payment_instructions: null, committee_contact: null },
      email: o.email === undefined ? 'dana@example.test' : o.email, name: 'דנה "הדיירת"' }),
    newTicket: async () => (o.ticket === undefined ? ticket() : o.ticket),
    admins: async () => ADMINS,
    apartmentNumber: async () => 7,
    logged: async () => o.logged ?? false,
    countSince: async () => o.used ?? 0,
    storeMessage: async (m: CommitteeMessage) => {
      if (o.limited) return null
      stored.push(m)
      return 'msg-1'
    },
    reserve: async (r: Reservation) => { reserved.push(r); return 'log-1' },
    finish: async () => undefined,
    sentToday: async () => 0,
    log: async (row: LogRow) => { logs.push(row) },
  } as unknown as DataSource
  const transport: Transport = o.transport
    ?? { provider: 'appsscript', dryRun: true, reason: 'not_configured', send: async (m) => { sent.push(m); return { ok: true } } }
  const deps: Deps = { caller: async () => o.caller ?? { userId: RES, isAdmin: false, permissions: ['home', 'tickets', 'contact_committee'] },
    data, transport, env: o.env ?? {}, sleep: async () => undefined, now: () => NOW }
  return { deps, logs, stored, reserved, sent }
}

const contact = (o: Record<string, unknown> = {}) => ({ kind: 'contact', to: 'committee', subject: 'רעש בלילה', body: 'שלום,\nיש רעש <script>', ...o })

describe('ticket_new: authorization', () => {
  it('the reporter, a fresh ticket, not yet announced: one email per admin with an address (dry run logged)', async () => {
    const s = setup()
    const r = await handle({ kind: 'ticket_new', id: T1 }, s.deps)
    expect(r.status).toBe(200)
    expect(s.sent.map((m) => m.to)).toEqual(['avi@example.test', 'batya@example.test'])
    expect(s.sent[0].subject).toBe('תקלה חדשה: נזילה <b>בלובי</b>')
    expect(s.sent[0].text).toContain('דירה: 7')
    expect(s.sent[0].text).toContain('מדווח/ת: דנה "הדיירת" (דייר/ת)')
    expect(s.sent[0].text).toContain(`#/tickets/${T1}`)
    expect(s.logs).toMatchObject([{ kind: 'ticket_new', ref_id: T1, sent_by: RES, recipients: 2, dry_run: true }])
    expect(r.body.samples).toEqual([])
  })
  it('not the creator → 403, nothing sent or logged', async () => {
    const s = setup({ ticket: ticket({ openedBy: ADMIN_A }) })
    expect((await handle({ kind: 'ticket_new', id: T1 }, s.deps)).status).toBe(403)
    expect(s.sent).toEqual([])
    expect(s.logs).toEqual([])
  })
  it('older than 15 minutes, or dated in the future → 409', async () => {
    const stale = setup({ ticket: ticket({ createdAt: new Date(NOW - 16 * 60_000).toISOString() }) })
    expect((await handle({ kind: 'ticket_new', id: T1 }, stale.deps)).status).toBe(409)
    const future = setup({ ticket: ticket({ createdAt: new Date(NOW + 10 * 60_000).toISOString() }) })
    expect((await handle({ kind: 'ticket_new', id: T1 }, future.deps)).status).toBe(409)
    expect([...stale.sent, ...future.sent]).toEqual([])
  })
  it('already announced (email_log) → 409', async () => {
    const s = setup({ logged: true })
    expect((await handle({ kind: 'ticket_new', id: T1 }, s.deps)).status).toBe(409)
    expect(s.sent).toEqual([])
  })
  it('unknown ticket → 404; a pending user → 403', async () => {
    expect((await handle({ kind: 'ticket_new', id: T1 }, setup({ ticket: null }).deps)).status).toBe(404)
    const pending = setup({ caller: { userId: RES, isAdmin: false, permissions: [] } })
    expect((await handle({ kind: 'ticket_new', id: T1 }, pending.deps)).status).toBe(403)
  })
  it('an admin reporter also gets the email, as their copy', async () => {
    const s = setup({ ticket: ticket({ openedBy: ADMIN_A }), caller: { userId: ADMIN_A, isAdmin: true, permissions: ['home'] } })
    await handle({ kind: 'ticket_new', id: T1 }, s.deps)
    expect(s.sent.map((m) => m.to).sort()).toEqual(['avi@example.test', 'batya@example.test'])
    expect(s.sent[0].text).not.toContain('(דייר/ת)')
  })
  it(`at most ${MAX_TICKET_NEW_PER_DAY} ticket_new per user in 24 hours → 429`, async () => {
    const s = setup({ used: MAX_TICKET_NEW_PER_DAY })
    expect((await handle({ kind: 'ticket_new', id: T1 }, s.deps)).status).toBe(429)
    expect(s.sent).toEqual([])
    expect((await handle({ kind: 'ticket_new', id: T1 }, setup({ used: MAX_TICKET_NEW_PER_DAY - 1 }).deps)).status).toBe(200)
  })
  it('a concurrent call that wins the unique index → 409, not 500', async () => {
    const s = setup()
    s.deps.data.log = async () => { throw new DuplicateLogError('duplicate key') }
    expect((await handle({ kind: 'ticket_new', id: T1 }, s.deps)).status).toBe(409)
    const live = setup({ transport: { provider: 'appsscript', dryRun: false, reason: null, send: async () => ({ ok: true }) } })
    live.deps.data.reserve = async () => { throw new DuplicateLogError('duplicate key') }
    expect((await handle({ kind: 'ticket_new', id: T1 }, live.deps)).status).toBe(409)
  })
  it('residents still cannot send the admin kinds', async () => {
    const s = setup()
    expect((await handle({ kind: 'announcement', id: T1 }, s.deps)).status).toBe(403)
    expect((await handle({ kind: 'test', preview: true, status: true }, s.deps)).status).toBe(403)
  })
  it('real sends reserve the daily quota', async () => {
    const transport: Transport = { provider: 'appsscript', dryRun: false, reason: null, send: async () => ({ ok: true }) }
    const s = setup({ transport })
    const r = await handle({ kind: 'ticket_new', id: T1 }, s.deps)
    expect(r.body).toMatchObject({ sent: 2, dryRun: false })
    expect(s.reserved).toMatchObject([{ kind: 'ticket_new', ref_id: T1, count: 2 }])
  })
})

describe('resident sends: a sub-cap of the daily quota', () => {
  const live = (): Transport => ({ provider: 'appsscript', dryRun: false, reason: null, send: async () => ({ ok: true }) })
  it(`a resident reserves under cap − ${MAX_PER_CALL}; an admin under the full cap`, async () => {
    const s = setup({ transport: live(), env: { EMAIL_DAILY_CAP: '90' } })
    await handle({ kind: 'ticket_new', id: T1 }, s.deps)
    await handle(contact(), s.deps)
    expect(s.reserved.map((r) => r.cap)).toEqual([90 - MAX_PER_CALL, 90 - MAX_PER_CALL])
    const a = setup({ transport: live(), env: { EMAIL_DAILY_CAP: '90' }, ticket: ticket({ openedBy: ADMIN_A }),
      caller: { userId: ADMIN_A, isAdmin: true, permissions: ['home'] } })
    await handle({ kind: 'ticket_new', id: T1 }, a.deps)
    expect(a.reserved.map((r) => r.cap)).toEqual([90])
  })
  it('a cap at or below MAX_PER_CALL leaves residents nothing: no reservation, contact kept in the app, ticket_new 429', async () => {
    const s = setup({ transport: live(), env: { EMAIL_DAILY_CAP: String(MAX_PER_CALL) } })
    expect((await handle(contact(), s.deps))).toMatchObject({ status: 200, body: { sent: 0, quotaFull: true } })
    expect((await handle({ kind: 'ticket_new', id: T1 }, s.deps)).status).toBe(429)
    expect(s.reserved).toEqual([])
  })
})

describe('contact: request', () => {
  it('to committee or an admin uuid; subject ≤ 150 and body ≤ 3000, trimmed and required', () => {
    expect(parseRequest(contact({ subject: '  נושא  ' }))).toEqual({ ok: true,
      value: { kind: 'contact', preview: false, contact: { to: 'committee', subject: 'נושא', body: 'שלום,\nיש רעש <script>' } } })
    expect(parseRequest(contact({ to: ADMIN_A.toUpperCase() }))).toMatchObject({ ok: true, value: { contact: { to: ADMIN_A } } })
    expect(parseRequest(contact({ to: 'everyone' }))).toEqual({ ok: false, error: 'to' })
    expect(parseRequest(contact({ subject: ' ' }))).toEqual({ ok: false, error: 'subject' })
    expect(parseRequest(contact({ subject: 'א'.repeat(151) }))).toEqual({ ok: false, error: 'subject' })
    expect(parseRequest(contact({ body: '' }))).toEqual({ ok: false, error: 'body' })
    expect(parseRequest(contact({ body: 'א'.repeat(3001) }))).toEqual({ ok: false, error: 'body' })
    expect(parseRequest(contact({ apartmentIds: 'all' }))).toEqual({ ok: false, error: 'apartmentIds' })
    expect(parseRequest(contact({ preview: true }))).toEqual({ ok: false, error: 'preview' })
  })
})

describe('contact: sending', () => {
  it('to the whole committee: stored first, every admin emailed, Reply-To the sender', async () => {
    const s = setup()
    const r = await handle(contact(), s.deps)
    expect(r.status).toBe(200)
    expect(s.stored).toEqual([{ building_id: 'b1', sender_id: RES, recipient_id: null, sender_name: 'דנה "הדיירת"',
      sender_email: 'dana@example.test', apartment_number: 7, subject: 'רעש בלילה', body: 'שלום,\nיש רעש <script>' }])
    expect(s.sent.map((m) => [m.to, m.replyTo])).toEqual([['avi@example.test', 'dana@example.test'], ['batya@example.test', 'dana@example.test']])
    expect(s.sent[0].subject).toBe('פנייה לוועד: רעש בלילה')
    expect(s.logs).toMatchObject([{ kind: 'contact', ref_id: 'msg-1', dry_run: true }])
    expect(r.body).toMatchObject({ dryRun: true, recipients: 2 })
  })
  it('to one member: only that admin; recipient_id stored', async () => {
    const s = setup()
    await handle(contact({ to: ADMIN_B }), s.deps)
    expect(s.sent.map((m) => m.to)).toEqual(['batya@example.test'])
    expect(s.stored[0].recipient_id).toBe(ADMIN_B)
  })
  it('a recipient who is not an approved admin of the building → 404, nothing stored', async () => {
    const s = setup()
    expect((await handle(contact({ to: RES }), s.deps)).status).toBe(404)
    expect(s.stored).toEqual([])
  })
  it('without contact_committee → 403', async () => {
    const s = setup({ caller: { userId: RES, isAdmin: false, permissions: ['home', 'tickets'] } })
    expect((await handle(contact(), s.deps)).status).toBe(403)
    expect(s.stored).toEqual([])
  })
  it(`rate limit: store_committee_message refuses the ${MAX_CONTACTS_PER_DAY + 1}th in 24 hours → 429 in Hebrew, nothing sent`, async () => {
    const s = setup({ limited: true })
    const r = await handle(contact(), s.deps)
    expect(r.status).toBe(429)
    expect(String(r.body.error)).toContain('עד 5 פניות')
    expect(s.sent).toEqual([])
    expect(s.logs).toEqual([])
  })
  it('the email names the sender as a resident', async () => {
    const s = setup()
    await handle(contact(), s.deps)
    expect(s.sent[0].text).toContain('מאת: דנה "הדיירת" (דייר/ת)')
  })
  it('a sender address with , ; < > or " gets no Reply-To (and is not stored as one)', async () => {
    for (const email of ['a@b.test,c@d.test', 'a;b@c.test', '"x"@y.test', '<a@b.test>']) {
      const s = setup({ email })
      await handle(contact(), s.deps)
      expect(s.sent[0].replyTo).toBeUndefined()
      expect(s.stored[0].sender_email).toBeNull()
    }
  })
  it('no sender email: no Reply-To, the email says so', async () => {
    const s = setup({ email: null })
    await handle(contact(), s.deps)
    expect(s.sent[0].replyTo).toBeUndefined()
    expect(s.sent[0].text).toContain('לפונה אין כתובת מייל')
  })
  it('escapes the resident text in the HTML; the subject has no line breaks', async () => {
    const s = setup()
    await handle(contact({ subject: 'שלום\r\nBcc: x@evil.test', body: '<img src=x onerror=alert(1)> & "ציטוט"' }), s.deps)
    const m = s.sent[0]
    expect(m.subject).toBe('פנייה לוועד: שלום Bcc: x@evil.test')
    expect(m.html).not.toContain('<img')
    expect(m.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;ציטוט&quot;')
    expect(m.html).toContain('דנה &quot;הדיירת&quot;')
  })
  it('the daily quota is full: the message stays stored, the attempt is logged, 200 with quotaFull', async () => {
    const transport: Transport = { provider: 'appsscript', dryRun: false, reason: null, send: async () => ({ ok: true }) }
    const s = setup({ transport })
    s.deps.data.reserve = async () => null
    const r = await handle(contact(), s.deps)
    expect(r).toMatchObject({ status: 200, body: { sent: 0, quotaFull: true } })
    expect(s.stored).toHaveLength(1)
    expect(s.logs).toMatchObject([{ kind: 'contact', ref_id: 'msg-1', sent: 0, error: 'daily cap' }])
  })
})

describe('transport: reply-to', () => {
  const msg = { to: 'avi@example.test', subject: 'נושא', html: '<p>x</p>', text: 'x', replyTo: 'dana@example.test' }
  const capture = (): FetchFn & { bodies: unknown[] } => {
    const bodies: unknown[] = []
    const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ ok: true, id: 'x' }), { status: 200 })
    }) as FetchFn & { bodies: unknown[] }
    fn.bodies = bodies
    return fn
  }
  afterEach(() => vi.restoreAllMocks())
  it('Apps Script gets replyTo; Resend gets reply_to; omitted when absent', async () => {
    const a = capture()
    await createTransport({ APPS_SCRIPT_URL: 'https://s.test', APPS_SCRIPT_TOKEN: 't' }, a).send(msg)
    expect(a.bodies[0]).toMatchObject({ replyTo: 'dana@example.test' })
    const r = capture()
    const resend = createTransport({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k', EMAIL_FROM: 'v@example.test' }, r)
    await resend.send(msg)
    await resend.send({ ...msg, replyTo: undefined })
    expect(r.bodies[0]).toMatchObject({ reply_to: 'dana@example.test' })
    expect(r.bodies[1]).not.toHaveProperty('reply_to')
  })
})
