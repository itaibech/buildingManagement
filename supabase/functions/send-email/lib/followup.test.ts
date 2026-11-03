import { describe, expect, it } from 'vitest'
import { debtFirmContent, money } from './content.ts'
import { fitBatches, sentPerFollowup, type FollowupBatch } from './followup.ts'
import { handle, MAX_PER_CALL, type Deps } from './handler.ts'
import type { DataSource, FollowupDue, LogRow, Outcome, Reservation } from './types.ts'
import type { MailMessage, Transport } from './transport.ts'
import { parseRequest } from './validate.ts'

const A1 = '11111111-1111-4111-8111-111111111111'
const A2 = '22222222-2222-4222-8222-222222222222'
const A3 = '33333333-3333-4333-8333-333333333333'

const DUE: FollowupDue[] = [
  { id: 'f2', apartmentId: A2, step: 2, balance: 600, days: 35 },
  { id: 'f1', apartmentId: A1, step: 1, balance: 300, days: 12 },
  { id: 'f3', apartmentId: A3, step: 1, balance: 120, days: 11 },
]

interface Setup { dryRun?: boolean; used?: number; cap?: number; due?: FollowupDue[]; fail?: string }

function setup(o: Setup = {}) {
  const logs: LogRow[] = []
  const reserved: Reservation[] = []
  const finished: [string, Outcome][] = []
  const marks: { claimed: string[]; sent: Record<string, number>; logId: string | null }[] = []
  const claims: boolean[] = []
  const sent: MailMessage[] = []
  const data = {
    context: async () => ({ building: { id: 'b1', name: 'הבניין', payment_instructions: 'העברה לחשבון הוועד', committee_contact: '050-1234567' }, email: null, name: '' }),
    apartments: async () => [{ id: A1, number: 1 }, { id: A2, number: 2 }, { id: A3, number: 3 }],
    residents: async () => [
      { apartment_id: A1, full_name: 'דנה', email: 'dana@example.test' },
      { apartment_id: A2, full_name: 'רון', email: 'ron@example.test' },
      { apartment_id: A2, full_name: 'רונית', email: 'ronit@example.test' },
      { apartment_id: A3, full_name: 'גל', email: null },
    ],
    ledger: async () => [{ apartmentId: A1, month: '2026-10-01', charged: 300, paid: 0 }, { apartmentId: A2, month: '2026-09-01', charged: 600, paid: 0 }],
    followupsReady: async (_b: string, claim: boolean) => { claims.push(claim); return o.due ?? DUE },
    sentToday: async () => (o.used ?? 0) + reserved.reduce((t, r) => t + r.count, 0),
    reserve: async (r: Reservation) => {
      if ((o.used ?? 0) + r.count > r.cap) return null
      reserved.push(r)
      return 'log-1'
    },
    finish: async (id: string, out: Outcome) => { finished.push([id, out]) },
    log: async (row: LogRow) => { logs.push(row) },
    finishFollowups: async (_b: string, claimed: string[], s: Record<string, number>, logId: string | null) => { marks.push({ claimed, sent: s, logId }) },
  } as unknown as DataSource
  const transport: Transport = {
    provider: 'appsscript', dryRun: o.dryRun ?? false, reason: o.dryRun ? 'not_configured' : null,
    send: async (m) => { sent.push(m); return m.to === o.fail ? { ok: false, error: 'bounce' } : { ok: true } },
  }
  const env = { EMAIL_DAILY_CAP: String(o.cap ?? 90) }
  const deps: Deps = { caller: async () => ({ userId: 'u1', isAdmin: true }), data, transport, env, sleep: async () => undefined }
  return { deps, logs, reserved, finished, marks, sent, claims }
}

describe('kind debt_followup: request', () => {
  it('takes no id and no apartments (the server picks them)', () => {
    expect(parseRequest({ kind: 'debt_followup', preview: true })).toEqual({ ok: true, value: { kind: 'debt_followup', preview: true } })
    expect(parseRequest({ kind: 'debt_followup', apartmentIds: [A1] })).toEqual({ ok: false, error: 'apartmentIds' })
    expect(parseRequest({ kind: 'debt_followup', id: A1 })).toEqual({ ok: false, error: 'id' })
  })
  it('is admin only', async () => {
    const s = setup()
    const r = await handle({ kind: 'debt_followup' }, { ...s.deps, caller: async () => ({ userId: 'u2', isAdmin: false, permissions: ['home'] }) })
    expect(r.status).toBe(403)
    expect(s.sent).toHaveLength(0)
  })
})

