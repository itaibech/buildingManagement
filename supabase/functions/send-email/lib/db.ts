import type { SupabaseClient } from '@supabase/supabase-js'
import { DuplicateLogError } from './plan.ts'
import type {
  Admin, Balance, Caller, CommitteeMessage, Context, DataSource, EmailKind, FollowupDue, LedgerRow, LogRow, MeetingInfo, NewTicket,
  Reservation, Resident, TicketInfo,
} from './types.ts'

/** The slice of a supabase-js client (built with the caller's JWT) used to identify the caller. */
export interface AuthClient {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> }
  rpc(fn: 'is_admin' | 'my_permissions'): PromiseLike<{ data: unknown; error: unknown }>
}

const keysOf = (r: { data: unknown; error: unknown }): string[] =>
  !r.error && Array.isArray(r.data) ? r.data.filter((k): k is string => typeof k === 'string') : []

/** Who is calling, from their own JWT (RLS context): null when not signed in. Permissions: my_permissions (0016). */
export async function callerFrom(client: AuthClient): Promise<Caller | null> {
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) return null
  const [admin, keys] = await Promise.all([client.rpc('is_admin'), client.rpc('my_permissions')])
  return { userId: data.user.id, isAdmin: !admin.error && admin.data === true, permissions: keysOf(keys) }
}

interface Result<T> { data: T | null; error: { message: string } | null }

function must<T>(r: Result<T>): T {
  if (r.error) throw new Error(r.error.message)
  if (r.data === null) throw new Error('not found')
  return r.data
}
const maybe = <T>(r: Result<T>): T | null => {
  if (r.error) throw new Error(r.error.message)
  return r.data
}

async function context(db: SupabaseClient, userId: string): Promise<Context> {
  const p = must<{ building_id: string; email: string | null; full_name: string }>(
    await db.from('profiles').select('building_id, email, full_name').eq('user_id', userId).single())
  const building = must<Context['building']>(await db.from('buildings')
    .select('id, name, payment_instructions, committee_contact').eq('id', p.building_id).single())
  return { building, email: p.email, name: p.full_name }
}

async function openerApartment(db: SupabaseClient, userId: string | null): Promise<string | null> {
  if (!userId) return null
  const p = maybe<{ resident_id: string | null }>(await db.from('profiles').select('resident_id').eq('user_id', userId).maybeSingle())
  if (!p?.resident_id) return null
  const r = maybe<{ apartment_id: string }>(await db.from('residents').select('apartment_id').eq('id', p.resident_id).maybeSingle())
  return r?.apartment_id ?? null
}

async function ticket(db: SupabaseClient, id: string, buildingId: string): Promise<TicketInfo | null> {
  const t = maybe<{ id: string; title: string; status: string; location: string; opened_by: string | null }>(await db.from('tickets')
    .select('id, title, status, location, opened_by').eq('id', id).eq('building_id', buildingId).maybeSingle())
  if (!t) return null
  // The latest real comment: automatic timeline lines (0039, event set) carry a code, not text.
  const comments = must<{ body: string }[]>(await db.from('ticket_comments').select('body').eq('ticket_id', id).is('event', null)
    .order('created_at', { ascending: false }).limit(1))
  return { id: t.id, title: t.title, status: t.status, location: t.location, latestComment: comments[0]?.body ?? null,
    openerApartmentId: await openerApartment(db, t.opened_by) }
}

async function meeting(db: SupabaseClient, id: string, buildingId: string): Promise<MeetingInfo | null> {
  const m = maybe<Omit<MeetingInfo, 'agenda'>>(await db.from('meetings')
    .select('id, kind, title, scheduled_at, opened_at, location, status').eq('id', id).eq('building_id', buildingId).maybeSingle())
  if (!m) return null
  const items = must<{ title: string; discussion: string }[]>(await db.from('meeting_agenda_items').select('title, discussion')
    .eq('meeting_id', id).eq('item_status', 'open').order('position').order('created_at'))
  return { ...m, agenda: items.map((i) => ({ title: i.title, discussion: i.discussion })) }
}

async function balances(db: SupabaseClient, ids: string[]): Promise<Balance[]> {
  const rows = must<{ apartment_id: string; balance: number | string }[]>(
    await db.from('apartment_balances').select('apartment_id, balance').in('apartment_id', ids))
  return rows.map((r) => ({ apartmentId: r.apartment_id, balance: Number(r.balance) }))
}

async function ledger(db: SupabaseClient, ids: string[]): Promise<(LedgerRow & { apartmentId: string })[]> {
  const rows = must<{ apartment_id: string; month: string; charged: number | string; paid: number | string }[]>(
    await db.from('apartment_ledger').select('apartment_id, month, charged, paid').in('apartment_id', ids))
  return rows.map((r) => ({ apartmentId: r.apartment_id, month: r.month, charged: Number(r.charged), paid: Number(r.paid) }))
}

/** email_log writes: a unique violation (ticket_new announced twice) becomes DuplicateLogError. */
function logged<T>(r: Result<T> & { error: { message: string; code?: string } | null }): T | null {
  if (r.error?.code === '23505') throw new DuplicateLogError(r.error.message)
  return maybe(r)
}

