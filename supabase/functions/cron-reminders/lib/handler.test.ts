import { describe, expect, it } from 'vitest'
import { DEFAULT_DAILY_CAP } from '../../send-email/lib/cap.ts'
import { MAX_PER_CALL } from '../../send-email/lib/handler.ts'
import type { MailMessage, Transport } from '../../send-email/lib/transport.ts'
import { safeEqual, secretMatches } from './auth.ts'
import { entryKey, type ReminderItem } from './digest.ts'
import { adminRecipients, handleCron, type ClaimRow, type CronDeps, type CronLogRow, type ReminderData } from './handler.ts'

const SECRET = 'a'.repeat(64)
// 08:10 in Israel on 2026-11-04 (winter, UTC+2).
const NOW = Date.parse('2026-11-04T06:10:00Z')

const task = (id: string, dueOn: string): ReminderItem =>
  ({ kind: 'task', id, title: `משימה ${id}`, dueOn, supplierId: null, supplierName: null, supplierPhone: null })

interface Fake extends ReminderData {
  claims: ClaimRow[]; released: string[]; linked: [string[], string][]; reserved: [number, number][]; logs: CronLogRow[]; reads: number
}

function fakeData(over: Partial<ReminderData> = {}): Fake {
  const held = new Set<string>()
  const f: Fake = {
    claims: [], released: [], linked: [], reserved: [], logs: [], reads: 0,
    buildings: async () => { f.reads += 1; return [{ id: 'b1', name: 'הבניין' }] },
    settings: async () => null,
    items: async () => [task('week', '2026-11-11'), task('day', '2026-11-05'), task('later', '2026-11-20')],
    admins: async () => [{ userId: 'u1', name: 'דנה', email: 'Dana@Example.test ' }, { userId: 'u2', name: 'רון', email: 'ron@example.test' },
      { userId: 'u3', name: 'בלי', email: null }],
    sentKeys: async () => new Set(),
    claim: async (rows) => rows.flatMap((r) => {
      const key = entryKey(r.item_kind, r.item_id, r.due_on, r.offset_days)
      if (held.has(key)) return []
      held.add(key)
      f.claims.push(r)
      return [{ id: `row-${f.claims.length}`, key }]
    }),
    release: async (ids) => { f.released.push(...ids) },
    linkLog: async (ids, logId) => { f.linked.push([ids, logId]) },
    reserve: async (_b, count, cap) => { f.reserved.push([count, cap]); return 'log-1' },
    finish: async () => undefined,
    log: async (row) => { f.logs.push(row); return 'dry-1' },
    ...over,
  }
  return f
}

function fakeTransport(dryRun: boolean, ok = true): Transport & { sent: MailMessage[] } {
  const sent: MailMessage[] = []
  return { provider: 'appsscript', dryRun, reason: dryRun ? 'not_configured' : null, sent,
    send: async (m) => { sent.push(m); return ok ? { ok: true } : { ok: false, error: 'boom' } } }
}

function deps(over: Partial<CronDeps> = {}): CronDeps & { data: Fake; transport: ReturnType<typeof fakeTransport> } {
  return { expectedSecret: async () => SECRET, data: fakeData(), transport: fakeTransport(true), env: {}, now: () => NOW,
    sleep: async () => undefined, ...over } as CronDeps & { data: Fake; transport: ReturnType<typeof fakeTransport> }
}

describe('auth', () => {
  it('safeEqual: equal only for the exact same string', () => {
    expect(safeEqual(SECRET, SECRET)).toBe(true)
    expect(safeEqual(`b${SECRET.slice(1)}`, SECRET)).toBe(false)
    expect(safeEqual(`${SECRET.slice(0, -1)}b`, SECRET)).toBe(false)
    expect(safeEqual(SECRET.slice(0, 32), SECRET)).toBe(false)
    expect(safeEqual(`${SECRET}x`, SECRET)).toBe(false)
    expect(safeEqual('', SECRET)).toBe(false)
  })
  it('safeEqual reads every byte of the expected value whatever the guess (no early exit)', () => {
    let reads = 0
    const expected = new Proxy(new Uint8Array(new TextEncoder().encode(SECRET)), {
      get: (t, p) => { if (typeof p === 'string' && /^\d+$/.test(p)) reads += 1; return Reflect.get(t, p) },
    })
    const enc = TextEncoder.prototype.encode
    TextEncoder.prototype.encode = function (s?: string) { return s === SECRET ? expected : enc.call(this, s) }
    try {
      safeEqual('x', SECRET)
      const early = reads
      reads = 0
      safeEqual(`${SECRET.slice(0, -1)}x`, SECRET)
      expect(early).toBe(64)
      expect(reads).toBe(64)
    } finally {
      TextEncoder.prototype.encode = enc
    }
  })
  it('secretMatches: a missing or short expected secret never matches', () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true)
    expect(secretMatches(null, SECRET)).toBe(false)
    expect(secretMatches('', '')).toBe(false)
    expect(secretMatches('short', 'short')).toBe(false)
    expect(secretMatches(SECRET, null)).toBe(false)
  })
  it.each([[null], [''], ['wrong'], [`${SECRET}0`]])('header %j → 401 before any data is read', async (header) => {
    const d = deps()
    const r = await handleCron(header, d)
    expect(r.status).toBe(401)
    expect(d.data.reads).toBe(0)
    expect(d.transport.sent).toEqual([])
  })
  it('401 when the database has no secret', async () => {
    const d = deps({ expectedSecret: async () => null })
    expect((await handleCron(SECRET, d)).status).toBe(401)
  })
})

