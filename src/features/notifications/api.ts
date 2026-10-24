import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { supabase } from '../../lib/supabase'
import { useAnnouncements, useMarkRead, useUnreadCount } from '../announcements/api'
import { buildFeed, unseenTicketCount, unseenTicketIds, type ActivityKind, type FeedItem, type TicketActivity } from './feed'
import type { AnnouncementRowLite, ChangeEvent, CommentRowLite, TicketRowLite } from './rules'

/** Under ['tickets'], so every ticket mutation that refreshes the lists refreshes the badge too. */
export const activityKey = (userId: string | undefined) => ['tickets', 'activity', userId] as const

const KINDS: readonly ActivityKind[] = ['created', 'status', 'edited', 'other', 'comment']
const asKind = (k: string | null): ActivityKind | null => KINDS.find((x) => x === k) ?? null

export async function fetchActivity(): Promise<TicketActivity[]> {
  const { data, error } = await supabase.rpc('my_ticket_activity')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({ ...r, activity_kind: asKind(r.activity_kind) }))
}

/** The calls the user is notified about (admins: all; residents: their own), with unseen flags. */
export function useTicketActivity() {
  const userId = useAuth().session?.user.id
  return useQuery({ queryKey: activityKey(userId), queryFn: fetchActivity, enabled: !!userId })
}

export function useUnseenTicketCount(): number {
  return unseenTicketCount(useTicketActivity().data)
}

export function useUnseenTicketIds(): Set<string> {
  const { data } = useTicketActivity()
  return useMemo(() => unseenTicketIds(data), [data])
}

/** Unread announcements plus unseen calls (the bell's badge). */
export function useNotificationCount(): number {
  return useUnreadCount() + useUnseenTicketCount()
}

/** The notification center's list: the last 30 days, newest first. */
export function useNotificationFeed(): FeedItem[] {
  const announcements = useAnnouncements().data
  const activity = useTicketActivity().data
  return useMemo(() => buildFeed(announcements ?? [], activity ?? []), [announcements, activity])
}

function setSeen(client: QueryClient, key: readonly unknown[], ids: readonly string[] | null): void {
  client.setQueryData<TicketActivity[]>(key, (rows) => rows?.map((r) => (ids === null || ids.includes(r.ticket_id) ? { ...r, unseen: false } : r)))
}

/** Marks calls seen (null = all), by the server clock. The badge clears at once (optimistic). */
export function useMarkTicketsSeen() {
  const client = useQueryClient()
  const key = activityKey(useAuth().session?.user.id)
  return useMutation({
    mutationFn: async (ids: readonly string[] | null) => {
      const { error } = await supabase.rpc('mark_tickets_seen', ids === null ? {} : { p_ids: [...ids] })
      if (error) throw new Error(error.message)
    },
    onMutate: async (ids) => {
      // An in-flight refetch would land after the optimistic write and bring the old flags back.
      await client.cancelQueries({ queryKey: key })
      setSeen(client, key, ids)
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  })
}

/** "סימון הכל כנקרא": every unread announcement and every call. */
export function useMarkAllRead(): () => void {
  const { data } = useAnnouncements()
  const markRead = useMarkRead().mutate
  const markSeen = useMarkTicketsSeen().mutate
  return () => {
    const unread = (data ?? []).filter((a) => !a.isRead).map((a) => a.id)
    if (unread.length > 0) markRead(unread)
    markSeen(null)
  }
}

let channelSeq = 0

/**
 * One Realtime channel for the signed-in user: new announcements, new and changed calls, new comments.
 * Realtime applies each table's SELECT policy to the subscriber. Each call gets its own topic, so a quick
 * unsubscribe/resubscribe (StrictMode, user switch) never reuses a channel that is still closing. `onResync` runs
 * when the channel re-joins after a drop: events sent while offline are lost, so the caller refetches.
 * Returns the unsubscribe function.
 */
export function subscribeToChanges(userId: string, onEvent: (event: ChangeEvent) => void, onResync: () => void): () => void {
  const pg = { schema: 'public' } as const
  let joined = false
  channelSeq += 1
  const channel = supabase
    .channel(`notifications:${userId}:${channelSeq}`)
    .on<AnnouncementRowLite>('postgres_changes', { ...pg, event: 'INSERT', table: 'announcements' },
      (p) => onEvent({ table: 'announcements', row: p.new }))
    .on<TicketRowLite>('postgres_changes', { ...pg, event: 'INSERT', table: 'tickets' },
      (p) => onEvent({ table: 'tickets', type: 'INSERT', row: p.new }))
    .on<TicketRowLite>('postgres_changes', { ...pg, event: 'UPDATE', table: 'tickets' },
      (p) => onEvent({ table: 'tickets', type: 'UPDATE', row: p.new }))
    .on<CommentRowLite>('postgres_changes', { ...pg, event: 'INSERT', table: 'ticket_comments' },
      (p) => onEvent({ table: 'ticket_comments', row: p.new }))
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED') return
      if (joined) onResync()
      joined = true
    })
  return () => {
    void supabase.removeChannel(channel)
  }
}
