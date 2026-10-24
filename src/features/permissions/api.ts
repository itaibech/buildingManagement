import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PERMISSIONS_KEY } from '../../auth/usePermissions'
import { he } from '../../lib/he'
import { isPermissionKey, type PermissionKey } from '../../lib/permissions'
import { supabase } from '../../lib/supabase'
import { notifyError } from '../../ui/notify'

export interface Group {
  id: string
  name: string
  description: string
  isDefault: boolean
  permissions: ReadonlySet<PermissionKey>
}
export interface GroupInput { id?: string; name: string; description: string }

const KEY = ['groups'] as const

function fail(error: { message: string; code?: string } | null): void {
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
}

/** True when a save failed because another group already has the name (unique per building). */
export const isNameTaken = (e: unknown): boolean => e instanceof Error && (e as Error & { code?: string }).code === '23505'

/** Admin: every group with its permission keys, the default first, then by creation. */
export function useGroups() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Group[]> => {
      const { data, error } = await supabase.from('user_groups')
        .select('id, name, description, is_default, group_permissions(permission)')
        .order('is_default', { ascending: false }).order('created_at')
      fail(error)
      return (data ?? []).map((g) => ({
        id: g.id, name: g.name, description: g.description, isDefault: g.is_default,
        permissions: new Set(g.group_permissions.map((p) => p.permission).filter(isPermissionKey)),
      }))
    },
  })
}

/** Group edits refresh the groups, the users page and everyone's resolved permissions. */
function useGroupMutation<A>(fn: (args: A) => Promise<void>, quiet = false) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void client.invalidateQueries({ queryKey: KEY })
      void client.invalidateQueries({ queryKey: ['profiles'] })
      void client.invalidateQueries({ queryKey: PERMISSIONS_KEY })
    },
    onError: quiet ? undefined : () => notifyError(he.toast.failed),
  })
}

/** Turns one permission on or off for a group. */
export function useTogglePermission() {
  return useGroupMutation(async ({ groupId, key, on }: { groupId: string; key: PermissionKey; on: boolean }) => {
    const table = supabase.from('group_permissions')
    fail((on ? await table.insert({ group_id: groupId, permission: key }) : await table.delete().eq('group_id', groupId).eq('permission', key)).error)
  })
}

/** Creates or renames a group. Errors stay with the form (a taken name is shown on the field). */
export function useSaveGroup() {
  return useGroupMutation(async ({ id, name, description }: GroupInput) => {
    const table = supabase.from('user_groups')
    fail((id ? await table.update({ name, description }).eq('id', id) : await table.insert({ name, description })).error)
  }, true)
}

export function useDeleteGroup() {
  return useGroupMutation(async (id: string) => fail((await supabase.from('user_groups').delete().eq('id', id)).error), true)
}

export function useSetDefaultGroup() {
  return useGroupMutation(async (id: string) => fail((await supabase.rpc('set_default_group', { p_group_id: id })).error))
}
