import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthFailure, type ExistingUser, type InviteDeps, type PickedResident } from './handler.ts'

interface Result<T> { data: T | null; error: { message: string } | null }
function maybe<T>(r: Result<T>): T | null {
  if (r.error) throw new Error(r.error.message)
  return r.data
}
function must<T>(r: Result<T>): T {
  const data = maybe(r)
  if (data === null) throw new Error('not found')
  return data
}

interface AuthRow { user_id: string; invited_at: string | null; last_sign_in_at: string | null }

async function existing(db: SupabaseClient, email: string): Promise<ExistingUser | null> {
  const rows = maybe<AuthRow[]>(await db.rpc('auth_user_by_email', { p_email: email })) ?? []
  const u = rows[0]
  return u ? { userId: u.user_id, invitedAt: u.invited_at, lastSignInAt: u.last_sign_in_at } : null
}

async function resident(db: SupabaseClient, residentId: string, buildingId: string): Promise<PickedResident | null> {
  const r = maybe<{ apartment_id: string; email: string | null; apartments: { archived_at: string | null } }>(await db.from('residents')
    .select('apartment_id, email, apartments!inner(archived_at)').eq('id', residentId).eq('building_id', buildingId).maybeSingle())
  if (!r || r.apartments.archived_at) return null
  const links = maybe<{ user_id: string }[]>(await db.from('profiles').select('user_id').eq('resident_id', residentId).limit(1)) ?? []
  return { apartmentId: r.apartment_id, email: r.email, linked: links.length > 0 }
}

/** A resident of the apartment with this email that no other login is linked to. */
async function findResident(db: SupabaseClient, apartmentId: string, email: string, userId: string): Promise<string | null> {
  const candidates = maybe<{ id: string; email: string | null }[]>(await db.from('residents')
    .select('id, email').eq('apartment_id', apartmentId).not('email', 'is', null)) ?? []
  const matching = candidates.filter((r) => r.email?.trim().toLowerCase() === email).map((r) => r.id)
  if (matching.length === 0) return null
  const linked = maybe<{ resident_id: string }[]>(await db.from('profiles')
    .select('resident_id').in('resident_id', matching).neq('user_id', userId)) ?? []
  return matching.find((id) => !linked.some((l) => l.resident_id === id)) ?? null
}

/** The invite: redirects to the app (the landing page detects type=invite and routes to choosing a password). */
function inviter(db: SupabaseClient, appUrl: string): InviteDeps['invite'] {
  return async (email, fullName) => {
    const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: appUrl, data: fullName ? { full_name: fullName } : {} })
    if (error) throw new AuthFailure(error.message, error.status, error.code)
    return data.user.id
  }
}

/** GoTrue's public settings: whether email sign-ups are auto-confirmed. True unless the server says false (fails closed). */
export async function mailerAutoconfirm(url: string, anonKey: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const res = await fetchFn(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } })
  if (!res.ok) throw new Error(`auth settings: HTTP ${res.status}`)
  const body: unknown = await res.json()
  return !(typeof body === 'object' && body !== null && (body as { mailer_autoconfirm?: unknown }).mailer_autoconfirm === false)
}

/** Reads and writes with the service-role client (server only; never exposed to the browser). */
export function inviteSource(db: SupabaseClient, appUrl: string): Omit<InviteDeps, 'caller' | 'autoconfirm'> {
  return {
    buildingOf: async (userId) => must<{ building_id: string }>(await db.from('profiles').select('building_id').eq('user_id', userId).single()).building_id,
    groupInBuilding: async (id, b) => maybe(await db.from('user_groups').select('id').eq('id', id).eq('building_id', b).maybeSingle()) !== null,
    apartmentOk: async (id, b) => maybe(await db.from('apartments').select('id').eq('id', id).eq('building_id', b).is('archived_at', null).maybeSingle()) !== null,
    resident: (id, b) => resident(db, id, b),
    existing: (email) => existing(db, email),
    invite: inviter(db, appUrl),
    approve: async (userId, groupId) => { maybe(await db.from('profiles').update({ status: 'approved', group_id: groupId }).eq('user_id', userId)) },
    findResident: (apt, email, userId) => findResident(db, apt, email, userId),
    insertResident: async (row) => must<{ id: string }>(await db.from('residents').insert(row).select('id').single()).id,
    link: async (userId, residentId) => { maybe(await db.from('profiles').update({ resident_id: residentId }).eq('user_id', userId)) },
    audit: async (row) => { maybe(await db.from('admin_audit').insert(row)) },
  }
}