describe('kind debt_followup: send', () => {
  it('preview: counts only, nothing sent or marked', async () => {
    const s = setup()
    const r = await handle({ kind: 'debt_followup', preview: true }, s.deps)
    expect(r.body).toMatchObject({ preview: true, pending: 3, apartments: 2, recipients: 3, deferred: 0, noEmail: [3], remainingToday: 90 - MAX_PER_CALL })
    expect(s.sent).toHaveLength(0)
    expect(s.marks).toHaveLength(0)
    expect(s.claims).toEqual([false])
  })
  it('real send: claims, step 2 gets the firmer email, step 1 the friendly one; sent rows marked, the no-email row released', async () => {
    const s = setup()
    const r = await handle({ kind: 'debt_followup' }, s.deps)
    expect(r.body).toMatchObject({ sent: 3, failed: 0, apartments: 2, deferred: 0 })
    expect(s.sent.map((m) => m.subject)).toEqual(['תזכורת נוספת: חוב פתוח – דירה 2', 'תזכורת נוספת: חוב פתוח – דירה 2', 'תזכורת תשלום – דירה 1'])
    expect(s.reserved[0]).toMatchObject({ kind: 'debt_followup', count: 3, cap: 90 - MAX_PER_CALL, apartment_ids: [A2, A1] })
    expect(s.finished).toEqual([['log-1', { sent: 3, failed: 0, skipped: 1, error: null }]])
    expect(s.claims).toEqual([true])
    expect(s.marks).toEqual([{ claimed: ['f2', 'f1', 'f3'], sent: { f2: 2, f1: 1 }, logId: 'log-1' }])
  })
  it('never passes the follow-ups\' share of the cap: what does not fit waits for the next send', async () => {
    const s = setup({ cap: 50, used: 8 })
    const r = await handle({ kind: 'debt_followup' }, s.deps)
    // share = 50 − 40 = 10, 8 used → room for 2: apartment 2 (two emails) fits, apartment 1 is deferred.
    expect(r.body).toMatchObject({ sent: 2, apartments: 1, deferred: 1 })
    // Every claimed row is finished: the deferred one (f1) goes back to pending.
    expect(s.marks).toEqual([{ claimed: ['f2', 'f1', 'f3'], sent: { f2: 2 }, logId: 'log-1' }])
  })
  it('a full share sends nothing and releases every claimed row', async () => {
    const s = setup({ cap: 50, used: 10 })
    const r = await handle({ kind: 'debt_followup' }, s.deps)
    expect(r.body).toMatchObject({ sent: 0, apartments: 0, deferred: 2, quotaFull: true })
    expect(s.sent).toHaveLength(0)
    expect(s.reserved).toHaveLength(0)
    expect(s.marks).toEqual([{ claimed: ['f2', 'f1', 'f3'], sent: {}, logId: null }])
  })
  it('an apartment whose emails all failed stays pending', async () => {
    const s = setup({ fail: 'dana@example.test' })
    await handle({ kind: 'debt_followup' }, s.deps)
    expect(s.marks[0]?.sent).toEqual({ f2: 2 })
  })
  it('dry run: logged as a dry run, samples returned, nothing marked sent', async () => {
    const s = setup({ dryRun: true })
    const r = await handle({ kind: 'debt_followup' }, s.deps)
    expect(r.body).toMatchObject({ dryRun: true, sent: 3 })
    expect(s.logs).toMatchObject([{ kind: 'debt_followup', dry_run: true, recipients: 3, apartment_ids: [A2, A1] }])
    expect(s.marks).toHaveLength(0)
    expect(s.reserved).toHaveLength(0)
    expect(s.claims).toEqual([false])
  })
  it('a send that fails before any email went out releases its claim', async () => {
    const s = setup()
    const boom = { ...s.deps, data: { ...s.deps.data, reserve: async () => { throw new Error('db down') } } }
    await expect(handle({ kind: 'debt_followup' }, boom)).rejects.toThrow('db down')
    expect(s.sent).toHaveLength(0)
    expect(s.marks).toEqual([{ claimed: ['f2', 'f1', 'f3'], sent: {}, logId: null }])
  })
  it('a second send right after gets nothing (the first one claimed the rows)', async () => {
    let left = DUE
    const s = setup()
    const data = { ...s.deps.data, followupsReady: async () => { const out = left; left = []; return out } }
    await handle({ kind: 'debt_followup' }, { ...s.deps, data })
    const second = await handle({ kind: 'debt_followup' }, { ...s.deps, data })
    expect(second.body).toMatchObject({ pending: 0, sent: 0 })
    expect(s.sent).toHaveLength(3)
  })
  it('nothing pending (automation off or no debts): nothing sent', async () => {
    const s = setup({ due: [] })
    const r = await handle({ kind: 'debt_followup' }, s.deps)
    expect(r.body).toMatchObject({ pending: 0, sent: 0 })
    expect(s.sent).toHaveLength(0)
    expect(s.marks).toHaveLength(0)
  })
})

describe('followup helpers', () => {
  const batch = (id: string, n: number): FollowupBatch => ({
    due: { id, apartmentId: id, step: 1, balance: 100, days: 10 }, number: 1,
    messages: Array.from({ length: n }, (_, i) => ({ to: `${id}${i}@x.test`, subject: 's', html: '', text: '' })),
  })
  it('fitBatches: whole apartments only, in order', () => {
    const { take, deferred } = fitBatches([batch('a', 2), batch('b', 3), batch('c', 1), batch('d', 0)], 3)
    expect(take.map((b) => b.due.id)).toEqual(['a', 'c'])
    expect(deferred.map((b) => b.due.id)).toEqual(['b'])
  })
  it('sentPerFollowup: counts each batch\'s delivered emails', () => {
    expect(sentPerFollowup([batch('a', 2), batch('b', 1)], [false, true, false])).toEqual({ a: 1 })
  })
  it('the firm email names the days and keeps the payment details', () => {
    const c = debtFirmContent({ number: 4, balance: 660, open: [{ month: '2026-08-01', amount: 660 }], instructions: 'ביט', contact: null }, 'דנה', 'https://app/', 33)
    expect(c.paragraphs[0]).toContain('33 ימים')
    expect(c.after).toContain('איך משלמים:\nביט')
    expect(c.lines).toEqual([{ label: 'אוגוסט 2026', value: money(660) }])
  })
})
