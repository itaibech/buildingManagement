import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import type { Database } from '../../lib/db.types'
import { he } from '../../lib/he'
import { supabase } from '../../lib/supabase'
import { notifyError } from '../../ui/notify'
import { expiredAnnouncements, isReadBy, visibleAnnouncements } from './visible'
import { todayISO } from '../../lib/dates'

export type Announcement = Database['public']['Tables']['announcements']['Row']
export type AnnouncementItem = Announcement & { isRead: boolean }

export interface AnnouncementInput {
  title: string
  body: string
  pinned: boolean
  expires_at: string | null
}

const KEY = ['announcements'] as const

async function fetchAnnouncements(userId: string | undefined): Promise<AnnouncementItem[]> {
  const [list, reads] = await Promise.all([
    supabase.from('announcements').select('*'),
    supabase.from('announcement_reads').select('announcement_id'),
  ])
  if (list.error) throw new Error(list.error.message)
  if (reads.error) throw new Error(reads.error.message)
  const read = new Set(reads.data.map((r) => r.announcement_id))
  return list.data.map((a) => ({ ...a, isRead: isReadBy(a, read, userId) }))
}

function useAnnouncementsSelect<T>(select: (items: AnnouncementItem[], today: string) => T) {
  const today = todayISO()
  const userId = useAuth().session?.user.id
  const pick = useCallback((items: AnnouncementItem[]) => select(items, today), [select, today])
  return useQuery({ queryKey: [...KEY, userId], queryFn: () => fetchAnnouncements(userId), select: pick })
}

/** Non-expired announcements, pinned first then newest, each with `isRead` for the signed-in user. */
export function useAnnouncements() {
  return useAnnouncementsSelect(visibleAnnouncements)
}

/** Expired announcements (RLS lets every approved user read them; only admins are shown them). */
export function useExpiredAnnouncements() {
  return useAnnouncementsSelect(expiredAnnouncements)
}

/** Count of visible, unread announcements for the nav badge. */
export function useUnreadCount(): number {
  const { data } = useAnnouncements()
  return useMemo(() => data?.filter((a) => !a.isRead).length ?? 0, [data])
}

/** Marks one announcement (or several) read for the signed-in user. */
export function useMarkRead() {
  const client = useQueryClient()
  const { session } = useAuth()
  const userId = session?.user.id
  return useMutation({
    mutationFn: async (ids: string | readonly string[]) => {
      if (!userId) throw new Error('Not signed in')
      const rows = (typeof ids === 'string' ? [ids] : ids).map((announcement_id) => ({ announcement_id, user_id: userId }))
      if (rows.length === 0) return
      const { error } = await supabase
        .from('announcement_reads')
        .upsert(rows, { onConflict: 'announcement_id,user_id', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
    onError: () => notifyError(he.toast.failed),
  })
}

export function useSaveAnnouncement() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...values }: AnnouncementInput & { id?: string }) => {
      const table = supabase.from('announcements')
      const { error } = await (id ? table.update(values).eq('id', id) : table.insert(values))
      if (error) throw new Error(error.message)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteAnnouncement() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('announcements').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}
