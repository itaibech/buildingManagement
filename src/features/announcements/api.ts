import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import type { Database } from '../../lib/db.types'
import { supabase } from '../../lib/supabase'
import { expiredAnnouncements, todayISO, visibleAnnouncements } from './visible'

export type Announcement = Database['public']['Tables']['announcements']['Row']
export type AnnouncementItem = Announcement & { isRead: boolean }

export interface AnnouncementInput {
  title: string
  body: string
  pinned: boolean
  expires_at: string | null
}

const KEY = ['announcements'] as const

async function fetchAnnouncements(): Promise<AnnouncementItem[]> {
  const [list, reads] = await Promise.all([
    supabase.from('announcements').select('*'),
    supabase.from('announcement_reads').select('announcement_id'),
  ])
  if (list.error) throw new Error(list.error.message)
  if (reads.error) throw new Error(reads.error.message)
  const read = new Set(reads.data.map((r) => r.announcement_id))
  return list.data.map((a) => ({ ...a, isRead: read.has(a.id) }))
}

function useAnnouncementsSelect<T>(select: (items: AnnouncementItem[], today: string) => T) {
  const today = todayISO()
  const pick = useCallback((items: AnnouncementItem[]) => select(items, today), [select, today])
  return useQuery({ queryKey: KEY, queryFn: fetchAnnouncements, select: pick })
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

export function useMarkRead() {
  const client = useQueryClient()
  const { session } = useAuth()
  const userId = session?.user.id
  return useMutation({
    mutationFn: async (announcementId: string) => {
      if (!userId) throw new Error('Not signed in')
      const { error } = await supabase
        .from('announcement_reads')
        .upsert({ announcement_id: announcementId, user_id: userId }, { onConflict: 'announcement_id,user_id', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
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
