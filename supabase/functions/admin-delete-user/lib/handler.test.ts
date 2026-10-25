import { describe, expect, it } from 'vitest'
import { handleDelete, type AuditRow, type DeleteDeps, type Target } from './handler.ts'

const ADMIN = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const SUPER = '33333333-3333-4333-8333-333333333333'

const targets: Record<string, Target> = {
  [ADMIN]: { userId: ADMIN, name: 'מנהלת', email: 'admin@example.test', isSuperAdmin: false, residentId: null, apartmentId: null, buildingId: 'b1' },
  [USER]: { userId: USER, name: 'דייר', email: 'res@example.test', isSuperAdmin: false, residentId: 'r1', apartmentId: 'a1', buildingId: 'b1' },
  [SUPER]: { userId: SUPER, name: 'על', email: 'super@example.test', isSuperAdmin: true, residentId: null, apartmentId: null, buildingId: 'b1' },
}

type Fake = DeleteDeps & { deleted: string[]; residents: string[]; audits: AuditRow[] }

function deps(isAdmin = true, signedIn = true): Fake {
  const deleted: string[] = []
  const residents: string[] = []
  const audits: AuditRow[] = []
  return {
    deleted, residents, audits,
    caller: async () => (signedIn ? { userId: ADMIN, isAdmin } : null),
    target: async (id) => targets[id] ?? null,
    deleteUser: async (id) => { deleted.push(id) },
    removeResident: async (id) => { residents.push(id) },
    audit: async (row) => { audits.push(row) },
  }
}

describe('admin-delete-user', () => {
  it('401 without a session', async () => {
    expect((await handleDelete({ userId: USER }, deps(true, false))).status).toBe(401)
  })
  it('403 for a non-admin, and nothing is deleted', async () => {
    const d = deps(false)
    expect((await handleDelete({ userId: USER }, d)).status).toBe(403)
    expect(d.deleted).toEqual([])
  })
  it('403 when the target is the super admin', async () => {
    const d = deps()
    expect((await handleDelete({ userId: SUPER }, d)).status).toBe(403)
    expect(d.deleted).toEqual([])
  })
  it('403 when the target is the caller', async () => {
    const d = deps()
    expect((await handleDelete({ userId: ADMIN }, d)).status).toBe(403)
    expect(d.deleted).toEqual([])
  })
  it('400 on a malformed body, 404 for an unknown user', async () => {
    expect((await handleDelete({ userId: 'x' }, deps())).status).toBe(400)
    expect((await handleDelete(null, deps())).status).toBe(400)
    expect((await handleDelete({ userId: '44444444-4444-4444-8444-444444444444' }, deps())).status).toBe(404)
  })
  it('deletes the login, keeps the resident by default, and logs it', async () => {
    const d = deps()
    const r = await handleDelete({ userId: USER }, d)
    expect(r).toEqual({ status: 200, body: { deleted: true, residentRemoved: false } })
    expect(d.deleted).toEqual([USER])
    expect(d.residents).toEqual([])
    expect(d.audits).toEqual([{ building_id: 'b1', actor: ADMIN, action: 'delete_user', target_id: USER, apartment_id: 'a1',
      details: { name: 'דייר', email: 'res@example.test', resident_removed: false } }])
  })
  it('also removes the resident record when asked', async () => {
    const d = deps()
    const r = await handleDelete({ userId: USER, removeResident: true }, d)
    expect(r.body).toEqual({ deleted: true, residentRemoved: true })
    expect(d.residents).toEqual(['r1'])
  })
})
