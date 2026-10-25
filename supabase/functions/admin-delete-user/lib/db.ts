import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuditRow, DeleteDeps, Target } from './handler.ts'

interface Result<T> { data: T | null; error: { message: string } | null }
function maybe<T>(r: Result<T>): T | null {
  if (r.error) throw new Error(r.error.message)
  return r.data
}

interface ProfileRow {
  user_id: string; full_name: string; email: string | null; is_super_admin: boolean; resident_id: string | null; building_id: string
}

async function target(db: SupabaseClient, userId: string): Promise<Target | null> {
  const p = maybe<ProfileRow>(await db.from('profiles')
    .select('user_id, full_name, email, is_super_admin, resident_id, building_id').eq('user_id', userId).maybeSingle())
  if (!p) return null
  const r = p.resident_id
    ? maybe<{ apartment_id: string }>(await db.from('residents').select('apartment_id').eq('id', p.resident_id).maybeSingle())
    : null
  return { userId: p.user_id, name: p.full_name, email: p.email, isSuperAdmin: p.is_super_admin, residentId: p.resident_id,
    apartmentId: r?.apartment_id ?? null, buildingId: p.building_id }
}

/** The writes, with the service-role client (server only; never exposed to the browser). */
export function deleteSource(db: SupabaseClient): Omit<DeleteDeps, 'caller'> {
  return {
    target: (id) => target(db, id),
    deleteUser: async (id) => {
      const { error } = await db.auth.admin.deleteUser(id)
      if (error) throw new Error(error.message)
    },
    removeResident: async (id) => { maybe(await db.from('residents').delete().eq('id', id)) },
    audit: async (row: AuditRow) => { maybe(await db.from('admin_audit').insert(row)) },
  }
}
