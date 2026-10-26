/** admin-invite-user: pure request handling (no Deno or network imports, so Vitest can load it). */
import type { Caller } from '../../send-email/lib/types.ts'

/** One recipient. residentId: picked from the directory (links to that resident); apartmentId: for a typed address. */
export interface InviteInput { email: string; residentId: string | null; apartmentId: string | null; fullName: string | null }
export interface InviteRequest { invites: InviteInput[]; groupId: string | null }

/** sent / resent (invited, never signed in) / exists (has an account) / failed / skipped (stopped by the rate limit). */
export type Outcome = 'sent' | 'resent' | 'exists' | 'failed' | 'skipped'
/** Steps after the login exists that failed: the user then shows as pending or unlinked, for the admin to fix. */
export type Warning = 'approve' | 'link' | 'audit'
export interface InviteResult { email: string; outcome: Outcome; error?: string; warnings?: Warning[] }

export interface ExistingUser { userId: string; invitedAt: string | null; lastSignInAt: string | null }
export interface PickedResident { apartmentId: string; email: string | null; linked: boolean }
export interface Placement { apartmentId: string | null; residentId: string | null }
export interface AuditRow {
  building_id: string
  actor: string
  action: 'invite_user'
  target_id: string
  apartment_id: string | null
  details: { email: string; resent: boolean; group_id: string | null; resident_id: string | null }
}
export interface NewResident { building_id: string; apartment_id: string; full_name: string; email: string }

/** An auth API error, as GoTrue reports it (status, code). */
export class AuthFailure extends Error {
  readonly status: number | undefined
  readonly code: string | undefined
  constructor(message: string, status?: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export interface InviteDeps {
  caller(): Promise<Caller | null>
  /** Whether the auth server auto-confirms email sign-ups ("Confirm email" off). */
  autoconfirm(): Promise<boolean>
  buildingOf(userId: string): Promise<string>
  groupInBuilding(groupId: string, buildingId: string): Promise<boolean>
  /** The apartment if it is in the building and not archived. */
  apartmentOk(apartmentId: string, buildingId: string): Promise<boolean>
  /** The resident if it is in the building and its apartment is not archived: its apartment, email, and whether a login is linked. */
  resident(residentId: string, buildingId: string): Promise<PickedResident | null>
  existing(email: string): Promise<ExistingUser | null>
  /** Sends the invite; the new (or re-invited) login's id. Throws AuthFailure. */
  invite(email: string, fullName: string | null): Promise<string>
  approve(userId: string, groupId: string | null): Promise<void>
  /** A resident of the apartment with this email (case-insensitive) not linked to another login. */
  findResident(apartmentId: string, email: string, userId: string): Promise<string | null>
  insertResident(row: NewResident): Promise<string>
  link(userId: string, residentId: string): Promise<void>
  audit(row: AuditRow): Promise<void>
}
export interface Reply { status: number; body: Record<string, unknown> }

export const MAX_INVITES = 40
export const ERR = {
  exists: 'כבר קיים משתמש עם האימייל הזה',
  email: 'כתובת אימייל לא תקינה',
  apartment: 'הדירה לא נמצאה',
  resident: 'הדייר לא נמצא',
  rate: 'נשלחו יותר מדי הזמנות, נסו שוב מאוחר יותר',
  smtp: 'שליחת האימייל נכשלה',
  failed: 'ההזמנה נכשלה',
  skipped: 'לא נשלחה – מגבלת שליחה',
  autoconfirm: 'לא ניתן לשלוח הזמנות כש"אימות אימייל" כבוי. יש להפעיל את Confirm email ב-Supabase (Authentication → Providers → Email).',
} as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const fail = (status: number, error: string): Reply => ({ status, body: { error } })
const optId = (v: unknown): string | null | undefined =>
  v === undefined || v === null ? null : typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : undefined
const optName = (v: unknown): string | null | undefined =>
  v === undefined || v === null ? null : typeof v === 'string' && v.length <= 200 ? v.trim() || null : undefined

export const normalizeEmail = (email: string): string => email.trim().toLowerCase()
export const validEmail = (email: string): boolean => email.length <= 254 && EMAIL.test(email)

function parseInvite(v: unknown): InviteInput | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const residentId = optId(o.residentId)
  const apartmentId = optId(o.apartmentId)
  const fullName = optName(o.fullName)
  if (typeof o.email !== 'string' || residentId === undefined || apartmentId === undefined || fullName === undefined) return null
  return { email: normalizeEmail(o.email), residentId, apartmentId, fullName }
}

/** The body, with duplicate addresses collapsed (the first one wins); null when malformed. */
export function parse(body: unknown): InviteRequest | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  const groupId = optId(b.groupId)
  if (!Array.isArray(b.invites) || b.invites.length === 0 || b.invites.length > MAX_INVITES || groupId === undefined) return null
  const invites = b.invites.map(parseInvite)
  if (invites.some((i) => i === null)) return null
  const seen = new Set<string>()
  const unique = (invites as InviteInput[]).filter((i) => !seen.has(i.email) && Boolean(seen.add(i.email)))
  return { invites: unique, groupId }
}

