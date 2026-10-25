import type { SupabaseClient } from '@supabase/supabase-js'
import type { Balance, Caller, Context, DataSource, LedgerRow, LogRow, MeetingInfo, Reservation, Resident, TicketInfo } from './types.ts'

/** The slice of a supabase-js client (built with the caller's JWT) used to identify the caller. */
export interface AuthClient {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> }
  rpc(fn: 'is_admin'): PromiseLike<{ data: unknown; error: unknown }>
}

/** Who is calling, from their own JWT (RLS context): null when not signed in. */
export async function callerFrom(client: AuthClient): Promise<Caller | null> {
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) return null
  const admin = await client.rpc('is_admin')
  return { userId: data.user.id, isAdmin: !admin.error && admin.data === true }
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
  const comments = must<{ body: string }[]>(await db.from('ticket_comments').select('body').eq('ticket_id', id)
    .order('created_at', { ascending: false }).limit(1))
  return { id: t.id, title: t.title, status: t.status, location: t.location, latestComment: comments[0]?.body ?? null,
    openerApartmentId: await openerApartment(db, t.opened_by) }
}

async function meeting(db: SupabaseClient, id: string, buildingId: string): Promise<MeetingInfo | null> {
  const m = maybe<Omit<MeetingInfo, 'agenda'>>(await db.from('meetings')
    .select('id, kind, title, scheduled_at, opened_at, location, status').eq('id', id).eq('building_id', buildingId).maybeSingle())
  if (!m) return null
  const items = must<{ title: string }[]>(await db.from('meeting_agenda_items').select('title').eq('meeting_id', id)
    .eq('item_status', 'open').order('position').order('created_at'))
  return { ...m, agenda: items.map((i) => i.title) }
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

/** reserve_email_quota (0020): a pending row id, or null when the cap has no room. */
async function reserve(db: SupabaseClient, r: Reservation): Promise<string | null> {
  const id = maybe<string>(await db.rpc('reserve_email_quota', {
    p_building: r.building_id, p_count: r.count, p_cap: r.cap, p_kind: r.kind, p_sent_by: r.sent_by,
    p_ref_id: r.ref_id, p_apartment_ids: r.apartment_ids,
  }))
  return typeof id === 'string' ? id : null
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
    log: async (row: LogRow) => { maybe(await db.from('email_log').insert(row)) },
  }
}
