/** admin-delete-user: pure request handling (no Deno or network imports, so Vitest can load it). */
import type { Caller } from '../../send-email/lib/types.ts'

/** The user to delete, read with the service role. */
export interface Target {
  userId: string
  name: string
  email: string | null
  isSuperAdmin: boolean
  residentId: string | null
  apartmentId: string | null
  buildingId: string
}
export interface AuditRow {
  building_id: string
  actor: string
  action: 'delete_user'
  target_id: string
  apartment_id: string | null
  details: { name: string; email: string | null; resident_removed: boolean }
}
export interface DeleteDeps {
  caller(): Promise<Caller | null>
  target(userId: string): Promise<Target | null>
  deleteUser(userId: string): Promise<void>
  removeResident(residentId: string): Promise<void>
  audit(row: AuditRow): Promise<void>
}
export interface Reply { status: number; body: Record<string, unknown> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = (status: number, error: string): Reply => ({ status, body: { error } })

function parse(body: unknown): { userId: string; removeResident: boolean } | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  if (typeof b.userId !== 'string' || !UUID.test(b.userId)) return null
  if (b.removeResident !== undefined && typeof b.removeResident !== 'boolean') return null
  return { userId: b.userId.toLowerCase(), removeResident: b.removeResident === true }
}

/** Admins only; never the super admin or the caller. Deletes the login (the profile cascades), then optionally the
 *  resident record, then writes admin_audit. Authorship columns elsewhere are on delete set null (0022). */
export async function handleDelete(body: unknown, d: DeleteDeps): Promise<Reply> {
  const caller = await d.caller()
  if (!caller) return fail(401, 'נדרשת התחברות')
  if (!caller.isAdmin) return fail(403, 'רק מנהל יכול למחוק משתמשים')
  const req = parse(body)
  if (!req) return fail(400, 'בקשה לא תקינה')
  if (req.userId === caller.userId.toLowerCase()) return fail(403, 'לא ניתן למחוק את המשתמש שלך')
  const t = await d.target(req.userId)
  if (!t) return fail(404, 'המשתמש לא נמצא')
  if (t.isSuperAdmin) return fail(403, 'לא ניתן למחוק את מנהל העל')
  await d.deleteUser(t.userId)
  const residentRemoved = req.removeResident && t.residentId !== null
  if (residentRemoved && t.residentId) await d.removeResident(t.residentId)
  await d.audit({ building_id: t.buildingId, actor: caller.userId, action: 'delete_user', target_id: t.userId,
    apartment_id: t.apartmentId, details: { name: t.name, email: t.email, resident_removed: residentRemoved } })
  return { status: 200, body: { deleted: true, residentRemoved } }
}
