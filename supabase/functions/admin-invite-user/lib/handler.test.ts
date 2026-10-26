import { describe, expect, it } from 'vitest'
import { mailerAutoconfirm } from './db.ts'
import { AuthFailure, ERR, handleInvite, MAX_INVITES, type AuditRow, type ExistingUser, type InviteDeps, type NewResident } from './handler.ts'

const ADMIN = '11111111-1111-4111-8111-111111111111'
const APT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ARCHIVED = 'aaaaaaaa-aaaa-4aaa-8aaa-bbbbbbbbbbbb'
const RES = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const GROUP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const LINKED = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

type Fake = InviteDeps & {
  invited: string[]; approved: [string, string | null][]; inserted: NewResident[]; links: [string, string][]; audits: AuditRow[]
}

function deps(over: Partial<InviteDeps> = {}, opts: { isAdmin?: boolean; signedIn?: boolean; users?: Record<string, ExistingUser> } = {}): Fake {
  const invited: string[] = []
  const approved: [string, string | null][] = []
  const inserted: NewResident[] = []
  const links: [string, string][] = []
  const audits: AuditRow[] = []
  const users = opts.users ?? {}
  return {
    invited, approved, inserted, links, audits,
    caller: async () => (opts.signedIn === false ? null : { userId: ADMIN, isAdmin: opts.isAdmin ?? true }),
    autoconfirm: async () => false,
    buildingOf: async () => 'b1',
    groupInBuilding: async (id, b) => id === GROUP && b === 'b1',
    apartmentOk: async (id) => id === APT,
    resident: async (id) => (id === RES ? { apartmentId: APT, email: 'Dir@Example.test', linked: false }
      : id === LINKED ? { apartmentId: APT, email: 'taken@example.test', linked: true } : null),
    existing: async (email) => users[email] ?? null,
    invite: async (email) => {
      invited.push(email)
      users[email] ??= { userId: `u-${email}`, invitedAt: 'now', lastSignInAt: null }
      return users[email].userId
    },
    approve: async (id, g) => { approved.push([id, g]) },
    findResident: async (apt, email) => (apt === APT && email === 'match@example.test' ? 'r-existing' : null),
    insertResident: async (row) => { inserted.push(row); return `r-new-${inserted.length}` },
    link: async (u, r) => { links.push([u, r]) },
    audit: async (row) => { audits.push(row) },
    ...over,
  }
}
const one = (email: string, extra: Record<string, unknown> = {}) => ({ invites: [{ email, ...extra }] })
const results = (r: { body: Record<string, unknown> }) => r.body.results

describe('admin-invite-user: caller and request', () => {
  it('401 without a session, 403 for a non-admin; nothing is sent', async () => {
    expect((await handleInvite(one('a@example.test'), deps({}, { signedIn: false }))).status).toBe(401)
    const d = deps({}, { isAdmin: false })
    expect((await handleInvite(one('a@example.test'), d)).status).toBe(403)
    expect(d.invited).toEqual([])
  })
  it('400 on a malformed body, an empty or oversized batch, or a bad id', async () => {
    const d = deps()
    expect((await handleInvite(null, d)).status).toBe(400)
    expect((await handleInvite({ invites: [] }, d)).status).toBe(400)
    expect((await handleInvite({ invites: Array.from({ length: MAX_INVITES + 1 }, (_, i) => ({ email: `u${i}@example.test` })) }, d)).status).toBe(400)
    expect((await handleInvite(one('a@example.test', { apartmentId: 'x' }), d)).status).toBe(400)
    expect((await handleInvite({ invites: [{ email: 5 }] }, d)).status).toBe(400)
    expect(d.invited).toEqual([])
  })
  it('400 when the group is not in the caller\'s building', async () => {
    expect((await handleInvite({ ...one('a@example.test'), groupId: OTHER }, deps())).body).toEqual({ error: 'הקבוצה לא נמצאה' })
  })
  it('409 when email sign-ups are auto-confirmed: nothing is sent, approved or linked', async () => {
    const d = deps({ autoconfirm: async () => true })
    const r = await handleInvite({ invites: [{ email: 'a@example.test', apartmentId: APT }], groupId: GROUP }, d)
    expect(r).toEqual({ status: 409, body: { error: ERR.autoconfirm } })
    expect([d.invited, d.approved, d.links, d.inserted]).toEqual([[], [], [], []])
  })
})

describe('admin-invite-user: mailerAutoconfirm (GoTrue /auth/v1/settings)', () => {
  const settings = (status: number, body: unknown): typeof fetch => async () => new Response(JSON.stringify(body), { status })
  it('false only when the server says mailer_autoconfirm is false', async () => {
    expect(await mailerAutoconfirm('http://x', 'anon', settings(200, { mailer_autoconfirm: false }))).toBe(false)
    expect(await mailerAutoconfirm('http://x', 'anon', settings(200, { mailer_autoconfirm: true }))).toBe(true)
    expect(await mailerAutoconfirm('http://x', 'anon', settings(200, {}))).toBe(true)
  })
  it('asks the auth settings endpoint with the anon key, and throws when it is unreachable', async () => {
    const calls: [string, string | null][] = []
    const spy: typeof fetch = async (input, init) => {
      calls.push([String(input), new Headers(init?.headers).get('apikey')])
      return new Response('{}', { status: 200 })
    }
    await mailerAutoconfirm('http://x', 'anon', spy)
    expect(calls).toEqual([['http://x/auth/v1/settings', 'anon']])
    await expect(mailerAutoconfirm('http://x', 'anon', settings(503, {}))).rejects.toThrow()
  })
})

