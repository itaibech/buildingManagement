// The permission registry: the one place the app lists its permission keys. Mirrors public.permissions (0016).
// Adding a feature = one key here (with its strings in he.permissions.catalog), one row in a migration, and its
// checks (RLS on the server; can() / RequirePermission / the nav entry here).
// The server enforces every key; the client only mirrors it to hide what the user can't open.
import { he } from './he'

export const PERMISSION_KEYS = [
  'home',
  'announcements',
  'tickets',
  'maintenance',
  'directory',
  'finance_own',
  'finance_reports',
  'ev_own',
] as const

export type PermissionKey = (typeof PERMISSION_KEYS)[number]

export interface PermissionDef {
  key: PermissionKey
  label: string
  description: string
  /** Always on for every approved user; shown with a lock, not toggleable. */
  locked: boolean
}

export const PERMISSIONS: readonly PermissionDef[] = PERMISSION_KEYS.map((key) => ({
  key,
  label: he.permissions.catalog[key].label,
  description: he.permissions.catalog[key].description,
  locked: key === 'home',
}))

const KEYS: ReadonlySet<string> = new Set(PERMISSION_KEYS)

export const isPermissionKey = (v: string): v is PermissionKey => KEYS.has(v)

/** The keys the server returned (unknown keys from a newer DB are ignored). */
export function toPermissionSet(keys: readonly string[]): ReadonlySet<PermissionKey> {
  return new Set(keys.filter(isPermissionKey))
}

/** `need` is one key or a list where any one is enough. */
export type PermissionNeed = PermissionKey | readonly PermissionKey[]

/** can(): admins may do everything; anyone else needs the key in their resolved set. */
export function makeCan(isAdmin: boolean, granted: ReadonlySet<PermissionKey>): (need: PermissionNeed) => boolean {
  return (need) => {
    if (isAdmin) return true
    const list: readonly PermissionKey[] = typeof need === 'string' ? [need] : need
    return list.some((k) => granted.has(k))
  }
}