describe('handleCron', () => {
  it('dry run: one digest per admin, the entries claimed (dry_run) and linked to the log row', async () => {
    const d = deps()
    const r = await handleCron(SECRET, d)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ today: '2026-11-04', dryRun: true, results: [{ buildingId: 'b1', items: 2, sent: 2 }] })
    expect(d.transport.sent.map((m) => m.to)).toEqual(['dana@example.test', 'ron@example.test'])
    expect(d.transport.sent[0].subject).toBe('תזכורת תחזוקה: 2 משימות קרובות')
    expect(d.data.claims.map((c) => [c.item_id, c.offset_days, c.sent_on, c.dry_run])).toEqual([
      ['week', 7, '2026-11-04', true], ['day', 1, '2026-11-04', true]])
    expect(d.data.logs).toMatchObject([{ kind: 'maintenance_reminder', recipients: 2, dry_run: true, sent: 2 }])
    expect(d.data.linked).toEqual([[['row-1', 'row-2'], 'dry-1']])
  })
  it('real send: reserved under the cap minus the committee share, linked to the reservation', async () => {
    const d = deps({ transport: fakeTransport(false), env: { EMAIL_DAILY_CAP: '' } })
    await handleCron(SECRET, d)
    expect(d.data.reserved).toEqual([[2, DEFAULT_DAILY_CAP - MAX_PER_CALL]])
    expect(d.data.linked).toEqual([[['row-1', 'row-2'], 'log-1']])
    expect(d.data.released).toEqual([])
  })
  it('a full cap or a failed delivery releases the claims (nothing marked sent)', async () => {
    const full = deps({ transport: fakeTransport(false), data: fakeData({ reserve: async () => null }) })
    expect((await handleCron(SECRET, full)).body).toMatchObject({ results: [{ skipped: 'daily_cap' }] })
    expect(full.data.released).toEqual(['row-1', 'row-2'])
    const failed = deps({ transport: fakeTransport(false, false) })
    await handleCron(SECRET, failed)
    expect(failed.data.released).toEqual(['row-1', 'row-2'])
    expect(failed.data.linked).toEqual([])
  })
  it('once only: a second run the same day sends nothing', async () => {
    const d = deps()
    await handleCron(SECRET, d)
    const again = await handleCron(SECRET, d)
    expect(again.body).toMatchObject({ results: [{ skipped: 'already_sent' }] })
    expect(d.transport.sent).toHaveLength(2)
  })
  it('turned off, nothing due or no admin address: no email', async () => {
    const off = deps({ data: fakeData({ settings: async () => ({ enabled: false, daysBefore: [7, 1], includeOverdue: true }) }) })
    const empty = deps({ data: fakeData({ items: async () => [task('later', '2026-11-20')] }) })
    const nobody = deps({ data: fakeData({ admins: async () => [{ userId: 'u', name: 'x', email: 'not-an-email' }] }) })
    for (const [d, reason] of [[off, 'off'], [empty, 'nothing_due'], [nobody, 'no_recipients']] as const) {
      expect((await handleCron(SECRET, d)).body).toMatchObject({ results: [{ skipped: reason }] })
      expect(d.transport.sent).toEqual([])
      expect(d.data.claims).toEqual([])
    }
  })
  it('adminRecipients: one address each, valid only', () => {
    expect(adminRecipients([{ userId: 'a', name: 'א', email: 'X@y.co' }, { userId: 'b', name: 'ב', email: 'x@y.co' }]))
      .toEqual([{ email: 'x@y.co', name: 'א' }])
  })
})