describe('admin-invite-user: one invite', () => {
  it('no apartment: invites (trimmed, lower-cased), approves with the group, audits, links nothing', async () => {
    const d = deps()
    const r = await handleInvite({ invites: [{ email: '  New@Example.TEST ', fullName: 'דנה' }], groupId: GROUP }, d)
    expect(r).toEqual({ status: 200, body: { results: [{ email: 'new@example.test', outcome: 'sent' }] } })
    expect(d.invited).toEqual(['new@example.test'])
    expect(d.approved).toEqual([['u-new@example.test', GROUP]])
    expect(d.links).toEqual([])
    expect(d.audits).toEqual([{ building_id: 'b1', actor: ADMIN, action: 'invite_user', target_id: 'u-new@example.test', apartment_id: null,
      details: { email: 'new@example.test', resent: false, group_id: GROUP, resident_id: null } }])
  })
  it('an invalid or overlong address fails without sending', async () => {
    const d = deps()
    const long = `${'a'.repeat(250)}@x.io`
    const r = await handleInvite({ invites: [{ email: 'not-an-email' }, { email: long }] }, d)
    expect(results(r)).toEqual([{ email: 'not-an-email', outcome: 'failed', error: ERR.email }, { email: long, outcome: 'failed', error: ERR.email }])
    expect(d.invited).toEqual([])
  })
  it('an apartment outside the building or archived fails without sending', async () => {
    const d = deps()
    expect(results(await handleInvite(one('a@example.test', { apartmentId: ARCHIVED }), d))).toEqual([{ email: 'a@example.test', outcome: 'failed', error: ERR.apartment }])
    expect(results(await handleInvite(one('a@example.test', { residentId: OTHER }), d))).toEqual([{ email: 'a@example.test', outcome: 'failed', error: ERR.resident }])
    expect(d.invited).toEqual([])
  })
  it('an existing account is refused (כבר רשום)', async () => {
    const d = deps({}, { users: { 'old@example.test': { userId: 'u-old', invitedAt: null, lastSignInAt: '2026-01-01' } } })
    expect(results(await handleInvite(one('old@example.test'), d))).toEqual([{ email: 'old@example.test', outcome: 'exists', error: ERR.exists }])
    expect(d.invited).toEqual([])
  })
  it('an invited login that never signed in gets the invite again, without re-approving or relinking', async () => {
    const d = deps({}, { users: { 'inv@example.test': { userId: 'u-inv', invitedAt: '2026-10-01', lastSignInAt: null } } })
    expect(results(await handleInvite(one('inv@example.test', { apartmentId: APT }), d))).toEqual([{ email: 'inv@example.test', outcome: 'resent' }])
    expect(d.invited).toEqual(['inv@example.test'])
    expect(d.approved).toEqual([])
    expect(d.links).toEqual([])
    expect(d.audits[0]?.details.resent).toBe(true)
  })
  it('apartment: reuses the matching unlinked resident', async () => {
    const d = deps()
    await handleInvite(one('match@example.test', { apartmentId: APT }), d)
    expect(d.inserted).toEqual([])
    expect(d.links).toEqual([['u-match@example.test', 'r-existing']])
    expect(d.audits[0]?.apartment_id).toBe(APT)
  })
  it('apartment: otherwise inserts a resident (the name, else the local part)', async () => {
    const d = deps()
    await handleInvite({ invites: [{ email: 'x@example.test', apartmentId: APT, fullName: 'יוסי' }, { email: 'noname@example.test', apartmentId: APT }] }, d)
    expect(d.inserted).toEqual([
      { building_id: 'b1', apartment_id: APT, full_name: 'יוסי', email: 'x@example.test' },
      { building_id: 'b1', apartment_id: APT, full_name: 'noname', email: 'noname@example.test' },
    ])
    expect(d.links).toEqual([['u-x@example.test', 'r-new-1'], ['u-noname@example.test', 'r-new-2']])
  })
  it('a picked resident is linked directly (no new resident)', async () => {
    const d = deps()
    expect(results(await handleInvite(one('dir@example.test', { residentId: RES }), d))).toEqual([{ email: 'dir@example.test', outcome: 'sent' }])
    expect(d.inserted).toEqual([])
    expect(d.links).toEqual([['u-dir@example.test', RES]])
    expect(d.audits[0]).toMatchObject({ apartment_id: APT, details: { resident_id: RES } })
  })
  it('a picked resident already linked to a login, or with another address, is refused', async () => {
    const d = deps()
    expect(results(await handleInvite(one('taken@example.test', { residentId: LINKED }), d)))
      .toEqual([{ email: 'taken@example.test', outcome: 'failed', error: ERR.resident }])
    expect(results(await handleInvite(one('someone-else@example.test', { residentId: RES }), d)))
      .toEqual([{ email: 'someone-else@example.test', outcome: 'failed', error: ERR.resident }])
    expect(d.invited).toEqual([])
    expect(d.links).toEqual([])
  })
  it('a race after the invite (another login id, or already signed in) is "exists": nothing approved or linked', async () => {
    const users: Record<string, ExistingUser> = {}
    const swapped = deps({ invite: async () => 'u-someone-else', existing: async (e) => users[e] ?? null }, { users })
    users['r@example.test'] = { userId: 'u-first', invitedAt: 'x', lastSignInAt: null }
    expect(results(await handleInvite(one('r@example.test', { apartmentId: APT }), swapped)))
      .toEqual([{ email: 'r@example.test', outcome: 'exists', error: ERR.exists }])
    let calls = 0
    const signedIn = deps({ existing: async () => (++calls === 1 ? null : { userId: 'u-s@example.test', invitedAt: null, lastSignInAt: 'now' }) })
    expect(results(await handleInvite(one('s@example.test', { apartmentId: APT }), signedIn)))
      .toEqual([{ email: 's@example.test', outcome: 'exists', error: ERR.exists }])
    expect([...swapped.approved, ...signedIn.approved, ...swapped.links, ...signedIn.links]).toEqual([])
  })
  it('steps that fail after the login exists become warnings, never a failure', async () => {
    const boom = async () => { throw new Error('db down') }
    const d = deps({ approve: boom, link: boom, audit: boom })
    expect(results(await handleInvite(one('w@example.test', { apartmentId: APT }), d)))
      .toEqual([{ email: 'w@example.test', outcome: 'sent', warnings: ['approve', 'link', 'audit'] }])
  })
  it('maps auth errors: SMTP, an account created meanwhile, anything else', async () => {
    const thrower = (e: Error) => deps({ invite: async () => { throw e } })
    expect(results(await handleInvite(one('a@example.test'), thrower(new AuthFailure('Error sending invite email', 500)))))
      .toEqual([{ email: 'a@example.test', outcome: 'failed', error: ERR.smtp }])
    expect(results(await handleInvite(one('a@example.test'), thrower(new AuthFailure('A user with this email address has already been registered', 422, 'email_exists')))))
      .toEqual([{ email: 'a@example.test', outcome: 'exists', error: ERR.exists }])
    expect(results(await handleInvite(one('a@example.test'), thrower(new Error('network')))))
      .toEqual([{ email: 'a@example.test', outcome: 'failed', error: ERR.failed }])
  })
})