/** reserve_email_quota (0020): a pending row id, or null when the cap has no room. */
async function reserve(db: SupabaseClient, r: Reservation): Promise<string | null> {
  const id = logged<string>(await db.rpc('reserve_email_quota', {
    p_building: r.building_id, p_count: r.count, p_cap: r.cap, p_kind: r.kind, p_sent_by: r.sent_by,
    p_ref_id: r.ref_id, p_apartment_ids: r.apartment_ids,
  }))
  return typeof id === 'string' ? id : null
}

async function newTicket(db: SupabaseClient, id: string, buildingId: string): Promise<NewTicket | null> {
  const t = maybe<{ id: string; title: string; description: string; location: string; opened_by: string | null; created_at: string }>(
    await db.from('tickets').select('id, title, description, location, opened_by, created_at').eq('id', id).eq('building_id', buildingId).maybeSingle())
  return t && { id: t.id, title: t.title, description: t.description, location: t.location, openedBy: t.opened_by, createdAt: t.created_at }
}

async function admins(db: SupabaseClient, buildingId: string): Promise<Admin[]> {
  const rows = must<{ user_id: string; full_name: string; email: string | null }[]>(await db.from('profiles')
    .select('user_id, full_name, email').eq('building_id', buildingId).eq('role', 'admin').eq('status', 'approved'))
  return rows.map((r) => ({ userId: r.user_id, name: r.full_name, email: r.email }))
}

async function apartmentNumber(db: SupabaseClient, userId: string): Promise<number | null> {
  const id = await openerApartment(db, userId)
  if (!id) return null
  const a = maybe<{ number: number }>(await db.from('apartments').select('number').eq('id', id).maybeSingle())
  return a?.number ?? null
}

async function countSince(db: SupabaseClient, userId: string, kind: EmailKind, since: string): Promise<number> {
  const { count, error } = await db.from('email_log').select('id', { count: 'exact', head: true })
    .eq('sent_by', userId).eq('kind', kind).gte('created_at', since)
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function hasLog(db: SupabaseClient, kind: EmailKind, refId: string): Promise<boolean> {
  const rows = must<{ id: string }[]>(await db.from('email_log').select('id').eq('kind', kind).eq('ref_id', refId).limit(1))
  return rows.length > 0
}

const RATE_LIMIT = 'committee_message:rate_limit'

/** store_committee_message (0029): serialized per sender; null when the sender is over the 24-hour limit. */
async function storeMessage(db: SupabaseClient, m: CommitteeMessage): Promise<string | null> {
  const r = await db.rpc('store_committee_message', {
    p_building: m.building_id, p_sender: m.sender_id, p_recipient: m.recipient_id, p_sender_name: m.sender_name,
    p_sender_email: m.sender_email, p_apartment_number: m.apartment_number, p_subject: m.subject, p_body: m.body,
  })
  if (r.error?.message.includes(RATE_LIMIT)) return null
  return must<string>(r)
}

/** debt_followups_ready (0035): the pending follow-up emails with today's balance (steps 1-2 only). */
async function followupsReady(db: SupabaseClient, buildingId: string, claim: boolean): Promise<FollowupDue[]> {
  const rows = must<{ id: string; apartment_id: string; step: number; balance: number | string; days_overdue: number }[]>(
    await db.rpc('debt_followups_ready', { p_building: buildingId, p_claim: claim }))
  return rows.flatMap((r) => (r.step === 1 || r.step === 2
    ? [{ id: r.id, apartmentId: r.apartment_id, step: r.step, balance: Number(r.balance), days: r.days_overdue }]
    : []))
}

/** Reads and the audit insert, with the service-role client (server only; never exposed to the browser). */
export function dataSource(db: SupabaseClient): DataSource {
  return {
    context: (userId) => context(db, userId),
    apartments: async (b) => must<{ id: string; number: number }[]>(await db.from('apartments').select('id, number').eq('building_id', b).is('archived_at', null)),
    residents: async (b) => must<Resident[]>(await db.from('residents').select('apartment_id, full_name, email').eq('building_id', b)),
    announcement: async (id, b) => maybe<{ title: string; body: string }>(
      await db.from('announcements').select('title, body').eq('id', id).eq('building_id', b).maybeSingle()),
    ticket: (id, b) => ticket(db, id, b),
    meeting: (id, b) => meeting(db, id, b),
    balances: (ids) => balances(db, ids),
    ledger: (ids) => ledger(db, ids),
    sentToday: async (b) => Number(must<number>(await db.rpc('email_sent_today', { p_building: b }))),
    reserve: (r) => reserve(db, r),
    finish: async (id, o) => { maybe(await db.from('email_log').update({ ...o, status: 'done' }).eq('id', id)) },
    log: async (row: LogRow) => { logged(await db.from('email_log').insert(row)) },
    newTicket: (id, b) => newTicket(db, id, b),
    admins: (b) => admins(db, b),
    apartmentNumber: (userId) => apartmentNumber(db, userId),
    logged: (kind, refId) => hasLog(db, kind, refId),
    countSince: (userId, kind, since) => countSince(db, userId, kind, since),
    storeMessage: (m) => storeMessage(db, m),
    followupsReady: (b, claim) => followupsReady(db, b, claim),
    finishFollowups: async (b, claimed, sent, logId) => {
      maybe(await db.rpc('finish_debt_followups', { p_building: b, p_claimed: claimed, p_sent: sent, p_log: logId }))
    },
  }
}