type Kind = 'rate' | 'smtp' | 'exists' | 'other'
/** Maps a GoTrue error to what the admin is told. */
export function classify(e: unknown): Kind {
  if (!(e instanceof AuthFailure)) return 'other'
  if (e.status === 429 || (e.code ?? '').includes('rate_limit')) return 'rate'
  if (e.code === 'email_exists' || /already been registered/i.test(e.message)) return 'exists'
  if (/sending|smtp/i.test(e.message)) return 'smtp'
  return 'other'
}
const KIND_RESULT: Record<Kind, Pick<InviteResult, 'outcome' | 'error'>> = {
  rate: { outcome: 'failed', error: ERR.rate },
  smtp: { outcome: 'failed', error: ERR.smtp },
  exists: { outcome: 'exists', error: ERR.exists },
  other: { outcome: 'failed', error: ERR.failed },
}

interface Ctx { d: InviteDeps; actor: string; buildingId: string; groupId: string | null }

/** Where the invitee goes: a picked resident's apartment, or the typed address's apartment; a string = the error. */
async function place(inv: InviteInput, c: Ctx): Promise<Placement | string> {
  if (inv.residentId) {
    // Only a resident with no login whose address is the invite's: a pick can't attach to someone else's record.
    const r = await c.d.resident(inv.residentId, c.buildingId)
    const ok = r !== null && !r.linked && r.email !== null && normalizeEmail(r.email) === inv.email
    return ok ? { apartmentId: r.apartmentId, residentId: inv.residentId } : ERR.resident
  }
  if (inv.apartmentId && !(await c.d.apartmentOk(inv.apartmentId, c.buildingId))) return ERR.apartment
  return { apartmentId: inv.apartmentId, residentId: null }
}

/** Runs a step after the login exists; on failure records `name` in warnings instead of throwing. */
async function attempt(step: () => Promise<void>, name: Warning, warnings: Warning[]): Promise<void> {
  try {
    await step()
  } catch (e) {
    warnings.push(name)
    console.warn(`[admin-invite-user] ${name} failed after the invite:`, e instanceof Error ? e.message : String(e))
  }
}

/** The invite is the admin's approval: approve with the group, link the resident (reused or new), audit. */
async function settle(userId: string, inv: InviteInput, p: Placement, c: Ctx): Promise<Warning[]> {
  const warnings: Warning[] = []
  await attempt(() => c.d.approve(userId, c.groupId), 'approve', warnings)
  let residentId = p.residentId
  if (p.apartmentId) {
    const apartmentId = p.apartmentId
    await attempt(async () => {
      residentId ??= await c.d.findResident(apartmentId, inv.email, userId) ?? await c.d.insertResident({
        building_id: c.buildingId, apartment_id: apartmentId, full_name: inv.fullName ?? inv.email.split('@')[0], email: inv.email })
      await c.d.link(userId, residentId)
    }, 'link', warnings)
  }
  await attempt(() => audit(c, userId, inv.email, false, p.apartmentId, residentId), 'audit', warnings)
  return warnings
}

