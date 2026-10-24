// Pure helpers for the groups page (no supabase).
import type { Profile } from '../tenants/api'
import type { Group } from './api'

/** Members per group: approved non-admin users; no group = the default group. */
export function memberCounts(groups: readonly Group[], profiles: readonly Pick<Profile, 'role' | 'status' | 'group_id'>[]): Map<string, number> {
  const fallback = groups.find((g) => g.isDefault)?.id
  const counts = new Map(groups.map((g) => [g.id, 0]))
  for (const p of profiles) {
    if (p.status !== 'approved' || p.role === 'admin') continue
    const id = p.group_id && counts.has(p.group_id) ? p.group_id : fallback
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}