describe('admin-invite-user: batches', () => {
  it('mixed outcomes in order; duplicates collapse; one failure does not stop the rest', async () => {
    const d = deps({}, { users: {
      'old@example.test': { userId: 'u-old', invitedAt: null, lastSignInAt: '2026-01-01' },
      'inv@example.test': { userId: 'u-inv', invitedAt: '2026-10-01', lastSignInAt: null },
    } })
    const r = await handleInvite({ invites: [
      { email: 'new@example.test' }, { email: 'NEW@example.test ' }, { email: 'bad' }, { email: 'old@example.test' },
      { email: 'inv@example.test' }, { email: 'dir@example.test', residentId: RES }, { email: 'typed@example.test', apartmentId: APT },
    ] }, d)
    expect(results(r)).toEqual([
      { email: 'new@example.test', outcome: 'sent' },
      { email: 'bad', outcome: 'failed', error: ERR.email },
      { email: 'old@example.test', outcome: 'exists', error: ERR.exists },
      { email: 'inv@example.test', outcome: 'resent' },
      { email: 'dir@example.test', outcome: 'sent' },
      { email: 'typed@example.test', outcome: 'sent' },
    ])
    expect(d.invited).toEqual(['new@example.test', 'inv@example.test', 'dir@example.test', 'typed@example.test'])
    expect(d.links).toEqual([['u-dir@example.test', RES], ['u-typed@example.test', 'r-new-1']])
  })
  it('the rate limit stops the rest (לא נשלחה – מגבלת שליחה)', async () => {
    let n = 0
    const users: Record<string, ExistingUser> = {}
    const d = deps({ invite: async (email) => {
      if (++n === 2) throw new AuthFailure('email rate limit exceeded', 429, 'over_email_send_rate_limit')
      users[email] = { userId: `u-${email}`, invitedAt: 'now', lastSignInAt: null }
      return `u-${email}`
    } }, { users })
    const r = await handleInvite({ invites: [{ email: 'a@example.test' }, { email: 'b@example.test' }, { email: 'c@example.test' }] }, d)
    expect(results(r)).toEqual([
      { email: 'a@example.test', outcome: 'sent' },
      { email: 'b@example.test', outcome: 'failed', error: ERR.rate },
      { email: 'c@example.test', outcome: 'skipped', error: ERR.skipped },
    ])
    expect(n).toBe(2)
  })
})