const audit = (c: Ctx, userId: string, email: string, resent: boolean, apartmentId: string | null, residentId: string | null) =>
  c.d.audit({ building_id: c.buildingId, actor: c.actor, action: 'invite_user', target_id: userId, apartment_id: apartmentId,
    details: { email, resent, group_id: c.groupId, resident_id: residentId } })

/** Sends the invite (or the resend for an invited login that never signed in); maps auth errors. */
async function send(inv: InviteInput, c: Ctx): Promise<InviteResult> {
  if (!validEmail(inv.email)) return { email: inv.email, outcome: 'failed', error: ERR.email }
  const p = await place(inv, c)
  if (typeof p === 'string') return { email: inv.email, outcome: 'failed', error: p }
  const found = await c.d.existing(inv.email)
  if (found && !(found.invitedAt && !found.lastSignInAt)) return { email: inv.email, outcome: 'exists', error: ERR.exists }
  let userId: string
  try {
    userId = await c.d.invite(inv.email, inv.fullName)
  } catch (e) {
    return { email: inv.email, ...KIND_RESULT[classify(e)] }
  }
  // A race (another login created or signed in meanwhile): never approve or link someone else's account.
  const after = await c.d.existing(inv.email)
  if (!after || after.userId !== userId || after.lastSignInAt || (found && found.userId !== userId)) {
    return { email: inv.email, outcome: 'exists', error: ERR.exists }
  }
  if (found) {
    const warnings: Warning[] = []
    await attempt(() => audit(c, userId, inv.email, true, null, null), 'audit', warnings)
    return { email: inv.email, outcome: 'resent', ...(warnings.length ? { warnings } : {}) }
  }
  const warnings = await settle(userId, inv, p, c)
  return { email: inv.email, outcome: 'sent', ...(warnings.length ? { warnings } : {}) }
}

/** Admins only. Each invite is processed in turn; one failure doesn't stop the others, the rate limit stops the rest. */
export async function handleInvite(body: unknown, d: InviteDeps): Promise<Reply> {
  const caller = await d.caller()
  if (!caller) return fail(401, 'נדרשת התחברות')
  if (!caller.isAdmin) return fail(403, 'רק מנהל יכול להזמין משתמשים')
  const req = parse(body)
  if (!req) return fail(400, 'בקשה לא תקינה')
  // An invite approves a login nobody has claimed yet. With auto-confirm on, signUp() with the invited address
  // returns a session for that approved login to whoever calls it first, so refuse to invite at all.
  if (await d.autoconfirm()) return fail(409, ERR.autoconfirm)
  const buildingId = await d.buildingOf(caller.userId)
  if (req.groupId && !(await d.groupInBuilding(req.groupId, buildingId))) return fail(400, 'הקבוצה לא נמצאה')
  const c: Ctx = { d, actor: caller.userId, buildingId, groupId: req.groupId }
  const results: InviteResult[] = []
  for (const inv of req.invites) {
    const stopped = results.some((r) => r.error === ERR.rate || r.outcome === 'skipped')
    const failed: InviteResult = { email: inv.email, outcome: 'failed', error: ERR.failed }
    results.push(stopped ? { email: inv.email, outcome: 'skipped', error: ERR.skipped } : await send(inv, c).catch((e: unknown) => {
      console.warn('[admin-invite-user] invite failed:', e instanceof Error ? e.message : String(e))
      return failed
    }))
  }
  return { status: 200, body: { results } }
}
