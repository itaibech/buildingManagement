import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { type PermissionKey, toPermissionSet } from '../lib/permissions'
import { supabase } from '../lib/supabase'

export const PERMISSIONS_KEY = ['permissions'] as const

/** How often the resolved permissions are re-checked while the app stays open (they also refresh on focus). */
const REFRESH_MS = 5 * 60_000

export interface PermissionsState {
  granted: ReadonlySet<PermissionKey>
  loading: boolean
  /** The first load failed (no permissions known): the app shows a load error with retry, not "no access". */
  failed: boolean
  retry(): void
}

const NONE: ReadonlySet<PermissionKey> = new Set()

/**
 * The signed-in user's permitted keys, from rpc('my_permissions'), fetched once per user and refreshed on window
 * focus, every few minutes, and whenever an admin's group edit invalidates ['permissions'].
 */
export function usePermissions(userId: string | undefined, approved: boolean): PermissionsState {
  const q = useQuery({
    queryKey: [...PERMISSIONS_KEY, userId],
    enabled: Boolean(userId) && approved,
    refetchOnWindowFocus: 'always',
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<ReadonlySet<PermissionKey>> => {
      const { data, error } = await supabase.rpc('my_permissions')
      if (error) throw new Error(error.message)
      return toPermissionSet(data ?? [])
    },
  })
  const { refetch } = q
  return {
    granted: q.data ?? NONE,
    loading: Boolean(userId) && approved && q.isPending,
    failed: q.isError && q.data === undefined,
    retry: useCallback(() => void refetch(), [refetch]),
  }
}
